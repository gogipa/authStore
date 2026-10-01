/**
 * registration 도메인(OpenAPI 태그 `registration`)의 공개 API. 밖에서는 `@/features/registration`으로만 가져온다.
 * - P4-01: ⑧ 업로드 산출물 훅(getCandidateUploadResult)과 표시 규칙(model/upload). ⑧ 실행은 `@/features/step-engine`의
 *   `useStartStepRun`(`stepCode=UPLOAD`)을 쓴다.
 * - P4-02: G4 승인 미리보기(getCandidateApproval)·사전 검증(runCandidatePreValidation — 화면을 열 때·SSE 때 다시, 한 번에 하나)
 *   훅과 표시 규칙(model/approval — 시안 13줄 ↔ 검사 15개, 상세 렌더링의 로컬 이미지 바꾸기, 버튼 잠금).
 * - P4-03: ⑨ 등록 — 승인·등록(createCandidateRegistration, 누를 때 Idempotency-Key 한 번)·등록 기록 이력·상세·결과 확인·등록 API
 *   차단 스위치 훅과 표시 규칙(model/register — 등록 모드 '(3/10)', 직전 결과, 기존 상품 보기, 내비 칩 글).
 */
export { REGISTRATION_TAG_KEY, registrationKeys } from './api/queryKeys';
export type { RegistrationOptionType } from './api/queryKeys';
export { useUploadResultQuery } from './api/useUploadResultQuery';
export { useApprovalQuery } from './api/useApprovalQuery';
export {
  useCandidateRegistrations,
  useCheckRegistrationResult,
  useCreateRegistration,
  usePutRegistrationSwitch,
  useRegistration,
  useRegistrationSwitch,
} from './api/useRegistrations';
export {
  PreValidationSupersededError,
  serializedRun,
  usePreValidation,
} from './api/usePreValidation';
export {
  UPLOAD_EMPTY_TEXT,
  UPLOAD_NOTE,
  UPLOAD_ROLE_LABEL,
  UPLOAD_SOURCE_TEXT,
  UPLOAD_TITLE,
  UPLOADED_IMAGES_TITLE,
  uploadImageAlt,
  uploadImageFileUrl,
  uploadImagesCaption,
} from './model/upload';
export type { UploadResultImageItem, UploadResultOutput } from './model/upload';
export {
  API_BLOCKED_NOTE,
  APPROVAL_BLOCKERS_TITLE,
  APPROVAL_DESCRIPTION,
  APPROVAL_TITLE,
  APPROVE_LABEL,
  approvalBlockersOf,
  approveState,
  categoryPathText,
  deliveryText,
  DETAIL_PARTS_TEXT,
  detailFactsText,
  detailPreviewDocument,
  draftOptions,
  freshnessNote,
  hasSameModelWarning,
  judgementWindowText,
  localizeDetailContent,
  maxMinimumPrice,
  optionStockText,
  PRE_VALIDATION_LINES,
  PRE_VALIDATION_NOTE,
  PRE_VALIDATION_RUNNING,
  PRE_VALIDATION_TITLE,
  preValidationLines,
  preValidationSummary,
  PREVIEW_CAPTION,
  PREVIEW_TITLE,
  productNameLength,
  REFETCH_CAPTION,
  REGISTER_TITLE,
  requestSummaryText,
  sourcingMethodText,
  STEP_LINK_LABEL,
  summarySize,
  tagsSummaryText,
} from './model/approval';
export type {
  ApprovalBlocker,
  ApprovalPreview,
  ApprovalSizeOption,
  DraftOption,
  PreValidationCheck,
  PreValidationCheckCode,
  PreValidationLineId,
  PreValidationLineView,
  PreValidationResult,
} from './model/approval';
export {
  APPROVING_LABEL,
  COMBINATION_OPTION_LABEL,
  duplicateOf,
  EXISTING_PRODUCT_LABEL,
  existingProductText,
  LAST_RESULT_LABEL,
  lastResultView,
  NAV_SWITCH_OFF,
  NAV_SWITCH_ON,
  NAV_SWITCH_UNKNOWN,
  navSwitchText,
  NO_APPROVAL_TEXT,
  REGISTER_GUIDE,
  REGISTER_MODE_LABEL,
  registerModeView,
  REQUEST_JSON_LABEL,
  RESULT_CHECK_LABEL,
  STANDARD_OPTION_LABEL,
  SWITCH_LABEL,
  SWITCH_OFF_TEXT,
  SWITCH_ON_TEXT,
  VALIDATED_NOTE,
} from './model/register';
export type {
  ApprovalDuplicateInfo,
  ApprovalWarning,
  LastResultTone,
  LastResultView,
  RegisterModeView,
  RegistrationAccepted,
  RegistrationCreateRequest,
  RegistrationDetail,
  RegistrationResultCheck,
  RegistrationSummary,
  RegistrationSummaryPage,
  RegistrationSwitchChanged,
  RegistrationSwitchState,
} from './model/register';
