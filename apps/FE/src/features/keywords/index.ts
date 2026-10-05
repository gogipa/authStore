/**
 * keywords 도메인(OpenAPI 태그 `keywords`)의 공개 API. 밖에서는 `@/features/keywords`로만 가져온다.
 * P2-01: 연산 10개 훅(queryKey `['keywords', operationId, params]`), 데이터랩 수집 진행 알림 구독, 화면 문구·기간 계산.
 * 한글 키워드 → 일본어 검색어(`useConvertKeywordToRakutenQueryMutation`, F-BS-70)는 [이 검색어로 소싱]을 누를 때 키워드 화면이 쓴다.
 * 여정 만들기(createCandidate)·단계 실행(startCandidateStepRun)은 `@/features/step-engine`에 있다.
 */
export {
  KEYWORDS_TAG_KEY,
  keywordsKeys,
  useAddChildKeywordTermMutation,
  useChildKeywordTermsQuery,
  useConvertKeywordToRakutenQueryMutation,
  useCreateKeywordSnapshotMutation,
  useKeywordCollectionStatusQuery,
  useKeywordSnapshotQuery,
  useKeywordSnapshotsQuery,
  useSelectKeywordMutation,
  useSnapshotKeywordsQuery,
  useUnselectKeywordMutation,
} from './api/queries';
export type { KeywordSnapshotsParams, SnapshotKeywordsParams } from './api/queries';
export { useKeywordCollectionEvents } from './api/useKeywordCollectionEvents';
export type { KeywordCollectionProgress } from './api/useKeywordCollectionEvents';
export {
  ABORT_REASON_LABEL,
  abortMessage,
  abortReasonLabel,
  cidLabel,
  collectDisabledReason,
  collectionStatusLine,
  DATALAB_CID_LABEL,
  DATALAB_CIDS,
  expectedCollectionPeriod,
  isStructureChangeReason,
  pagesPerCidFor,
  snapshotOrigin,
  STRUCTURE_CHANGE_REASONS,
} from './model/keywords';
export type {
  ChildKeywordTerm,
  ChildKeywordTermCreated,
  ChildKeywordTermList,
  DatalabCid,
  KeywordAbortReason,
  KeywordCollectionAbortedEvent,
  KeywordCollectionAccepted,
  KeywordCollectionCompletedEvent,
  KeywordCollectionProgressEvent,
  KeywordCollectionStatus,
  KeywordSnapshot,
  KeywordSnapshotCreateRequest,
  KeywordSnapshotDetail,
  KeywordSnapshotPage,
  RankedKeyword,
  RankedKeywordPage,
  RankLimit,
  SnapshotOrigin,
} from './model/keywords';
