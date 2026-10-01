import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import { CandidateGuardService } from '../../step-engine/candidates/candidate-guard.service.js';
import { STEP_LABEL, type StepCode } from '../../step-engine/domain/steps.js';
import {
  REGISTRATION_OPTION_TYPES,
  type ApprovalInputs,
  type RegistrationOptionType,
} from '../draft/approval-inputs.js';
import { ApprovalInputsLoader } from '../draft/approval-inputs.loader.js';
import { buildRegistrationDraft } from '../draft/registration-draft.builder.js';
import type { ApprovalPreviewDto, ApprovalSourcingMethodDto } from '../dto/approval.dto.js';
import { judgementExpiresAt } from '../pre-validation/checks/judgement-freshness.check.js';
import { APPROVAL_ALLOWED_STATUSES } from '../pre-validation/pre-validation.service.js';
import { approvalWarningsOf, duplicateInfoOf } from '../duplicate/duplicate.service.js';
import { approveDisabledReasonOf } from './approve-enabled.js';

function invalidQuery(field: string, message: string): ApiException {
  return new ApiException('INVALID_QUERY_PARAMETER', { fieldErrors: [{ field, message }] });
}

/** 미리보기 쿼리(`optionType`만). 어기면 422 INVALID_QUERY_PARAMETER */
export function parseApprovalQuery(query: Record<string, unknown>): {
  optionType: RegistrationOptionType;
} {
  for (const key of Object.keys(query)) {
    if (key !== 'optionType') throw invalidQuery(key, '받지 않는 조건입니다.');
  }
  const raw = query.optionType;
  if (raw === undefined) return { optionType: 'COMBINATION' };
  if (typeof raw !== 'string' || !(REGISTRATION_OPTION_TYPES as readonly string[]).includes(raw)) {
    throw invalidQuery('optionType', 'COMBINATION·STANDARD 중 하나여야 합니다.');
  }
  return { optionType: raw as RegistrationOptionType };
}

function outputMissing(stepCode: StepCode): ApiException {
  return new ApiException('STEP_OUTPUT_NOT_FOUND', {
    message: formatErrorMessage('STEP_OUTPUT_NOT_FOUND', { 단계: STEP_LABEL[stepCode] }),
    details: { stepCode },
  });
}

/** 소싱 방식(F-AP-08 'URL로 만든 후보는 소싱 방식(비교함 / 비교 없이 확정)도 표시') */
export function sourcingMethodOf(inputs: ApprovalInputs): ApprovalSourcingMethodDto | null {
  const { sourcing, candidate } = inputs;
  if (!sourcing) return null;
  const method = sourcing.comparisonPerformed
    ? 'COMPARED'
    : candidate.noComparisonConfirmedAt
      ? 'NO_COMPARISON_CONFIRMED'
      : 'NOT_CONFIRMED';
  return {
    method,
    creationPath: candidate.creationPath,
    noComparisonConfirmedAt: candidate.noComparisonConfirmedAt,
    itemCode: sourcing.itemCode,
  };
}

