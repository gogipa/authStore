import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { EXTERNAL_TARGETS } from '../http/external-targets.js';
import { CommerceApiClient } from './commerce-api.client.js';
import {
  COMMERCE_PRODUCT_IMAGES_UPLOAD_PATH,
  COMMERCE_UPLOAD_FIELD,
  COMMERCE_UPLOAD_TIMEOUT_MS,
  type CommerceImagesCallContext,
  type CommerceImagesPort,
  type CommerceUploadFile,
  type CommerceUploadResult,
} from './commerce-images.port.js';

/** uploaded_image.url varchar(500) */
const UPLOAD_URL_MAX = 500;

/**
 * 업로드 응답 본문 → URL 배열(보낸 파일 순서). **M0 S3 전 가정**(fixture `product-images-upload.200.json`):
 * `{ "images": [ { "url": <shop-phinf 주소> }, … ] }` — 배열 순서가 multipart `imageFiles` 부분 순서와 같다.
 * 맨 위가 배열(`[{url}]`·`[<주소 글자>]`)이어도 받는다. https가 아니거나 500자를 넘는 URL, 모양이 다른 원소가 하나라도 있으면
 * null(통째로 읽지 못함). 실측 뒤 이 함수와 fixture만 고친다.
 */
export function uploadUrlsOf(data: unknown): string[] | null {
  const list: unknown = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? (data as Record<string, unknown>).images
      : undefined;
  if (!Array.isArray(list)) return null;
  const urls: string[] = [];
  for (const item of list as unknown[]) {
    const url =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string'
          ? (item as { url: string }).url
          : null;
    if (url === null || !url.startsWith('https://') || url.length > UPLOAD_URL_MAX) return null;
    urls.push(url);
  }
  return urls;
}

function uploadError(
  reason: string,
  label: string,
  httpStatus: number | null,
  traceId: string | null,
) {
  return new ApiException('EXTERNAL_API_ERROR', {
    message: formatErrorMessage('EXTERNAL_API_ERROR', {
      대상: EXTERNAL_TARGETS.COMMERCE_API.label,
      사유: label,
    }),
    details: { target: 'COMMERCE_API', reason, httpStatus, traceId },
  });
}

/** 파일들 → multipart 본문(필드 `imageFiles`를 파일마다 한 번, 보낸 순서). 경계·Content-Type은 fetch가 붙인다 */
export function buildUploadForm(files: readonly CommerceUploadFile[]): FormData {
  const form = new FormData();
  for (const file of files) {
    form.append(
      COMMERCE_UPLOAD_FIELD,
      new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }),
      file.fileName,
    );
  }
  return form;
}

/**
 * 커머스API 상품 이미지 업로드 어댑터(P4-01, `COMMERCE_IMAGES_PORT`). 토큰은 `CommerceApiClient`가 `Authorization` 헤더에만
 * 붙인다(본문·쿼리·로그에 없다). 호출마다 관문이 `call_log`(COMMERCE_API)를 남기고, 응답 헤더 `GNCP-GW-Trace-ID`를 돌려준다
 * (⑧이 `uploaded_image.trace_id`에 저장).
 * 응답 모양(URL 배열과 파일 순서의 대응)은 M0 S3 전이라 `uploadUrlsOf`의 가정을 따른다 — URL 수가 보낸 파일 수와 다르면 어느 파일의
 * URL인지 알 수 없어 502 `EXTERNAL_API_ERROR`(`URL_COUNT_MISMATCH`)로 멈춘다(받은 URL을 저장하지 않는다).
 * 테스트: 단위는 가짜 커머스 서버(`FakeCommerceTransport`)로, e2e는 같은 가짜를 가짜 fetch(HTTP_FETCH) 뒤에 둔다.
 */
@Injectable()
export class CommerceImagesHttpAdapter implements CommerceImagesPort {
  constructor(private readonly client: CommerceApiClient) {}

  async uploadProductImages(
    files: readonly CommerceUploadFile[],
    context: CommerceImagesCallContext = {},
  ): Promise<CommerceUploadResult> {
    if (files.length === 0) return { urls: [], traceId: null };
    const res = await this.client.request('POST', COMMERCE_PRODUCT_IMAGES_UPLOAD_PATH, {
      multipart: buildUploadForm(files),
      candidateId: context.candidateId ?? null,
      stepRunId: context.stepRunId ?? null,
      timeoutMs: COMMERCE_UPLOAD_TIMEOUT_MS,
    });
    if (!res.ok) {
      throw uploadError(`HTTP_${res.status}`, `HTTP ${res.status}`, res.status, res.traceId);
    }
    const urls = uploadUrlsOf(res.data);
    if (urls === null) {
      throw uploadError('INVALID_RESPONSE', '응답 모양이 다름', res.status, res.traceId);
    }
    if (urls.length !== files.length) {
      throw uploadError(
        'URL_COUNT_MISMATCH',
        `받은 주소 ${urls.length}개 · 보낸 파일 ${files.length}개`,
        res.status,
        res.traceId,
      );
    }
    return { urls, traceId: res.traceId };
  }
}
