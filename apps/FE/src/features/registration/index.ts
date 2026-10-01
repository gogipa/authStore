/**
 * registration 도메인(OpenAPI 태그 `registration`)의 공개 API. 밖에서는 `@/features/registration`으로만 가져온다(P4-01 — 첫 사용).
 * ⑧ 업로드 산출물 훅(getCandidateUploadResult)과 표시 규칙(model/upload). ⑧ 실행은 `@/features/step-engine`의 `useStartStepRun`
 * (`stepCode=UPLOAD`)을 쓴다. 승인 미리보기·사전 검증·등록(P4-02·P4-03)이 여기에 더한다.
 */
export { REGISTRATION_TAG_KEY, registrationKeys } from './api/queryKeys';
export { useUploadResultQuery } from './api/useUploadResultQuery';
export {
  UPLOAD_EMPTY_TEXT,
  UPLOAD_NOTE,
  UPLOAD_ROLE_LABEL,
  UPLOAD_SOURCE_TEXT,
  UPLOAD_TITLE,
  UPLOADED_IMAGES_TITLE,
  uploadImageAlt,
  uploadImageFileUrl,
  uploadImagesCaption,
} from './model/upload';
export type { UploadResultImageItem, UploadResultOutput } from './model/upload';
