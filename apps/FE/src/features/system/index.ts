/**
 * system 도메인(OpenAPI 태그 `system`)의 공개 API. 밖에서는 `@/features/system`으로만 가져온다.
 * P1-07: 비밀정보 키 입력(listSecrets·saveSecret)과 커머스API 인증 상태(getAuthStatus·createAuthCheck).
 * P1-08(메타 동기화)·P1-11(AI 도구 상태·첫 실행 점검)은 여기에 **더하기만** 한다.
 */
export { secretsQueryKey, useSaveSecretMutation, useSecretsQuery } from './api/secrets';
export type { SaveSecretInput } from './api/secrets';
export { authStatusQueryKey, useAuthCheckMutation, useAuthStatusQuery } from './api/commerceAuth';
export {
  isSecretKey,
  SECRET_KEYS,
  SECRET_LABEL,
  secretKeyFromHash,
  secretLabelText,
  secretRowId,
  systemSecretPath,
} from './model/secretLabels';
export type { SecretKey, SecretLabel, SecretStatus, SecretStatusList } from './model/secretLabels';
export {
  CAUSE_GUIDES,
  COMMERCE_KEY_ERROR_CODES,
  isCommerceKeyErrorCode,
  TOKEN_REFRESH_BEFORE_MS,
  TOKEN_STATE_CHIP,
  tokenState,
  tokenTimes,
} from './model/commerceAuth';
export type {
  CauseGuide,
  CommerceAuthCauseCategory,
  CommerceAuthStatus,
  TokenState,
} from './model/commerceAuth';
export { SecretKeysPanel } from './components/SecretKeysPanel/SecretKeysPanel';
export type { SecretKeysPanelProps } from './components/SecretKeysPanel/SecretKeysPanel';
export { AuthStatusPanel } from './components/AuthStatusPanel/AuthStatusPanel';
export type { AuthStatusPanelProps } from './components/AuthStatusPanel/AuthStatusPanel';
export { SystemKeyLink } from './components/SystemKeyLink/SystemKeyLink';
export type { SystemKeyLinkProps } from './components/SystemKeyLink/SystemKeyLink';

/**
 * P1-11: AI CLI 점검(getLatestAiCliChecks·listAiCliChecks·createAiCliCheck), SCR-11 'AI 도구 상태'·첫 실행 'AI 엔진 고르기',
 * SCR-13 카드와 같이 쓰는 상태 문구(aiEngineStatus).
 */
export {
  aiCliChecksBaseQueryKey,
  aiCliChecksQueryKey,
  latestAiCliChecksQueryKey,
  useAiCliChecksQuery,
  useCreateAiCliCheckMutation,
  useLatestAiCliChecksQuery,
} from './api/aiCliChecks';
export type { AiCliCheckListParams } from './api/aiCliChecks';
export {
  AI_AUTH_COMMAND,
  AI_CLI_CHECK_TRIGGER_LABEL,
  AI_CLI_HISTORY_SIZE,
  AI_ENGINE_ORDER,
  AI_ENGINE_RECOMMEND_ORDER,
  AI_ENGINE_VERIFY_WINDOW_MS,
  authStatusView,
  engineCheckViews,
  engineHealthChip,
  firstRunAiEngineState,
  formatLatency,
  hasRecentPass,
  installChip,
  lastCheckedAt,
  recommendEngine,
  smokeChip,
  versionSupportText,
} from './model/aiEngineStatus';
export type {
  AiCliCheck,
  AiCliCheckAccepted,
  AiCliCheckLatestItem,
  AiCliCheckLatestList,
  AiCliCheckPage,
  AiCliCheckRequest,
  AiCliCheckTrigger,
  AiEngineCheckView,
  AuthStatusViewResult,
  FirstRunAiEngineState,
  StatusChipView,
} from './model/aiEngineStatus';
export { AiToolStatusPanel } from './components/AiToolStatusPanel/AiToolStatusPanel';
export {
  FIRST_RUN_AI_ENGINE_PATH,
  FirstRunAiEngineItem,
} from './components/FirstRunAiEngineItem/FirstRunAiEngineItem';
export type { FirstRunAiEngineItemProps } from './components/FirstRunAiEngineItem/FirstRunAiEngineItem';
export {
  FIRST_RUN_PANEL_ID,
  FirstRunChecklistPanel,
} from './components/FirstRunChecklistPanel/FirstRunChecklistPanel';
