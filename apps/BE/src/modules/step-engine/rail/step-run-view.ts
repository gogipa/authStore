import type { StepRun, StepRunInput } from '../../../generated/prisma/client.js';
import type { StepCode } from '../domain/steps.js';
import type {
  AiEngineValue,
  StepExecutionModeValue,
  StepFailureKindValue,
  StepInputSourceTypeValue,
  StepOwnerActionValue,
  StepRunAcceptedDto,
  StepRunInputItemDto,
  StepRunStatusValue,
  StepRunSummaryDto,
} from '../dto/step-run-response.dto.js';
import type { StartStepResult } from '../execution/step-execution.service.js';

const isoOrNull = (date: Date | null): string | null => (date ? date.toISOString() : null);

/** step_run → 05-2 StepRunSummary */
export function toStepRunSummary(run: StepRun): StepRunSummaryDto {
  return {
    id: run.id,
    candidateId: run.candidateId,
    stepCode: run.stepCode as StepCode,
    version: run.version,
    executionMode: run.executionMode as StepExecutionModeValue,
    ownerAction: run.ownerAction as StepOwnerActionValue | null,
    baseStepRunId: run.baseStepRunId,
    stepChainId: run.stepChainId,
    settingsSnapshotId: run.settingsSnapshotId,
    aiEngine: run.aiEngine as AiEngineValue | null,
    aiModel: run.aiModel,
    aiCliVersion: run.aiCliVersion,
    status: run.status as StepRunStatusValue,
    failureKind: run.failureKind as StepFailureKindValue | null,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    rerunReasonInputs: run.rerunReasonInputs,
    waitingSince: isoOrNull(run.waitingSince),
    waitSecondsTotal: run.waitSecondsTotal,
    startedAt: run.startedAt.toISOString(),
    endedAt: isoOrNull(run.endedAt),
  };
}

/** step_run_input → 05-2 StepRunInputItem */
export function toInputItem(row: StepRunInput): StepRunInputItemDto {
  return {
    inputKey: row.inputKey,
    sourceType: row.sourceType as StepInputSourceTypeValue,
    sourceStepRunId: row.sourceStepRunId,
    isStartCondition: row.isStartCondition,
    valueHash: row.valueHash,
  };
}

/** 시작 결과 → 05-2 StepRunAccepted(202) */
export function toAccepted(result: StartStepResult): StepRunAcceptedDto {
  const { run } = result;
  return {
    stepRunId: run.id,
    stepRunIds: result.stepRunIds,
    candidateId: run.candidateId,
    stepCode: run.stepCode as StepCode,
    version: run.version,
    executionMode: run.executionMode as StepExecutionModeValue,
    aiEngine: run.aiEngine as AiEngineValue | null,
    aiModel: run.aiModel,
    aiCliVersion: run.aiCliVersion,
    status: 'RUNNING',
    warnings: result.warnings,
  };
}

/** 202·201 Location: 진행 조회 경로(API_PREFIX 'api/v1' 포함) */
export function stepRunLocation(stepRunId: number): string {
  return `/api/v1/step-runs/${stepRunId}`;
}
