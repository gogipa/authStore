import type { components, operations } from '@/shared/api/schema';

/** step-engine 응답 타입(05-2 schema.d.ts에서 파생). 명세가 바뀌면 타입이 따라온다. */
export type CandidateStatus = components['schemas']['CandidateStatus'];
export type CandidateCreationPath = components['schemas']['CandidateCreationPath'];
export type CandidateExcludedReason = components['schemas']['CandidateExcludedReason'];
export type CandidateSummary = components['schemas']['CandidateSummary'];
export type CandidatePage = components['schemas']['CandidatePage'];
export type CandidateDetail = components['schemas']['CandidateDetail'];
export type CandidateStepBrief = components['schemas']['CandidateStepBrief'];
export type CandidateStatusCountList = components['schemas']['CandidateStatusCountList'];
export type CandidateResumeTarget = components['schemas']['CandidateResumeTarget'];
export type CandidateStatusHistoryPage = components['schemas']['CandidateStatusHistoryPage'];
export type CandidateStatusChangeResult = components['schemas']['CandidateStatusChangeResult'];
export type CandidateGenderResult = components['schemas']['CandidateGenderResult'];
export type CandidateGender = components['schemas']['CandidateGender'];
export type CandidateCreateRequest = components['schemas']['CandidateCreateRequest'];
export type CandidateStepAttentionItem = components['schemas']['CandidateStepAttentionItem'];
export type CandidateStepAttentionPage = components['schemas']['CandidateStepAttentionPage'];
export type CandidateWarning = components['schemas']['CandidateWarning'];

/** GET /candidates 쿼리(status 여러 값·runnableStep·q·page·size·sort) */
export type ListCandidatesParams = NonNullable<operations['listCandidates']['parameters']['query']>;
/** GET /candidate-steps 쿼리 */
export type ListAttentionStepsParams = NonNullable<
  operations['listAttentionCandidateSteps']['parameters']['query']
>;
/** GET /candidates/{candidateId}/status-history 쿼리 */
export type ListStatusHistoryParams = NonNullable<
  operations['listCandidateStatusHistory']['parameters']['query']
>;

// ── 단계 실행(P1-05) ────────────────────────────────────────────────────────
export type StepStatusValue = components['schemas']['StepStatus'];
export type StepRunSummary = components['schemas']['StepRunSummary'];
export type StepRunDetail = components['schemas']['StepRunDetail'];
export type StepRunInputItem = components['schemas']['StepRunInputItem'];
export type StepRunVersionItem = components['schemas']['StepRunVersionItem'];
export type StepRunVersionPage = components['schemas']['StepRunVersionPage'];
export type StepActionState = components['schemas']['StepActionState'];
export type CandidateStepActions = components['schemas']['CandidateStepActions'];
export type CandidateStepRailItem = components['schemas']['CandidateStepRailItem'];
export type CandidateStepRail = components['schemas']['CandidateStepRail'];
export type StepRunAccepted = components['schemas']['StepRunAccepted'];
export type StepRunStartRequest = components['schemas']['StepRunStartRequest'];
export type StepStaleDiff = components['schemas']['StepStaleDiff'];
export type StepStaleInputDiff = components['schemas']['StepStaleInputDiff'];
export type StepOwnerEditRequest = components['schemas']['StepOwnerEditRequest'];
export type StepOwnerEditResult = components['schemas']['StepOwnerEditResult'];
/** GET /candidates/{candidateId}/steps/{stepCode}/runs 쿼리 */
export type ListStepRunsParams = NonNullable<
  operations['listCandidateStepRuns']['parameters']['query']
>;
