/**
 * tags 도메인(OpenAPI 태그 `tags`)의 공개 API. 밖에서는 `@/features/tags`로만 가져온다(P3-05).
 * ⑦ 산출물(getCandidateTagSet)·경쟁 태그 입력 목록(listTagCompetitorInputs)·입력 저장(createTagCompetitorInput — JSON·FormData)·
 * 입력 빼기(removeTagCompetitorInput) 훅, 최종 태그 부품(RemovableTag)과 후보표·뺀 태그·입력 표시 규칙(model/tags).
 * 태그 추가·삭제는 `@/features/step-engine`의 `useOwnerEdit`(TAGS EDIT 202)를 쓴다.
 */
export { TAGS_TAG_KEY, tagsKeys } from './api/queryKeys';
export {
  useCreateTagCompetitorInputMutation,
  useRemoveTagCompetitorInputMutation,
  useTagCompetitorInputsQuery,
  useTagSetQuery,
} from './api/tags';
export { RemovableTag } from './components/RemovableTag/RemovableTag';
export type { RemovableTagProps } from './components/RemovableTag/RemovableTag';
export {
  ADD_BUTTON_LABEL,
  ADD_TAG_LABEL,
  ADD_TAG_PLACEHOLDER,
  addTagDisabledReason,
  ADVANCED_TITLE,
  BLOCK_418_NOTICE,
  BROWSER_BUTTON_LABEL,
  BROWSER_LABEL,
  CANDIDATE_STATE_LABEL,
  candidateCounts,
  candidateRows,
  CANDIDATES_TITLE,
  candidatesSummaryText,
  candidateState,
  CATEGORY_UNDECIDED_LABEL,
  COMPETITOR_CAPTION,
  COMPETITOR_TITLE,
  DICTIONARY_NOTE,
  DICTIONARY_UNREGISTERED_LABEL,
  EXCLUDED_CAPTION,
  EXCLUDED_EMPTY_TEXT,
  EXCLUDED_TITLE,
  excludedReasonText,
  excludedSourceText,
  excludedTags,
  FINAL_FULL_REASON,
  FINAL_NOTE,
  FINAL_TAG_LIMIT,
  FINAL_TITLE,
  finalCountText,
  FREE_TEXT_BUTTON_LABEL,
  FREE_TEXT_LABEL,
  FREE_TEXT_PLACEHOLDER,
  inputSummaryText,
  INPUTS_TITLE,
  leafName,
  NEXT_APPROVAL_LABEL,
  normalizeTag,
  PASTE_BUTTON_LABEL,
  PASTE_LABEL,
  PASTE_PLACEHOLDER,
  SELECTION_ORDER_TEXT,
  sourceText,
  sourceTypeText,
  TAGS_EMPTY_TEXT,
  TAGS_NOT_EDITABLE_REASON,
  TAGS_RUNNING_REASON,
  tagsSourceText,
  UPLOAD_CAPTION,
  UPLOAD_LABEL,
} from './model/tags';
export type {
  CandidateFilter,
  CandidateState,
  CompetitorInputSubmit,
  CompetitorSourceType,
  FinalTagItem,
  TagCandidateItem,
  TagCompetitorInputCreated,
  TagCompetitorInputItem,
  TagOwnerEditItem,
  TagSetOutput,
} from './model/tags';
