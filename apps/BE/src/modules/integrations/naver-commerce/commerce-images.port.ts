/**
 * 커머스API 상품 이미지 업로드 포트(P4-01 — PRD §8.7 등록 호출 순서 4, RG-05, F-AP-01·03). ⑧ registration 모듈이 이것으로만
 * 이미지를 올린다. 올려도 스토어에는 노출되지 않는다(상품 등록 요청이 이 URL을 쓸 때만 보인다).
 * - `uploadProductImages(files)`: `POST /v1/product-images/upload`, multipart 필드 `imageFiles`(파일마다 한 부분, 보낸 순서) →
 *   받은 `shop-phinf` URL 배열(보낸 파일 순서와 같다고 가정 — M0 S3 전, 어댑터 주석·fixture)과 응답 헤더 `GNCP-GW-Trace-ID`.
 * - 한 번에 최대 10장·합계 10MB 미만(F-AP-03)은 부르는 쪽(`upload-batcher`)이 나눈다. 이 포트는 받은 묶음을 그대로 보낸다.
 * P1-07 `CommerceApiClient`(토큰은 `Authorization` 헤더에만·401 재발급)와 P1-01 관문(`call_log.target=COMMERCE_API`)을 지난다.
 * 실패: 2xx가 아닌 응답·모양이 다른 200·URL 수가 파일 수와 다름 → 502 `EXTERNAL_API_ERROR`(`details.reason` =
 * `HTTP_<상태>`·`INVALID_RESPONSE`·`URL_COUNT_MISMATCH`), 연결 실패·응답 없음 → 관문이 502 `EXTERNAL_API_ERROR`(TIMEOUT·
 * NETWORK_ERROR), 키 없음 → 409 `SECRET_NOT_CONFIGURED`, 인증 실패 → 502 `COMMERCE_AUTH_FAILED`(토큰 서비스).
 */
export const COMMERCE_IMAGES_PORT = Symbol('COMMERCE_IMAGES_PORT');

/** 상품 이미지 업로드 경로 */
export const COMMERCE_PRODUCT_IMAGES_UPLOAD_PATH = '/v1/product-images/upload';
/** multipart 필드 이름(파일마다 같은 이름으로 한 부분) */
export const COMMERCE_UPLOAD_FIELD = 'imageFiles';
/** 업로드 응답 대기(한 묶음 최대 10MB — 기본 30초보다 넉넉히, Proposed) */
export const COMMERCE_UPLOAD_TIMEOUT_MS = 60_000;

/** 올릴 파일 한 장(정규화한 1000×1000 JPEG) */
export interface CommerceUploadFile {
  /** multipart 파일 이름(로컬 경로가 아니다 — 예 `upload-1.jpg`) */
  fileName: string;
  mimeType: 'image/jpeg';
  bytes: Buffer;
}

/** 한 묶음 업로드 결과 */
export interface CommerceUploadResult {
  /** 보낸 파일 순서와 같은 순서의 shop-phinf URL */
  urls: string[];
  /** 응답 헤더 `GNCP-GW-Trace-ID`(없으면 본문 traceId, 그것도 없으면 null) */
  traceId: string | null;
}

/** 호출 기록 문맥(call_log.candidate_id·step_run_id) */
export interface CommerceImagesCallContext {
  candidateId?: number | null;
  stepRunId?: number | null;
}

export interface CommerceImagesPort {
  /** 파일 1~10장을 한 번에 올린다(빈 목록이면 부르지 않고 urls [] ) */
  uploadProductImages(
    files: readonly CommerceUploadFile[],
    context?: CommerceImagesCallContext,
  ): Promise<CommerceUploadResult>;
}
