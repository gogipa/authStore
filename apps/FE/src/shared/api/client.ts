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

/** 앱 전체가 함께 쓰는 API 클라이언트. 개발에서는 Vite 프록시가 /api를 BE(127.0.0.1:3100)로 넘긴다. */
export const api = createApiClient();

/** 응답 본문이 05-3 오류 봉투 모양인지 확인한다. */
export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === 'string' && typeof v.message === 'string' && typeof v.status === 'number'
  );
}
