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
