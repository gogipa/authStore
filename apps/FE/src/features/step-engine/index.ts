/**
 * step-engine 도메인(OpenAPI 태그 `step-engine`)의 공개 API. 밖에서는 `@/features/step-engine`으로만 가져온다.
 * P1-04: 후보 목록·상세·상태별 수·이어서 할 곳·재실행 필요 모아 보기·상태 이력, 만들기·제외·다시 작업·성별,
 * 후보 머리·단계 점. 단계 레일·단계 표·실행 훅은 P1-05, 게이트 훅은 P1-06이 더한다.
 */
export {
  useAttentionSteps,
  useCandidate,
  useCandidates,
  useCandidateStatusCounts,
  useCandidateStatusHistory,
  useResumeTarget,
} from './api/useCandidateQueries';
export {
  useCreateCandidate,
  useExcludeCandidate,
  useReopenCandidate,
  useSetCandidateGender,
} from './api/useCandidateMutations';
export { STEP_ENGINE_TAG_KEY, stepEngineKeys } from './api/queryKeys';
export {
  CANDIDATE_STATUS_LABEL,
  EXCLUDED_REASON_LABEL,
  FAILURE_KIND_LABEL,
  inputKeyLabel,
  STEP_NAME,
  STEP_SCREEN_NAME,
} from './model/labels';
export {
  GATE_SCREEN,
  resumeRelativePath,
  resumeStepLabel,
  resumeStepPath,
  resumeTargetLabel,
  resumeTargetPath,
} from './model/resume';
export { anchorKeyLabel, candidateDisplayName } from './model/displayName';
export {
  GROUP_STATUS_PRIORITY,
  groupStepStatus,
  STEP_DOT_GROUPS,
  stepDots,
  stepStatusOf,
} from './model/stepDots';
export type * from './model/types';
export { CandidateHeader } from './components/CandidateHeader/CandidateHeader';
export type { CandidateHeaderProps } from './components/CandidateHeader/CandidateHeader';
export { CandidateDetailHeader } from './components/CandidateHeader/CandidateDetailHeader';
export { candidateGateViews } from './model/gateViews';
export type { CandidateGateView } from './model/gateViews';
export { parseCandidateId } from './model/candidateId';
export { CandidateStatusChip } from './components/CandidateStatusChip/CandidateStatusChip';
export { StepDot, StepDotLegend, StepDots } from './components/StepDots/StepDots';
