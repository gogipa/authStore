import { Inject, Injectable } from '@nestjs/common';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type { Candidate, CandidateStatusHistory } from '../../../generated/prisma/client.js';
import {
  hasReadyFields,
  nextCandidateStatus,
  type CandidateStatusChange,
} from '../domain/candidate-transition.js';
import {
  READY_REQUIRED_STATUSES,
  toStepStatusMap,
  type AutoExclusionReason,
  type CandidateExcludedReason,
  type CandidateStatus,
  type CandidateStatusReason,
} from '../domain/steps.js';
import { GATE_VALIDITY, toGateFlags, type GateValidityPort } from '../ports/gate-validity.port.js';
import type { StepEngineTx } from './step-engine-tx.js';

/** 전이를 일으킨 것(이력의 FK). 재평가 때 단계 결과의 제외 사유도 함께 넘긴다 */
export interface TransitionCause {
  stepRunId?: number | null;
  gatePassId?: number | null;
  registrationId?: number | null;
  /** 단계 결과가 낸 제외 사유(앵커 일치 없음·재고 부족·판매 후보 아님) */
  exclusion?: AutoExclusionReason | null;
}

/** 쓴 전이 한 건 */
export interface CandidateTransitionRecord {
  candidateId: number;
  fromStatus: CandidateStatus | null;
  toStatus: CandidateStatus;
  reason: CandidateStatusReason;
  excludedReason: CandidateExcludedReason | null;
  changedAt: Date;
  history: CandidateStatusHistory;
}

const EXCLUDED_REASONS: readonly CandidateExcludedReason[] = [
  'ANCHOR_NO_MATCH',
  'INSUFFICIENT_STOCK',
  'NOT_SALE_CANDIDATE',
  'OWNER_EXCLUDED',
];

/** 제외 전이의 사유 = excluded_reason 같은 코드(ck_candidate_excluded_pair) */
function excludedReasonFor(toStatus: CandidateStatus, reason: CandidateStatusReason) {
  if (toStatus !== 'EXCLUDED') return null;
  if (!(EXCLUDED_REASONS as readonly string[]).includes(reason)) {
    throw new Error(`제외 전이의 사유는 제외 사유 코드여야 합니다: ${reason}`);
  }
  return reason as CandidateExcludedReason;
}

/**
 * 후보 상태 쓰기(F-CW-05·06, 규칙 5·6). 전이마다 candidate.status·status_changed_at·excluded_reason +
 * candidate_status_history 1행(추가만) + 커밋 뒤 SSE `candidate.status-changed`.
 * 재평가(`reevaluate`)는 단계 완료·오너 수정·게이트 통과·재실행 필요 전파와 **같은 트랜잭션**에서 부른다.
 */
@Injectable()
export class CandidateStatusService {
  constructor(
    @Inject(GATE_VALIDITY) private readonly gateValidity: GateValidityPort,
    private readonly events: ProgressEventsService,
  ) {}

  /**
   * 후보 상태를 다시 계산해 바꿀 것이 있으면 전이를 쓴다(자동 전환 F-CW-05). 바꿀 것이 없으면 null.
   * 승인대기 이상에 필요한 값(ck_candidate_ready)이 없으면 승인대기로 올리지 않는다.
   */
  async reevaluate(
    scope: StepEngineTx,
    candidateId: number,
    cause: TransitionCause = {},
  ): Promise<CandidateTransitionRecord | null> {
    const candidate = await scope.tx.candidate.findUniqueOrThrow({ where: { id: candidateId } });
    const stepRows = await scope.tx.candidateStep.findMany({
      where: { candidateId },
      select: { stepCode: true, status: true },
    });
    const gates = toGateFlags(await this.gateValidity.evaluate(scope.tx, candidateId));
    const change = nextCandidateStatus(
      candidate.status as CandidateStatus,
      toStepStatusMap(stepRows),
      gates,
      { exclusion: cause.exclusion ?? null, ready: hasReadyFields(candidate) },
    );
    if (!change) return null;
    return this.transition(scope, candidate, change, cause);
  }

  /** 전이 하나를 쓴다(상태·시각·제외 사유 + 이력 1행 + 커밋 뒤 SSE) */
  async transition(
    scope: StepEngineTx,
    candidate: Pick<Candidate, 'id' | 'status'>,
    change: CandidateStatusChange,
    cause: TransitionCause = {},
  ): Promise<CandidateTransitionRecord> {
    const excludedReason = excludedReasonFor(change.toStatus, change.reason);
    if ((READY_REQUIRED_STATUSES as readonly string[]).includes(change.toStatus)) {
      const row = await scope.tx.candidate.findUniqueOrThrow({ where: { id: candidate.id } });
      if (!hasReadyFields(row)) {
        throw new Error(
          `후보 ${candidate.id}: 승인대기 이상에 필요한 값이 없습니다(ck_candidate_ready)`,
        );
      }
    }
    await scope.tx.candidate.update({
      where: { id: candidate.id },
      data: { status: change.toStatus, statusChangedAt: scope.now, excludedReason },
    });
    const history = await scope.tx.candidateStatusHistory.create({
      data: {
        candidateId: candidate.id,
        fromStatus: candidate.status,
        toStatus: change.toStatus,
        reason: change.reason,
        stepRunId: cause.stepRunId ?? null,
        gatePassId: cause.gatePassId ?? null,
        registrationId: cause.registrationId ?? null,
        changedAt: scope.now,
      },
    });
    const record: CandidateTransitionRecord = {
      candidateId: candidate.id,
      fromStatus: candidate.status as CandidateStatus,
      toStatus: change.toStatus,
      reason: change.reason,
      excludedReason,
      changedAt: scope.now,
      history,
    };
    this.publishAfterCommit(scope, record);
    return record;
  }

  /** 만들기 이력(from_status NULL, CREATED) + 커밋 뒤 SSE */
  async recordCreated(
    scope: StepEngineTx,
    candidate: Pick<Candidate, 'id' | 'status'>,
  ): Promise<CandidateTransitionRecord> {
    const history = await scope.tx.candidateStatusHistory.create({
      data: {
        candidateId: candidate.id,
        fromStatus: null,
        toStatus: candidate.status,
        reason: 'CREATED',
        changedAt: scope.now,
      },
    });
    const record: CandidateTransitionRecord = {
      candidateId: candidate.id,
      fromStatus: null,
      toStatus: candidate.status as CandidateStatus,
      reason: 'CREATED',
      excludedReason: null,
      changedAt: scope.now,
      history,
    };
    this.publishAfterCommit(scope, record);
    return record;
  }

  private publishAfterCommit(scope: StepEngineTx, record: CandidateTransitionRecord): void {
    scope.afterCommit(() => {
      this.events.publish('candidate.status-changed', {
        candidateId: record.candidateId,
        fromStatus: record.fromStatus,
        toStatus: record.toStatus,
        reason: record.reason,
        excludedReason: record.excludedReason,
        changedAt: record.changedAt.toISOString(),
      });
    });
  }
}
