/**
 * thumbnails 도메인(OpenAPI 태그 `thumbnails`)의 공개 API. 밖에서는 `@/features/thumbnails`로만 가져온다.
 * P3-01: 원본 이미지 목록(listCandidateSourceImages)·레퍼런스 저장(putThumbnailReferences)·프롬프트 미리보기
 * (createThumbnailPromptPreview) 훅과 표시 규칙(model/thumbnails). P3-02가 생성·G3 훅을 더한다.
 */
export { THUMBNAILS_TAG_KEY, thumbnailKeys } from './api/queryKeys';
export {
  useCandidateSourceImagesQuery,
  usePutThumbnailReferencesMutation,
  useThumbnailPromptPreviewMutation,
} from './api/thumbnails';
export {
  blockedTermsText,
  DEFAULT_FACE_OPTION,
  FACE_GROUP_LABEL,
  FACE_OPTION_LABEL,
  FACE_OPTIONS,
  GENERATE_LABEL,
  GENERATE_NEEDS_REFERENCES_REASON,
  GENERATE_NO_RUN_REASON,
  GENERATE_NOT_ALLOWED_REASON,
  GENERATE_NOT_WAITING_REASON,
  GENERATE_PREVIEW_PENDING_REASON,
  generateDisabledReason,
  GENERATION_OPTIONS_TITLE,
  imageCaption,
  NO_PERSON_CAPTION,
  NO_PERSON_LABEL,
  NO_REAL_PERSON_TEXT,
  NOT_WAITING_REFERENCE_REASON,
  PICK_REFERENCE_FIRST_REASON,
  PROMPT_ADJUSTED_META,
  PROMPT_ADJUSTMENT_LABEL,
  PROMPT_ADJUSTMENT_MAX,
  PROMPT_DEFAULT_META,
  PROMPT_TITLE,
  REFERENCE_CHECKBOX_LABEL,
  REFERENCE_LIMIT_REASON,
  REFERENCE_MAX,
  REFERENCE_ONLY_LABEL,
  referencesRequest,
  sameSelection,
  SOURCE_IMAGES_EMPTY_TEXT,
  SOURCE_IMAGES_LOADING_TEXT,
  SOURCE_IMAGES_NOTE,
  SOURCE_IMAGES_TITLE,
  sourceLineText,
  toggleReference,
} from './model/thumbnails';
export type {
  GenerateState,
  SourceSection,
  ThumbnailFaceOption,
  ThumbnailPromptPreview,
  ThumbnailPromptPreviewRequest,
  ThumbnailReferencesRequest,
  ThumbnailReferencesResult,
  ThumbnailSourceImage,
  ThumbnailSourceImageList,
} from './model/thumbnails';
