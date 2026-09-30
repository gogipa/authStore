import { EXTERNAL_TARGETS } from '../http/external-targets.js';

/**
 * 라쿠텐 상품 이미지 받기 포트(P3-01 F-TH-01, Proposed — 열린질문 P1-01·P3-01). thumbnails 모듈이 이 포트로만 원본 이미지를
 * 받는다.
 * - 관문 target=RAKUTEN_IMAGE: 허용 호스트는 이미지 CDN(tshop.r10s.jp·image.rakuten.co.jp·thumbnail.image.rakuten.co.jp)뿐,
 *   직렬 큐·1초 간격·앱 고유 UA·보내기 직전 call_log 1행. 하루 페이지 조회 상한(RAKUTEN_PAGE 110)에 넣지 않고, 공개 정적
 *   파일이라 24시간 쉼도 없다(비공식 수집이 아니다)
 * - 리다이렉트는 허용 호스트 안에서만 `RAKUTEN_IMAGE_MAX_REDIRECTS`번까지 따라간다(홉마다 call_log 1행)
 * - 본문은 바이트 그대로 준다. 형식 판별·저장은 부르는 쪽(thumbnails `SourceImageDownloader`)이 한다
 * - 테스트는 `overrideProvider(RAKUTEN_IMAGE_PORT)`로 fixture 어댑터를 끼우거나, 가짜 fetch(HTTP_FETCH) 뒤에 fixture를 둔다
 */
export const RAKUTEN_IMAGE_PORT = Symbol('RAKUTEN_IMAGE_PORT');

export interface RakutenImageResponse {
  httpStatus: number;
  /** 받은 바이트 그대로 */
  bytes: Buffer;
  /** 응답을 받은 시각(image_asset.collected_at) */
  fetchedAt: Date;
  callLogId: number;
  /** 리다이렉트를 따라간 뒤 마지막 주소(없으면 요청 주소) */
  finalUrl: string;
}

export interface RakutenImageCallContext {
  candidateId?: number | null;
  stepRunId?: number | null;
}

export interface RakutenImagePort {
  fetchImage(url: string, ctx?: RakutenImageCallContext): Promise<RakutenImageResponse>;
}

/** 리다이렉트를 따라가는 최대 횟수(허용 호스트 안에서만, Proposed) */
export const RAKUTEN_IMAGE_MAX_REDIRECTS = 2;

/** 받을 이미지 한 장의 최대 크기(바이트, Proposed). 넘으면 그 이미지를 쓰지 않는다 */
export const RAKUTEN_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * API 이미지 URL `_ex` 대체 크기(P3-01 Proposed — 문서에 없음, M0 S2에서 실측으로 다시 본다). 페이지 JSON `media.images[]`가
 * 비었을 때 Item Search `mediumImageUrls`(`…?_ex=128x128`)의 `_ex` 값을 이 크기로 키워 받는다.
 */
export const RAKUTEN_API_IMAGE_EX_SIZE = '1200x1200';

/** https이고 호스트가 RAKUTEN_IMAGE 허용 목록 안인가(관문에 보내기 전 거르기) */
export function isRakutenImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      u.username === '' &&
      u.password === '' &&
      (u.port === '' || u.port === '443') &&
      EXTERNAL_TARGETS.RAKUTEN_IMAGE.hosts.includes(u.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

/**
 * API 이미지 URL의 `_ex`(썸네일 크기) 값을 키운다(없으면 더한다). http는 https로 바꾼다. URL이 아니면 null.
 * 예: `https://thumbnail.image.rakuten.co.jp/@0_mall/shop-a/cabinet/a_1.jpg?_ex=128x128` → `…?_ex=1200x1200`
 */
export function enlargeApiImageUrl(
  url: string,
  size: string = RAKUTEN_API_IMAGE_EX_SIZE,
): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol === 'http:') u.protocol = 'https:';
  u.searchParams.set('_ex', size);
  return u.toString();
}

/**
 * Item Search 응답 한 건(원문 `raw`)의 이미지 URL. formatVersion 2(글자 배열)와 1(`{ imageUrl }` 배열)을 모두 읽는다.
 * `mediumImageUrls`를 먼저, 없으면 `smallImageUrls`를 쓴다(순서 유지, 빈 값·겹침 제외).
 */
export function apiImageUrlsOf(raw: Record<string, unknown>): string[] {
  const read = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .map((v) =>
            typeof v === 'string'
              ? v
              : v &&
                  typeof v === 'object' &&
                  typeof (v as { imageUrl?: unknown }).imageUrl === 'string'
                ? (v as { imageUrl: string }).imageUrl
                : null,
          )
          .filter((v): v is string => !!v)
      : [];
  const medium = read(raw.mediumImageUrls);
  const urls = medium.length > 0 ? medium : read(raw.smallImageUrls);
  return [...new Set(urls)];
}
