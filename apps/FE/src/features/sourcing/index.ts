/**
 * sourcing 도메인(OpenAPI 태그 `sourcing`)의 공개 API. 밖에서는 `@/features/sourcing`으로만 가져온다.
 * P2-02: 라쿠텐 검색어 검사·URL 상품 읽기·스냅샷·성인용 상품 확인 훅(queryKey `['sourcing', operationId, params]`),
 * ② 비교표 머리 조회(행 수·성인용 확인 상태), 검색어 칸·URL 붙여넣기 부품, 화면 문구.
 * 비교표·앵커·재고 확인·수동 행·선택은 P2-03이 더한다. 후보 만들기·단계 실행·재조회는 `@/features/step-engine`에 있다.
 */
export {
  SOURCING_TAG_KEY,
  sourcingKeys,
  useConfirmAdultProduct,
  useFetchRakutenItem,
  useRakutenItem,
  useSourcingComparison,
  useValidateRakutenQuery,
} from './api/queries';
export { RAKUTEN_QUERY_CHECK_DELAY_MS, useRakutenQueryCheck } from './api/useRakutenQueryCheck';
export type { RakutenQueryCheck } from './api/useRakutenQueryCheck';
export {
  ADULT_CONFIRM_LABEL,
  adultConfirmationOf,
  adultConfirmDescription,
  CHILD_FILTER_NOTE,
  colorOptionsOf,
  comparisonSummaryText,
  DEFAULT_RAKUTEN_GENRE_ID,
  entryCheckNotice,
  excludedWordsText,
  existingCandidateIdOf,
  queryCheckSummary,
  queryViolationText,
  RAKUTEN_GENRE_NAME,
  RAKUTEN_QUERY_MAX_HALF_WIDTH,
  TABLE_MODE_NOT_READY,
  URL_PASTE_CAPTION,
  URL_PASTE_NOTE,
  URL_PLACEHOLDER,
} from './model/sourcing';
export type {
  AdultConfirmationState,
  AdultProductConfirmation,
  RakutenItemEntryChecks,
  RakutenItemFetchResult,
  RakutenItemSnapshot,
  RakutenQueryValidation,
  RakutenQueryViolation,
  RakutenSkuVariant,
  SourcingComparisonDetail,
  UrlPasteMode,
} from './model/sourcing';
export { RakutenQueryField } from './components/RakutenQueryField/RakutenQueryField';
export type { RakutenQueryFieldProps } from './components/RakutenQueryField/RakutenQueryField';
export { RakutenUrlForm } from './components/RakutenUrlForm/RakutenUrlForm';
export type { RakutenUrlFormProps } from './components/RakutenUrlForm/RakutenUrlForm';