/**
 * G4 승인 미리보기(P4-02 §5 `approval.service.ts`, 05-2 `getCandidateApproval`, F-AP-08·10, 규칙 1·14). 순서: 쿼리 422 → 후보 404 →
 * 승인대기 아님 409 `CANDIDATE_STATUS_INVALID`(details.allowed) → 입력 읽기 → 꼭 있어야 하는 산출물(③ 판정·⑥-3 조립·⑧ 업로드)이
 * 없으면 404 `STEP_OUTPUT_NOT_FOUND`(details.stepCode) → 요청 초안 → 응답. 저장된 산출물만 읽고 외부 호출은 없다(restricted-tags·
 * SELLER_CODE는 사전 검증). `priceJudgementId`·`uploadResultId`는 현재 버전 id(승인 body의 expected*로 돌아온다), `judgementExpiresAt`
 * = 수집 시각 + 설정 유효 시간. `approveEnabled=false`면 `approveDisabledReason.code`는 승인 API가 돌려줄 코드와 같다
 * (`approveDisabledReasonOf`). `?optionType=STANDARD`는 표준형 미리보기(P4-03 F-AP-41 — 카테고리가 지원하면 표준형 옵션 모양, 아니면
 * 조합형 모양 + 꺼짐). P4-03이 더한 칸: `standardOptionSupported`('표준형으로 바꾸기' 보이기)·`liveRegistrationCount`·
 * `initialSuspensionCount`('처음 10건(3/10)')·`duplicate.source·registeredAt·smartstoreProductUrl`('기존 상품 보기')·
 * `warnings`(`SAME_MODEL_REGISTERED`). SELLER_CODE 교차 조회는 외부 호출이라 사전 검증만 한다.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: CandidateGuardService,
    private readonly loader: ApprovalInputsLoader,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async preview(
    candidateId: number,
    rawQuery: Record<string, unknown>,
  ): Promise<ApprovalPreviewDto> {
    const { optionType } = parseApprovalQuery(rawQuery);
    const candidate = await this.guard.findOr404(this.prisma, candidateId);
    this.guard.assertStatusIn(candidate, APPROVAL_ALLOWED_STATUSES);
    const inputs = await this.loader.load(candidate);
    const { judgement, assembly, upload } = inputs;
    if (!judgement) throw outputMissing('PRICING');
    if (!assembly) throw outputMissing('NOTICE_HTML');
    if (!upload) throw outputMissing('UPLOAD');
    const draft = buildRegistrationDraft(inputs, { optionType });
    const now = this.clock.now();
    const disabled = approveDisabledReasonOf({ inputs, draft, now, restrictedTags: null });
    const stock = new Map(
      (inputs.sourcing?.sizes ?? []).map((size) => [size.sizeMm, size.quantity]),
    );
    const collectedAt = judgement.rakutenPageCollectedAt
      ? new Date(judgement.rakutenPageCollectedAt)
      : null;
    return {
      candidateId,
      candidateStatus: candidate.status as ApprovalPreviewDto['candidateStatus'],
      optionType,
      apiBlocked: inputs.apiBlocked,
      productName: assembly.productName,
      salePriceKrw: judgement.salePriceKrw ?? 0,
      priceJudgementId: judgement.priceJudgementId,
      uploadResultId: upload.uploadResultId,
      judgedAt: judgement.judgedAt,
      rakutenPageCollectedAt: judgement.rakutenPageCollectedAt,
      judgementExpiresAt: collectedAt
        ? judgementExpiresAt(collectedAt, inputs.settings.judgementValidityHours).toISOString()
        : null,
      marginBreakdown: {
        couponYen: judgement.couponYen,
        shippingYen: judgement.shippingYen,
        shippingEstimated: judgement.shippingEstimated,
        cShipIntlKrw: judgement.cShipIntlKrw,
        cFwdKrw: judgement.cFwdKrw,
        fwdCouponKrw: judgement.fwdCouponKrw,
        fwdAssumed: judgement.fwdAssumed,
        vatMode: judgement.vatMode as 'A' | 'B' | 'C',
        pricingRule: judgement.pricingRule,
        targetMarginRate: Number(judgement.targetMarginRate),
        minProfitKrw: judgement.minProfitKrw,
        sizes: judgement.sizes.map((size) => ({
          ...size,
          unsellableReason: size.unsellableReason as
            'TAXABLE' | 'P_MIN_OVER_REF' | 'MODE_B_NEGATIVE' | null,
          stockQuantity: stock.get(size.sizeMm) ?? null,
        })),
      },
      images: [...upload.images]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((image) => ({ role: image.role, sortOrder: image.sortOrder, url: image.url })),
      detailContent: upload.detailContent,
      noticeFields: assembly.noticeFields,
      originAreaCode: assembly.originAreaCode,
      originAreaContent: assembly.originAreaContent,
      originLabel: assembly.specOriginLabel || null,
      importer: assembly.importer,
      leafCategoryId: candidate.leafCategoryId,
      wholeCategoryName: candidate.wholeCategoryName,
      tags: (inputs.tags?.tags ?? []).map((tag) => ({
        code: tag.code,
        text: tag.text,
        finalOrder: tag.finalOrder,
      })),
      sourcingMethod: sourcingMethodOf(inputs),
      requestJsonDraft: draft.requestJson as unknown as Record<string, unknown>,
      sellerManagementCode: draft.sellerManagementCode ?? '',
      displayStatusType: draft.displayStatusType,
      duplicate: duplicateInfoOf(inputs),
      approveEnabled: disabled === null,
      approveDisabledReason: disabled,
      warnings: approvalWarningsOf(inputs),
      standardOptionSupported: draft.standardOption.supported,
      liveRegistrationCount: inputs.registrations.liveCount,
      initialSuspensionCount: inputs.settings.initialSuspensionCount,
    };
  }
}
