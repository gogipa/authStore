import type {
  CandidateStepChangedEvent,
  StepExecutionMode,
  StepFailureKind,
  StepRunStatus,
  StepRunStatusChangedEvent,
} from '../../../common/events/progress-event.types.js';
import type { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type { CandidateStep, StepRun } from '../../../generated/prisma/client.js';
import type { StepEngineTx } from '../candidates/step-engine-tx.js';
import type { StepCode, StepStatus } from '../domain/steps.js';

/**
 * 단계 실행 SSE(05-1 §3): `step-run.status-changed`(실행 시작·입력 대기·완료·실패·재실행 필요), `candidate-step.changed`
 * (단계 상태·현재 버전 포인터·재실행 필요 사유가 바뀔 때). 커밋 뒤에만 보낸다(롤백된 변화를 화면이 보지 않게).
 */

export function runStatusEvent(
  run: StepRun,
  occurredAt: Date,
  extra: { waitingReasonCode?: string | null; pendingInputs?: string[] } = {},
): StepRunStatusChangedEvent {
  const event: StepRunStatusChangedEvent = {
    stepRunId: run.id,
    candidateId: run.candidateId,
    stepCode: run.stepCode as StepCode,
    version: run.version,
    executionMode: run.executionMode as StepExecutionMode,
    stepChainId: run.stepChainId,
    status: run.status as StepRunStatus,
    occurredAt: occurredAt.toISOString(),
  };
  if (run.status === 'WAITING_INPUT') {
    event.waitingReasonCode = extra.waitingReasonCode ?? null;
    event.pendingInputs = extra.pendingInputs ?? [];
  }
  if (run.status === 'RERUN_REQUIRED') event.rerunReasonInputs = run.rerunReasonInputs;
  if (run.status === 'FAILED') {
    event.failureKind = run.failureKind as StepFailureKind | null;
    event.errorCode = run.errorCode;
    event.errorMessage = run.errorMessage;
  }
  return event;
}

export function stepChangedEvent(row: CandidateStep): CandidateStepChangedEvent {
  return {
    candidateId: row.candidateId,
    stepCode: row.stepCode as StepCode,
    status: row.status as StepStatus,
    currentStepRunId: row.currentStepRunId,
    staleInputs: row.staleInputs,
    staleSince: row.staleSince ? row.staleSince.toISOString() : null,
  };
}

/** 커밋 뒤 두 이벤트를 보낸다 */
export function publishAfterCommit(
  scope: StepEngineTx,
  events: ProgressEventsService,
  payload: {
    run?: { row: StepRun; extra?: { waitingReasonCode?: string | null; pendingInputs?: string[] } };
    steps?: CandidateStep[];
  },
): void {
  const occurredAt = scope.now;
  scope.afterCommit(() => {
    if (payload.run) {
      events.publish(
        'step-run.status-changed',
        runStatusEvent(payload.run.row, occurredAt, payload.run.extra),
      );
    }
    for (const row of payload.steps ?? []) {
      events.publish('candidate-step.changed', stepChangedEvent(row));
    }
  });
}
