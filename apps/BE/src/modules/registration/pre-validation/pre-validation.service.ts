import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { assertCommerceKeys } from '../../../common/secrets/assert-commerce-keys.js';
import { SECRET_STORE, type SecretStore } from '../../../common/secrets/secret-store.port.js';
import type { Candidate } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import {
  COMMERCE_TAGS_PORT,
  type CommerceTagsPort,
} from '../../integrations/naver-commerce/commerce-tags.port.js';
import { SettingsService } from '../../settings/settings.service.js';
import { CandidateGuardService } from '../../step-engine/candidates/candidate-guard.service.js';
import type { ApprovalInputs, RegistrationOptionType } from '../draft/approval-inputs.js';
import { ApprovalInputsLoader } from '../draft/approval-inputs.loader.js';
import {
  buildRegistrationDraft,
  type RegistrationDraft,
} from '../draft/registration-draft.builder.js';
import { isApprovable, runPreValidationChecks } from './pre-validation.js';
import {
  approvalWarningsOf,
  duplicateInfoOf,
  DuplicateService,
  type ApprovalDuplicateInfo,
  type ApprovalWarning,
} from '../duplicate/duplicate.service.js';
import type {
  PreValidationCheck,
  PreValidationContext,
  RestrictedTagsLookup,
  SellerCodeLookup,
} from './pre-validation.types.js';

/** 사전 검증을 받는 후보 상태(P4-02 규칙 1) */
export const APPROVAL_ALLOWED_STATUSES = ['AWAITING_APPROVAL'] as const;

/** 사전 검증 결과(05-2 PreValidationResult) */
export interface PreValidationResult {
  candidateId: number;
  approvable: boolean;
  checks: PreValidationCheck[];
  checkedAt: string;
  warnings: ApprovalWarning[];
  /** 중복 정보(P4-03 — 로컬 + SELLER_CODE 교차 조회, '기존 상품 보기') */
  duplicate: ApprovalDuplicateInfo;
}

/** 같은 후보·옵션 방식의 사전 검증 묶음(입력·초안·결과 — P4-03 승인이 `validation_result`·요청 본문에 쓴다) */
export interface PreValidationEvaluation {
  inputs: ApprovalInputs;
  draft: RegistrationDraft;
  result: PreValidationResult;
  /** SELLER_CODE 교차 조회 결과(P4-03 승인이 409 DUPLICATE_REGISTRATION을 고른다) */
  sellerCode: SellerCodeLookup;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * G4 사전 검증(P4-02 §5 `pre-validation.service.ts`, 05-2 `runCandidatePreValidation`, RG-08). 후보 상태 검사(404·409) → 입력 읽기
 * (`ApprovalInputsLoader`) → 요청 초안(`buildRegistrationDraft`) → `ctx`(현재 시각 = `CLOCK`, restricted-tags 재조회 결과) → 검사 15개
 * (`checks/*.check.ts`) → `PreValidationResult`. 상태를 바꾸지 않고 결과를 저장하지 않으며 부를 때마다 새로 계산한다(05-2 x-decision
 * §7.5-38). P4-03 승인 직전 재검증이 같은 서비스(`evaluate`)를 부른다.
 * - restricted-tags: 최종 태그를 설정 `tags.restrictedBatchSize`로 나눠 integrations `COMMERCE_TAGS_PORT`(P3-05 — P1-01 관문·`call_log`)로
 *   다시 확인한다. 키 없음·외부 실패·인증 실패는 `TAGS` 항목만 실패(사유에 원인)이고 전체는 200이다(§7.5-37)
 * - SELLER_CODE 교차 조회(P4-03 F-AP-36): 요청 초안의 판매자관리코드로 커머스API 상품 검색(`DuplicateService` — 실패는 DUPLICATE만
 *   실패). 결과에 중복 정보(`duplicate` — '기존 상품 보기')와 경고 `SAME_MODEL_REGISTERED`(같은 모델·색상, 다른 샵)를 넣는다
 * - 한 번에 하나: 같은 후보·옵션 방식의 검사가 돌고 있으면 새로 돌리지 않고 그 결과를 같이 쓴다(SSE로 연달아 다시 불려도
 *   restricted-tags를 겹쳐 부르지 않는다 — 규칙 '사전 검증은 부를 때마다 restricted-tags를 조회한다 … 한 번에 하나만')
 */
@Injectable()
export class PreValidationService {
  private readonly logger = new Logger(PreValidationService.name);
  private readonly inFlight = new Map<string, Promise<PreValidationResult>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: CandidateGuardService,
    private readonly loader: ApprovalInputsLoader,
    private readonly settings: SettingsService,
    @Inject(COMMERCE_TAGS_PORT) private readonly tagsPort: CommerceTagsPort,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly duplicates: DuplicateService,
  ) {}

