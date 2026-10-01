import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserActionLogService } from '../../../common/audit/user-action-log.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type { Candidate, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import { CandidateGuardService } from '../../step-engine/candidates/candidate-guard.service.js';
import { CandidateStatusService } from '../../step-engine/candidates/candidate-status.service.js';
import {
  StepEngineTransactions,
  type StepEngineTx,
} from '../../step-engine/candidates/step-engine-tx.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import { liveRegistrationCountOf, type ApprovalInputs } from '../draft/approval-inputs.js';
import {
  IN_PROGRESS_REGISTRATION_STATUSES,
  LIVE_REGISTRATION_STATUSES,
  ApprovalInputsLoader,
} from '../draft/approval-inputs.loader.js';
import {
  buildRegistrationDraft,
  displayStatusTypeOf,
  type RegistrationDraft,
} from '../draft/registration-draft.builder.js';
import { judgementFreshnessCheck } from '../pre-validation/checks/judgement-freshness.check.js';
import {
  APPROVAL_ALLOWED_STATUSES,
  PreValidationService,
  type PreValidationEvaluation,
} from '../pre-validation/pre-validation.service.js';
import { PRE_VALIDATION_CHECK_LABEL } from '../pre-validation/pre-validation.types.js';
import { registrationChangedEvent } from '../register/registration-record.js';
import { RegistrationSubmitter } from '../submit/registration-submitter.js';
import { RegistrationSwitchService } from '../switch/registration-switch.service.js';
import {
  acceptedOf,
  parseApprovalBody,
  parseIdempotencyKey,
  replayIdempotentApproval,
  type ApprovalBody,
  type ApprovalIdentity,
  type RegistrationAccepted,
} from './idempotency.js';

const GATE_TEXT = { G2: 'G2 판정 확정', G3: 'G3 썸네일 선택' } as const;

/** 등록 기록 부분 UNIQUE(ERD `registration` 인덱스) */
export const REGISTRATION_LIVE_INDEXES = [
  'uq_registration_live_key',
  'uq_registration_live_seller_code',
];

function describe(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const e = error as { message?: unknown; meta?: unknown; cause?: unknown };
  let meta = '';
  try {
    meta = JSON.stringify(e.meta ?? null);
  } catch {
    meta = '';
  }
  return `${typeof e.message === 'string' ? e.message : ''} ${meta} ${e.cause ? describe(e.cause) : ''}`;
}

/**
 * 등록 기록 INSERT의 고유 제약 위반 종류(Postgres 23505 / Prisma P2002): 같은 Idempotency-Key(동시 재전송) / 진행 중·등록됨 같은
 * 상품·색상 또는 같은 판매자관리코드(마지막 방어선 — 409 DUPLICATE_REGISTRATION, 규칙 10). 고유 제약 위반이 아니면 null
 */
export function registrationUniqueViolation(error: unknown): 'IDEMPOTENCY' | 'LIVE' | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  const text = describe(error);
  if (!(code === 'P2002' || code === '23505' || text.includes('23505'))) return null;
  if (text.includes('idempotency_key') || text.includes('idempotencyKey')) return 'IDEMPOTENCY';
  if (
    REGISTRATION_LIVE_INDEXES.some((name) => text.includes(name)) ||
    text.includes('seller_management_code') ||
    text.includes('sellerManagementCode') ||
    (text.includes('item_code') && text.includes('selected_color')) ||
    (text.includes('itemCode') && text.includes('selectedColor'))
  ) {
    return 'LIVE';
  }
  return null;
}

function duplicateError(details: Record<string, unknown>): ApiException {
  return new ApiException('DUPLICATE_REGISTRATION', { details });
}

