/**
 * pricing 도메인(OpenAPI 태그 `pricing`)의 공개 API. 밖에서는 `@/features/pricing`로만 가져온다.
 * P2-04: 환율 최신값·경고(getLatestFxRates)·이력(listFxRates)·직접 입력(createManualFxRate).
 * SCR-10 설정 '환율' 탭·요약과 SCR-04 ③(P2-05)이 `FxRateSummary`·`FxRateManualForm`을 같이 쓴다.
 * P2-05: ③ 판정 조회(getPriceJudgement)·국내 기준가(createDomesticPrice·listDomesticPrices)·네이버쇼핑 링크
 * (listNaverShoppingLinks) 훅, 판정 표시 규칙(model/judgement), '국내 기준가'·'비용 분해' 패널.
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
export { pricingKeys } from './api/queryKeys';
export { usePriceJudgementQuery } from './api/priceJudgement';
export { useCreateDomesticPriceMutation, useDomesticPricesQuery } from './api/domesticPrices';
export { useNaverShoppingLinksQuery } from './api/naverShoppingLinks';
export {
  breakdownCaption,
  breakdownIsCommon,
  breakdownLines,
  confirmedValuesText,
  costPerUnit,
  dutyFreeLine,
  dutyFreeThresholdUsd,
  judgedWithComparison,
  marginText,
  minimumPriceKrw,
  modeBSentence,
  parseCouponYen,
  parsePriceKrw,
  pctLabel,
  pointsSentence,
  priceRuleLabel,
  rateText,
  sellableSizes,
  sizeTableRows,
  summarySize,
  targetMarginPct,
} from './model/judgement';
export type {
  BreakdownLine,
  DomesticPriceCreated,
  DomesticPriceCreateRequest,
  DomesticPriceEntry,
  DomesticPricePage,
  NaverShoppingLink,
  PriceJudgementDetail,
  PriceJudgementSize,
  PriceJudgementUnjudgedSize,
  SizeTableRow,
  StockLabel,
} from './model/judgement';
export {
  DOMESTIC_PRICE_NOTE,
  DomesticPricePanel,
} from './components/DomesticPricePanel/DomesticPricePanel';
export type { DomesticPricePanelProps } from './components/DomesticPricePanel/DomesticPricePanel';
export { CostBreakdownPanel } from './components/CostBreakdownPanel/CostBreakdownPanel';
export type { CostBreakdownPanelProps } from './components/CostBreakdownPanel/CostBreakdownPanel';
