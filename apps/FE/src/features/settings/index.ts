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

/**
 * P1-09: 구매대행 프로필(getPurchaseAgencyProfile·replacePurchaseAgencyProfile)과 발송 택배사 코드 목록
 * (listDispatchDeliveryCompanies). 설정 화면의 '구매대행 프로필' 탭과 머리의 '되돌리기'·'저장'이 쓴다.
 */
export {
  purchaseAgencyProfileQueryKey,
  usePurchaseAgencyProfileQuery,
  useReplacePurchaseAgencyProfileMutation,
} from './api/purchaseAgencyProfile';
export {
  dispatchDeliveryCompaniesQueryKey,
  useDispatchDeliveryCompaniesQuery,
} from './api/dispatchDeliveryCompanies';
export {
  formErrorsOf,
  NOTICE_REFER_TO_DETAIL_KEYS,
  NOTICE_WARRANTY_KEY,
  PROFILE_INPUT_KEYS,
  saveResultText,
  toProfileFormValues,
  toProfileInput,
} from './model/profileForm';
export type {
  DispatchDeliveryCompany,
  ProfileFormErrors,
  ProfileFormField,
  ProfileFormValues,
  PurchaseAgencyProfile,
  PurchaseAgencyProfileAddressWarning,
  PurchaseAgencyProfileInput,
  PurchaseAgencyProfileSaveResult,
} from './model/profileForm';
export { usePurchaseAgencyProfileForm } from './model/usePurchaseAgencyProfileForm';
export type { PurchaseAgencyProfileFormState } from './model/usePurchaseAgencyProfileForm';
export {
  IMPORTER_MISSING_TEXT,
  PurchaseAgencyProfileForm,
  SYSTEM_META_SYNC_PATH,
} from './components/PurchaseAgencyProfileForm/PurchaseAgencyProfileForm';