/**
 * G4 최종 승인·등록(P4-03 §5 `approval/approve.service.ts`, 규칙 5~7, 05-2 `createCandidateRegistration`, 05-1 표 E). ⑨로 가는 길은 이
 * 웹 API 하나뿐이다(로컬 보안 가드 + `X-AutoStore-Client` — 연속 실행·CLI·설정·단계 실행으로 부르는 길이 없다, 규칙 15).
 * 검사 순서(모두 지나야 기록을 만든다 — Proposed, 05-1 §7.5): `Idempotency-Key` 없음 400 → 키 모양 422 → body 422 → 같은 키 기록이 있으면
 * 첫 응답 202(본문이 다르면 422 `IDEMPOTENCY_KEY_REUSED`) → 후보 404 → 진행 중 기록 409 `REGISTRATION_IN_PROGRESS` → 승인대기 아님 409
 * `CANDIDATE_STATUS_INVALID` → expected* ≠ 현재 409 `VERSION_NOT_CURRENT` → G2·G3 무효 409 `GATE_NOT_PASSED` → 판정 유효 시간 초과 409
 * `JUDGEMENT_EXPIRED` → 로컬 중복 409 `DUPLICATE_REGISTRATION` → 표준형을 쓸 수 없음 422 `VALIDATION_FAILED` → (외부 조회) 승인 직전
 * 재검증(P4-02 `PreValidationService.evaluate` — restricted-tags·SELLER_CODE) → SELLER_CODE에 있음 409 `DUPLICATE_REGISTRATION` → BLOCK
 * 실패 422 `PRE_VALIDATION_FAILED`(`details.checks[]`). 409·422이면 외부 조회 전에 멈춘다(로컬 검사까지).
 * 기록 만들기(한 트랜잭션 — 후보 행 잠금 뒤 키·상태·진행 중·버전을 다시 본다):
 * - 차단 켬(드라이런, 규칙 6): ⑨ StepRun을 열고 곧바로 COMPLETED, 등록 기록 `VALIDATED`(request_json·validation_result·approved_at),
 *   후보 `VALIDATED`(`G4_APPROVED_BLOCKED`), `user_action_log`(GATE_PASSED, G4). 커머스API를 부르지 않는다
 * - 차단 끔(규칙 7): ⑨ RUNNING + 기록 `REGISTERING`(판매자관리코드·idempotency_key·approved_at) + 후보 `REGISTERING`(`G4_APPROVED`) +
 *   user_action_log를 커밋한 뒤 202. 등록 호출은 커밋 뒤 `RegistrationSubmitter`(트랜잭션 밖)
 * 부분 UNIQUE 위반(동시 승인)은 409 `DUPLICATE_REGISTRATION`, 같은 키 동시 재전송은 첫 응답으로 바꾼다.
 */
