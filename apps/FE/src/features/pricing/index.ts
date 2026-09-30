/**
 * pricing 도메인(OpenAPI 태그 `pricing`)의 공개 API. 밖에서는 `@/features/pricing`로만 가져온다.
 * P2-04: 환율 최신값·경고(getLatestFxRates)·이력(listFxRates)·직접 입력(createManualFxRate).
 * SCR-10 설정 '환율' 탭·요약과 SCR-04 ③(P2-05)이 `FxRateSummary`·`FxRateManualForm`을 같이 쓴다.
 */
export {
  fxRatesKeys,
  useCreateManualFxRateMutation,
  useFxRatesQuery,
  useLatestFxRatesQuery,
} from './api/fxRates';
export type { FxRatesParams } from './api/fxRates';
export {
  applyManualFxChange,
  FX_CURRENCY_LABEL,
  FX_FALLBACK_TEXT,
  FX_KIND_LABEL,
  FX_SERIES,
  FX_SERIES_LABEL,
  FX_SOURCE_LABEL,
  FX_SOURCE_SHORT,
  formatPerUnitRate,
  formatRecordRate,
  fxAutoCaption,
  fxSeriesKey,
  fxSummaryLabel,
  fxSummaryLine,
  fxTabCaption,
  kstDateTimeLocal,
  latestOf,
  manualFxDefaults,
  manualFxErrorsOf,
  perUnitRate,
  toManualFxInput,
  unitLabel,
  validateManualFx,
} from './model/fx';
export type {
  FxCurrency,
  FxRateKind,
  FxRateLatestSet,
  FxRateManualInput,
  FxRatePage,
  FxRateRecord,
  FxRateSource,
  FxRateWarning,
  FxSeriesKey,
  FxUnit,
  ManualFxErrors,
  ManualFxField,
  ManualFxFormValues,
} from './model/fx';
export { FxRateSummary } from './components/FxRateSummary/FxRateSummary';
export type { FxRateSummaryProps } from './components/FxRateSummary/FxRateSummary';
export { FxRateManualForm } from './components/FxRateManualForm/FxRateManualForm';
export type { FxRateManualFormProps } from './components/FxRateManualForm/FxRateManualForm';
