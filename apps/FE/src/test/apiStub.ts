import { vi } from 'vitest';
import { api, createApiClient, type ApiError } from '@/shared/api/client';

/**
 * 훅·화면 테스트용 API 가짜.
 *
 * 방법(Proposed, 06-3 §9): 앱이 쓰는 `api`의 메서드를 `vi.spyOn`으로 바꾸되, 바꾼 자리에서 **가짜 fetch를 넣은
 * 진짜 openapi-fetch 클라이언트**를 부른다. 그래서 경로 조립·JSON 해석·오류 봉투 처리(unwrap)는 실제 코드 그대로
 * 돌고, 서버 응답만 표(`'GET /call-usage'` → 처리 함수)로 정한다. 표에 없는 요청은 501 봉투로 답한다.
 * `vitest.config.ts`의 restoreMocks가 테스트마다 원래 메서드로 되돌린다.
 */
export type StubHandler = (request: Request) => Response | Promise<Response>;
export type StubRoutes = Record<string, StubHandler>;

export interface ApiStub {
  /** 가짜가 받은 요청(순서대로). */
  readonly requests: Request[];
  /** 경로 처리 함수를 더하거나 바꾼다. 키는 `'<METHOD> <경로>'`(경로는 /api/v1 뒤, 쿼리 제외). */
  on(route: string, handler: StubHandler): void;
}

const STUB_BASE_URL = 'http://127.0.0.1:5173/api/v1';

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** 05-3 오류 봉투 응답. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  extra: Partial<ApiError> = {},
): Response {
  const envelope: ApiError = {
    code,
    message,
    status,
    timestamp: '2026-09-27T14:02:11+09:00',
    path: '/api/v1',
    ...extra,
  };
  return Response.json(envelope, { status });
}

export function stubApi(routes: StubRoutes = {}): ApiStub {
  const table = new Map<string, StubHandler>(Object.entries(routes));
  const requests: Request[] = [];

  const fakeFetch = async (input: Request): Promise<Response> => {
    requests.push(input);
    const path = new URL(input.url).pathname.replace(/^\/api\/v1/, '');
    const key = `${input.method.toUpperCase()} ${path}`;
    const handler = table.get(key);
    if (!handler) {
      return errorResponse(501, 'STUB_NOT_DEFINED', `가짜 API에 ${key}가 없습니다.`, {
        path: `/api/v1${path}`,
      });
    }
    return handler(input);
  };

  const fake = createApiClient({ baseUrl: STUB_BASE_URL, fetch: fakeFetch as typeof fetch });
  vi.spyOn(api, 'GET').mockImplementation(fake.GET);
  vi.spyOn(api, 'POST').mockImplementation(fake.POST);
  vi.spyOn(api, 'PUT').mockImplementation(fake.PUT);
  vi.spyOn(api, 'PATCH').mockImplementation(fake.PATCH);
  vi.spyOn(api, 'DELETE').mockImplementation(fake.DELETE);

  return {
    requests,
    on(route, handler) {
      table.set(route, handler);
    },
  };
}
