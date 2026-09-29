/**
 * settings 도메인(OpenAPI 태그 `settings`)의 공개 API. 밖에서는 `@/features/settings`로만 가져온다.
 * P1-03: 현재 설정·검사 결과(getSettings)와 설정 파일 다시 읽기(createSettingsSnapshot).
 * 대시보드의 '설정 파일 검사' 줄(P1-04)도 `useSettingsQuery`를 쓴다.
 */
export { settingsQueryKey, useSettingsQuery } from './api/useSettingsQuery';
export { SETTINGS_TAG_KEY, useReloadSettingsMutation } from './api/useReloadSettingsMutation';
export {
  AI_ENGINE_DISPLAY_NAME,
  readAppliedCostDefaults,
  readSelectedAiEngine,
  readSellTaxableSizes,
  VAT_MODE_LABEL,
} from './model/settingsContent';
export type {
  AiEngineCode,
  AppliedCostDefaults,
  SelectedAiEngine,
  SettingsFieldError,
  SettingsReloadResult,
  SettingsView,
} from './model/settingsContent';