@Injectable()
export class ApproveService {
  private readonly logger = new Logger(ApproveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly status: CandidateStatusService,
    private readonly api: StepEngineApi,
    private readonly loader: ApprovalInputsLoader,
    private readonly preValidation: PreValidationService,
    private readonly switches: RegistrationSwitchService,
    private readonly submitter: RegistrationSubmitter,
    private readonly audit: UserActionLogService,
    private readonly events: ProgressEventsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `POST /candidates/{candidateId}/registrations` → 202 본문 */
  async approve(
    candidateId: number,
    rawKey: unknown,
    rawBody: unknown,
  ): Promise<RegistrationAccepted> {
    const key = parseIdempotencyKey(rawKey);
    const body = parseApprovalBody(rawBody);
    const identity: ApprovalIdentity = {
      candidateId,
      optionType: body.optionType,
      uploadResultId: body.expectedUploadResultId,
      priceJudgementId: body.expectedPriceJudgementId,
    };
    const replay = await replayIdempotentApproval(this.prisma, key, identity);
    if (replay) return replay;

    const candidate = await this.guard.findOr404(this.prisma, candidateId);
    const inputs = await this.loader.load(candidate);
    this.assertLocal(candidate, inputs, body);
    const evaluation = await this.preValidation.evaluate(candidate, body.optionType, { inputs });
    const seller = evaluation.sellerCode;
    if (seller.ok && seller.product) {
      throw duplicateError({
        source: 'COMMERCE_API',
        sellerManagementCode: evaluation.draft.sellerManagementCode,
        originProductNo: seller.product.originProductNo,
      });
    }
    if (!evaluation.result.approvable) {
      const failed = evaluation.result.checks.filter((check) => !check.passed);
      throw new ApiException('PRE_VALIDATION_FAILED', {
        message: formatErrorMessage('PRE_VALIDATION_FAILED', {
          항목: failed.map((check) => PRE_VALIDATION_CHECK_LABEL[check.checkCode]).join(', '),
        }),
        details: { checks: evaluation.result.checks },
      });
    }

    try {
      return await this.transactions.run((scope) =>
        this.record(scope, candidateId, key, identity, body, evaluation),
      );
    } catch (error) {
      const violation = registrationUniqueViolation(error);
      if (violation === 'IDEMPOTENCY') {
        const again = await replayIdempotentApproval(this.prisma, key, identity);
        if (again) return again;
      }
      if (violation === 'LIVE') {
        throw duplicateError({ source: 'LOCAL', reason: 'UNIQUE_VIOLATION' });
      }
      throw error;
    }
  }

  /** 로컬 검사(외부 호출 전, 규칙 5의 409 순서 + 표준형 422) */
  private assertLocal(candidate: Candidate, inputs: ApprovalInputs, body: ApprovalBody): void {
    const inProgress = inputs.registrations.inProgress;
    if (inProgress) {
      throw new ApiException('REGISTRATION_IN_PROGRESS', {
        details: { registrationId: inProgress.registrationId, status: inProgress.status },
      });
    }
    this.guard.assertStatusIn(candidate, APPROVAL_ALLOWED_STATUSES);
    const currentUpload = inputs.upload?.uploadResultId ?? null;
    const currentJudgement = inputs.judgement?.priceJudgementId ?? null;
    if (
      currentUpload !== body.expectedUploadResultId ||
      currentJudgement !== body.expectedPriceJudgementId
    ) {
      throw new ApiException('VERSION_NOT_CURRENT', {
        details: {
          expectedUploadResultId: body.expectedUploadResultId,
          currentUploadResultId: currentUpload,
          expectedPriceJudgementId: body.expectedPriceJudgementId,
          currentPriceJudgementId: currentJudgement,
        },
      });
    }
    for (const gate of ['G2', 'G3'] as const) {
      if (!inputs.gates[gate].valid) {
        throw new ApiException('GATE_NOT_PASSED', {
          message: formatErrorMessage('GATE_NOT_PASSED', { 게이트: GATE_TEXT[gate] }),
          details: { gate, changedBasisKeys: inputs.gates[gate].changedBasisKeys },
        });
      }
    }
    const draft = buildRegistrationDraft(inputs, { optionType: body.optionType });
    const now = this.clock.now();
    const freshness = judgementFreshnessCheck({ inputs, draft, now, restrictedTags: null });
    if (!freshness.passed) {
      throw new ApiException('JUDGEMENT_EXPIRED', {
        message: formatErrorMessage('JUDGEMENT_EXPIRED', {
          n: inputs.settings.judgementValidityHours,
        }),
        details: { rakutenPageCollectedAt: inputs.judgement?.rakutenPageCollectedAt ?? null },
      });
    }
    const local = inputs.registrations.duplicate;
    if (local) {
      throw duplicateError({
        source: 'LOCAL',
        existingRegistrationId: local.registrationId,
        originProductNo: local.originProductNo,
      });
    }
    if (body.optionType === 'STANDARD' && !draft.standardOption.supported) {
      throw new ApiException('VALIDATION_FAILED', {
        fieldErrors: [
          {
            field: 'optionType',
            message: draft.standardOption.reason ?? '표준형 옵션을 쓸 수 없습니다.',
          },
        ],
      });
    }
  }

  /** 기록 트랜잭션(규칙 6·7) */
  private async record(
    scope: StepEngineTx,
    candidateId: number,
    key: string,
    identity: ApprovalIdentity,
    body: ApprovalBody,
    evaluation: PreValidationEvaluation,
  ): Promise<RegistrationAccepted> {
    const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
    const replay = await replayIdempotentApproval(scope.tx, key, identity);
    if (replay) return replay;
    // 외부 조회 동안 바뀌었을 수 있는 것을 잠근 뒤 다시 본다
    const inProgress = await scope.tx.registration.findFirst({
      where: {
        stepRun: { candidateId },
        status: { in: IN_PROGRESS_REGISTRATION_STATUSES },
        failedAt: null,
      },
      select: { id: true, status: true },
    });
    if (inProgress) {
      throw new ApiException('REGISTRATION_IN_PROGRESS', {
        details: { registrationId: inProgress.id, status: inProgress.status },
      });
    }
    this.guard.assertStatusIn(candidate, APPROVAL_ALLOWED_STATUSES);
    const steps = await scope.tx.candidateStep.findMany({
      where: { candidateId },
      select: { stepCode: true, currentStepRunId: true },
    });
    const changed = steps.filter(
      (step) =>
        step.stepCode !== 'REGISTER' &&
        (evaluation.inputs.steps[step.stepCode as keyof ApprovalInputs['steps']]
          ?.currentStepRunId ?? null) !== step.currentStepRunId,
    );
    if (changed.length > 0) {
      throw new ApiException('VERSION_NOT_CURRENT', {
        details: { changedSteps: changed.map((step) => step.stepCode) },
      });
    }

    const draft = this.withDisplayStatus(
      evaluation.draft,
      await this.liveCount(scope),
      evaluation.inputs.settings.initialSuspensionCount,
    );
    const switchRow = await this.switches.ensureRow(scope.tx);
    const dryRun = switchRow.apiBlocked;
    const run = await this.api.openRegisterRun(scope, candidateId);
    const registration = await scope.tx.registration.create({
      data: {
        stepRunId: run.id,
        priceJudgementId: identity.priceJudgementId,
        uploadResultId: identity.uploadResultId,
        status: dryRun ? 'VALIDATED' : 'REGISTERING',
        itemCode: candidate.itemCode!,
        selectedColor: candidate.selectedColor!,
        colorCode: candidate.anchorColorCode!,
        sellerManagementCode: draft.sellerManagementCode!,
        displayStatusType: draft.displayStatusType,
        optionType: body.optionType,
        requestJson: draft.requestJson as unknown as Prisma.InputJsonObject,
        validationResult: {
          ...evaluation.result,
          sellerCodeLookup: evaluation.sellerCode,
        } as unknown as Prisma.InputJsonObject,
        approvedAt: scope.now,
        idempotencyKey: key,
      },
    });
    if (dryRun) {
      await this.api.closeRegisterRun(scope, run.id, {
        kind: 'COMPLETED',
        output: { registrationId: registration.id, dryRun: true },
      });
    }
    const fresh = await scope.tx.candidate.findUniqueOrThrow({ where: { id: candidateId } });
    const transition = await this.status.transition(
      scope,
      fresh,
      dryRun
        ? { toStatus: 'VALIDATED', reason: 'G4_APPROVED_BLOCKED' }
        : { toStatus: 'REGISTERING', reason: 'G4_APPROVED' },
      { stepRunId: run.id, registrationId: registration.id },
    );
    await this.audit.record(
      {
        eventType: 'GATE_PASSED',
        gate: 'G4',
        candidateId,
        stepRunId: run.id,
        registrationId: registration.id,
        stepCode: 'REGISTER',
        detail: {
          mode: dryRun ? 'DRY_RUN' : 'REGISTER',
          optionType: body.optionType,
          displayStatusType: draft.displayStatusType,
        },
        occurredAt: scope.now,
      },
      scope.tx,
    );
    scope.afterCommit(() => {
      this.events.publish(
        'registration.status-changed',
        registrationChangedEvent(registration, candidateId, transition.toStatus),
      );
      if (!dryRun) this.submitter.enqueue(registration.id);
    });
    if (!dryRun) {
      this.logger.log(
        `G4 승인 · 등록 기록 #${registration.id}(${draft.sellerManagementCode}) 등록 요청을 보냅니다`,
      );
    }
    return acceptedOf(registration, candidateId);
  }

  /** 처음 N건 셈을 트랜잭션 안에서 다시(동시 승인이 같은 셈을 쓰지 않게) */
  private async liveCount(scope: StepEngineTx): Promise<number> {
    const rows = await scope.tx.registration.findMany({
      where: { status: { in: LIVE_REGISTRATION_STATUSES }, failedAt: null },
      select: { status: true, failedAt: true },
    });
    return liveRegistrationCountOf(rows);
  }

  /** 전시 모드를 다시 센 값으로(바뀌었으면 요청 본문 채널 칸도) */
  private withDisplayStatus(
    draft: RegistrationDraft,
    liveCount: number,
    initialSuspensionCount: number,
  ): RegistrationDraft {
    const displayStatusType = displayStatusTypeOf(liveCount, initialSuspensionCount);
    if (displayStatusType === draft.displayStatusType) return draft;
    return {
      ...draft,
      displayStatusType,
      requestJson: {
        ...draft.requestJson,
        smartstoreChannelProduct: {
          ...draft.requestJson.smartstoreChannelProduct,
          channelProductDisplayStatusType: displayStatusType,
        },
      },
    };
  }
}
