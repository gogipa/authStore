import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema';

/** 05-3 오류 봉투: { code, message, status, timestamp, path, fieldErrors, details } */
export type ApiError = components['schemas']['ErrorResponse'];
export type ApiFieldError = components['schemas']['FieldError'];

export const API_BASE_URL = '/api/v1';
export const CLIENT_HEADER = 'X-AutoStore-Client';
type ClientHeaderName = typeof CLIENT_HEADER;

type HttpMethodKey = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace';

/**
 * 05-2 명세는 상태를 바꾸는 작업마다 `X-AutoStore-Client` 헤더를 필수 파라미터로 적는다.
 * 이 헤더는 아래 미들웨어가 항상 붙이므로, 호출하는 쪽 타입에서는 빼 준다(호출부에서 헤더를 적지 않는다).
 */
type StripClientHeader<Op> = Op extends { parameters: infer P }
  ? P extends { header: infer H }
    ? ClientHeaderName extends keyof H
      ? Omit<Op, 'parameters'> & {
          parameters: Omit<P, 'header'> & { header?: Omit<H, ClientHeaderName> };
        }
      : Op
    : Op
  : Op;

/** 앱이 쓰는 경로 타입: 생성된 `paths`에서 클라이언트 헤더만 선택 사항으로 바꾼 것. */
export type ApiPaths = {
  [Path in keyof paths]: {
    [K in keyof paths[Path]]: K extends HttpMethodKey
      ? StripClientHeader<paths[Path][K]>
      : paths[Path][K];
  };
};

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 상태를 바꾸는 요청(POST·PUT·PATCH·DELETE)에 `X-AutoStore-Client: 1`을 붙인다.
 * BE는 이 헤더가 없으면 403 CLIENT_HEADER_REQUIRED로 막는다(05-1 §1 로컬 보안).
 * 읽기 요청(GET 등)에는 붙이지 않는다.
 */
export const clientHeaderMiddleware: Middleware = {
  onRequest({ request }) {
    if (STATE_CHANGING_METHODS.has(request.method.toUpperCase())) {
      request.headers.set(CLIENT_HEADER, '1');
    }
    return request;
  },
};

export function createApiClient(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
  const client = createClient<ApiPaths>({
    baseUrl: options.baseUrl ?? API_BASE_URL,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  client.use(clientHeaderMiddleware);
  return client;
}

/** openapi-fetch가 부르는 모양(요청 하나 → 응답) */
export type ApiFetch = (request: Request) => Promise<Response>;

/**
 * 체험(`/demo`, D-31)이 앱을 켤 때 한 번 바꾸는 것. 보통 앱은 바꾸지 않는다(기본은 브라우저 fetch·BE 이미지 주소).
 * 화면·훅은 모두 아래 `api` 하나를 쓰므로(102곳), 공급자로 클라이언트를 바꾸는 대신 그 클라이언트의 **전송**만 바꾼다.
 * 체험은 늘 새 탭(전체 페이지 로드)으로 열려 한 페이지 안에 실제 앱과 체험이 섞이지 않는다(app/demo).
 */
export interface ApiRuntime {
  /** `api`의 모든 요청이 이 함수로 간다(체험: 메모리 안 예시 — 네트워크를 쓰지 않는다) */
  fetch: ApiFetch;
  /** 이미지 파일 주소(체험: 앱에 묶은 예시 그림) */
  imageAssetFileUrl: (imageAssetId: number) => string;
}

let runtime: ApiRuntime | null = null;

/**
 * `/api/v1`을 지금 화면 출처의 절대 주소로(브라우저에서는 상대 주소와 같은 곳). 요청 객체(Request)를 만드는 곳이 상대 주소를
 * 풀지 못하는 환경(Node 테스트)에서도 체험 앱이 그대로 돈다. 출처를 모르면 상대 주소 그대로.
 */
function sameOriginApiBaseUrl(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  return origin && origin !== 'null' ? `${origin}${API_BASE_URL}` : API_BASE_URL;
}

/** 체험 앱이 켤 때 부른다. 돌려준 함수로 되돌린다(테스트). */
export function installApiRuntime(next: ApiRuntime): () => void {
  runtime = next;
  return () => {
    if (runtime === next) runtime = null;
  };
}

/**
 * 앱 전체가 함께 쓰는 API 클라이언트. 개발에서는 Vite 프록시가 /api를 BE(127.0.0.1:3100)로 넘긴다.
 * 전송은 부를 때마다 고른다: 체험이면 `installApiRuntime`이 넣은 함수, 아니면 그때의 `globalThis.fetch`.
 */
export const api = createApiClient({
  baseUrl: sameOriginApiBaseUrl(),
  fetch: ((request: Request) =>
    runtime ? runtime.fetch(request) : globalThis.fetch(request)) as typeof fetch,
});

/**
 * 이미지 파일 경로(05-2 getImageAssetFile — 로컬 파일을 같은 출처로 받는다. 외부 주소(shop-phinf·라쿠텐)를 부르지 않는다).
 * 체험이면 앱에 묶은 예시 그림 주소다(`/api`를 부르지 않는다).
 */
export function imageAssetFileUrl(imageAssetId: number): string {
  return runtime
    ? runtime.imageAssetFileUrl(imageAssetId)
    : `${API_BASE_URL}/image-assets/${imageAssetId}/file`;
}

/** 응답 본문이 05-3 오류 봉투 모양인지 확인한다. */
export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === 'string' && typeof v.message === 'string' && typeof v.status === 'number'
  );
}
