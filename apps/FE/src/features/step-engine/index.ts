/**
 * step-engine 도메인(OpenAPI 태그 `step-engine`)의 공개 API. 밖에서는 `@/features/step-engine`으로만 가져온다.
 * P1-04: 후보 목록·상세·상태별 수·이어서 할 곳·재실행 필요 모아 보기·상태 이력, 만들기·제외·다시 작업·성별,
 * 후보 머리·단계 점.
 * P1-05: 단계 레일·버전 이력·실행 한 건·바뀐 입력 조회, 단계 실행·오너 수정 훅, 단계 표(StepTable)·상태 줄
 * (StepStatusBar)·바뀐 입력(StaleInputs), 입력 키 화면 이름.
 * P1-06: 연속 실행 시작·조회, 게이트 목록·통과 훅, '여기부터 연속 실행'·'재실행 필요 단계 모두 실행' 버튼, 연속 실행 띠,
 * 게이트 목록으로 그리는 게이트 배지.
 * P1-10: 'AI 엔진 설정으로' 링크(선택 AI 엔진을 쓸 수 없을 때, F-BS-76). StepStatusBar의 'AI 생성 · 엔진' 칩과 `error`.
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
  useCandidateSteps,
  useOwnerEdit,
  useStaleDiff,
  useStartStepRun,
  useStepRun,
  useStepRuns,
} from './api/useStepRunQueries';
export {
  CANDIDATE_STATUS_LABEL,
  EXCLUDED_REASON_LABEL,
  FAILURE_KIND_LABEL,
  inputKeyLabel,
  inputKeyLabels,
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
export {
  useCandidateGates,
  useContinuousRun,
  usePassGate,
  useStartContinuousRun,
} from './api/useContinuousRunQueries';
export { candidateGateViews, gateStateMap, gateViewsFromList } from './model/gateViews';
export {
  BEFORE_G2_CHAIN_TEXT,
  chainStepsText,
  CONTINUOUS_RUN_LABEL,
  continuousRunTitle,
  NO_CONTINUOUS_STEPS,
  NO_RERUN_TEXT,
  REGISTER_ONLY_G4_TEXT,
  RERUN_ALL_LABEL,
  skippedStepsText,
  stopReasonText,
  UPLOAD_NEEDS_G3_TEXT,
} from './model/continuousRun';
export { ContinuousRunButton } from './components/ContinuousRunButton/ContinuousRunButton';
export type {
  ChainStartStepCode,
  ContinuousRunButtonProps,
} from './components/ContinuousRunButton/ContinuousRunButton';
export { RerunAllButton } from './components/RerunAllButton/RerunAllButton';
export type { RerunAllButtonProps } from './components/RerunAllButton/RerunAllButton';
export { ContinuousRunBanner } from './components/ContinuousRunBanner/ContinuousRunBanner';
export type { ContinuousRunBannerProps } from './components/ContinuousRunBanner/ContinuousRunBanner';
export type { CandidateGateView } from './model/gateViews';
export { parseCandidateId } from './model/candidateId';
export { CandidateStatusChip } from './components/CandidateStatusChip/CandidateStatusChip';
export { StepDot, StepDotLegend, StepDots } from './components/StepDots/StepDots';
export { INPUT_KEY_LABEL } from './model/inputLabels';
export {
  CONTENT_GROUP_CODES,
  contentGroupStatus,
  inputSourceText,
  lastRunAt,
  railByCode,
  runButtonLabel,
  STEP_TABLE_CODES,
  STEP_TABLE_ROWS,
} from './model/stepTable';
export type { StepTableRow } from './model/stepTable';
export { StepTable } from './components/StepTable/StepTable';
export type { StepTableProps } from './components/StepTable/StepTable';
export { StepStatusBar } from './components/StepStatusBar/StepStatusBar';
export type { StepStatusBarProps } from './components/StepStatusBar/StepStatusBar';
export { StaleInputs } from './components/StaleInputs/StaleInputs';
export type { StaleInputsProps } from './components/StaleInputs/StaleInputs';
export {
  AiEngineSettingsLink,
  AiEngineSettingsLinkFor,
  AiEngineSettingsLinkForError,
} from './components/AiEngineSettingsLink/AiEngineSettingsLink';