  /** `POST /candidates/{id}/pre-validations`: 404 → 409(승인대기 아님, details.allowed) → 검사 */
  run(candidateId: number, optionType: RegistrationOptionType): Promise<PreValidationResult> {
    const key = `${candidateId}:${optionType}`;
    const running = this.inFlight.get(key);
    if (running) return running;
    const task = (async () => {
      const candidate = await this.guard.findOr404(this.prisma, candidateId);
      this.guard.assertStatusIn(candidate, APPROVAL_ALLOWED_STATUSES);
      return (await this.evaluate(candidate, optionType)).result;
    })().finally(() => {
      if (this.inFlight.get(key) === task) this.inFlight.delete(key);
    });
    this.inFlight.set(key, task);
    return task;
  }

  /**
   * 상태 검사가 끝난 후보의 검사 한 번(P4-03 승인 직전 재검증도 부른다 — 이미 읽은 입력을 `options.inputs`로 넘기면 다시 읽지 않는다).
   * 외부 조회 두 가지(restricted-tags, SELLER_CODE 교차 조회 — P4-03)는 실패해도 그 항목만 실패다.
   */
  async evaluate(
    candidate: Candidate,
    optionType: RegistrationOptionType,
    options: { inputs?: ApprovalInputs } = {},
  ): Promise<PreValidationEvaluation> {
    const inputs = options.inputs ?? (await this.loader.load(candidate));
    const draft = buildRegistrationDraft(inputs, { optionType });
    const restrictedTags = await this.lookupRestrictedTags(inputs, candidate.id);
    const sellerCode = await this.duplicates.lookupSellerCode(draft.sellerManagementCode, {
      candidateId: candidate.id,
    });
    const now = this.clock.now();
    const ctx: PreValidationContext = { inputs, draft, now, restrictedTags, sellerCode };
    const checks = runPreValidationChecks(ctx);
    return {
      inputs,
      draft,
      sellerCode,
      result: {
        candidateId: candidate.id,
        approvable: isApprovable(checks),
        checks,
        checkedAt: now.toISOString(),
        warnings: approvalWarningsOf(inputs),
        duplicate: duplicateInfoOf(inputs, sellerCode),
      },
    };
  }

  /** 최종 태그의 restricted-tags 재조회(실패는 사유로 — 이 항목만 실패) */
  private async lookupRestrictedTags(
    inputs: ApprovalInputs,
    candidateId: number,
  ): Promise<RestrictedTagsLookup> {
    const tags = inputs.tags?.tags.map((tag) => tag.text) ?? [];
    if (tags.length === 0) return { ok: true, restrictedTags: [] };
    try {
      await assertCommerceKeys(this.secrets);
      const batchSize = this.settings.current().tags.restrictedBatchSize;
      const restricted: string[] = [];
      for (const batch of chunks(tags, batchSize)) {
        const verdicts = await this.tagsPort.restrictedTags(batch, { candidateId });
        restricted.push(...verdicts.filter((v) => v.restricted).map((v) => v.tag));
      }
      return { ok: true, restrictedTags: restricted };
    } catch (error) {
      if (error instanceof ApiException) return { ok: false, reason: error.message };
      this.logger.error(`restricted-tags 재조회 실패(여정 ${candidateId}): ${String(error)}`);
      return { ok: false, reason: '커머스API 제한 태그 조회 중 알 수 없는 오류가 났습니다' };
    }
  }
}
