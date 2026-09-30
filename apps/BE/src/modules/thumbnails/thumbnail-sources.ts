import { INPUT_KEYS } from '../step-engine/domain/input-keys.js';

/**
 * ⑤ 썸네일 상수(P3-01 Proposed — 문서에 코드 이름이 없다).
 * - 입력 대기 이유 `THUMBNAIL_REFERENCE_REQUIRED`: 원본을 받은 ⑤가 레퍼런스 선택(과 P3-02 생성·G3 선택)을 기다린다.
 *   `pendingInputs` = `owner.referenceSelection`
 * - 실행 기록 코드(HTTP 오류 표 밖): 원본을 하나도 받지 못함 `SOURCE_IMAGES_NOT_FOUND`, 이미지 HTTP 실패
 *   `RAKUTEN_IMAGE_HTTP_<상태>`. 관문 오류(`EXTERNAL_API_ERROR`·`EXTERNAL_CALL_COOLDOWN`·`EXTERNAL_REQUEST_NOT_ALLOWED`)와
 *   라쿠텐 API 오류 코드는 그대로 남긴다(모두 failure_kind EXTERNAL_API)
 */
export const THUMBNAIL_WAITING_REASON = 'THUMBNAIL_REFERENCE_REQUIRED';
export const THUMBNAIL_PENDING_INPUT = INPUT_KEYS.ownerReferenceSelection;

/** 레퍼런스 장수(IM-03, F-TH-04: 1~3장) */
export const REFERENCE_MIN = 1;
export const REFERENCE_MAX = 3;

/** 원본 목록 최대 장수(05-2 ThumbnailSourceImageList.items maxItems) */
export const SOURCE_IMAGE_LIST_MAX = 40;

/** ⑤ 한 번에 받는 상품 이미지 최대 장수(05-1 §2.6 '1~20장', Proposed — 넘으면 앞 20장만) */
export const SOURCE_IMAGE_DOWNLOAD_MAX = 20;

/** 레퍼런스 저장·생성 중 판단의 작업 이름(05-3 ALREADY_IN_PROGRESS `details.job`) */
export const GENERATION_JOB = 'GENERATION';
