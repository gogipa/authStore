import type { paths } from '@/shared/api/schema';
import { DEMO_TEXT } from '@/features/guide';
import { API_BASE_URL, type ApiError } from '@/shared/api/client';
import type { DemoWorld } from './demoWorld';
import { DemoHttpError, candidateNotFound } from './world/errors';
import { fillShop } from './sample/shop';
import type { Accepted, DemoMethod, Ok, Res, Schema } from './sample/types';

/** 처리 함수가 받는 요청 값 */
export interface RouteContext {
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly request: Request;
  readonly world: DemoWorld;
  /** 요청 본문(JSON). 없거나 읽지 못하면 빈 객체 */
  json<T>(): Promise<Partial<T>>;
}

/** 처리 함수 결과: 성공 본문(경로의 성공 상태 JSON) 또는 직접 만든 응답(204·오류) */
export type Handler<Body> = (context: RouteContext) => Body | Response | Promise<Body | Response>;

/** 예시가 없다(404 `DEMO_NOT_AVAILABLE`, `unknownRequests`에 남김) */
export const NOT_AVAILABLE = Symbol('not-available');
/** 실행하지 않는다(403 `DEMO_READ_ONLY`, `readOnlyRequests`에 남김) — 같은 경로라도 본문에 따라 따라 하기 밖이면 */
export const READ_ONLY = Symbol('read-only');
export type Refusal = typeof NOT_AVAILABLE | typeof READ_ONLY;

type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface DemoRoute {
  readonly method: RouteMethod;
  readonly template: string;
  readonly segments: readonly string[];
  /** 고정 조각 수(여러 경로가 맞으면 많은 쪽 — '/candidates/status-counts'가 '/candidates/{candidateId}'보다 먼저) */
  readonly staticCount: number;
  /** 본문을 돌려줄 때의 상태(조회 200, 만듦 201, 접수 202, 본문 없음 204) */
  readonly status: 200 | 201 | 202 | 204;
  readonly handle: Handler<unknown>;
  /**
   * 상태를 바꾸지 않는 계산 POST(`read`). 성공해도 실패해도 모델 변경 알림(`world.changed()`)을 하지 않는다 — 화면이 조회(query)처럼
   * 부르는 POST(사전 검증)가 자기 응답 때문에 다시 읽혀 끝없이 되풀이되지 않게 한다.
   */
  readonly pure?: true;
}

export function route(
  method: DemoMethod,
  template: keyof paths,
  status: DemoRoute['status'],
  handle: Handler<unknown>,
): DemoRoute {
  const segments = template.split('/').filter(Boolean);
  return {
    method: method.toUpperCase() as RouteMethod,
    template,
    segments,
    staticCount: segments.filter((s) => !s.startsWith('{')).length,
    status,
    handle,
  };
}

/** 조회(GET 200) */
export const get = <P extends keyof paths>(template: P, handle: Handler<Ok<P> | Refusal>) =>
  route('get', template, 200, handle);

/** 상태를 바꾸지 않는 계산 POST(화면이 조회처럼 부른다) */
export const read = <P extends keyof paths>(
  template: P,
  handle: Handler<Ok<P, 'post'> | Refusal>,
): DemoRoute => ({ ...route('post', template, 200, handle), pure: true });

/**
 * 화면을 열 때 스스로 부르는 접수 POST(202). 결과는 나중에 이벤트로 온다. 따라 하기 밖 변형이면 처리 함수가 `READ_ONLY`를 준다
 */
export const accept = <P extends keyof paths>(
  template: P,
  handle: Handler<Accepted<P> | Refusal>,
) => route('post', template, 202, handle);

/** 상태를 바꾸는 라우트(따라 하기에서 누르는 버튼). `S`는 성공 상태 — 응답 본문은 그 상태의 05-2 타입 */
export const post = <P extends keyof paths, S extends 200 | 201 | 202>(
  template: P,
  status: S,
  handle: Handler<Res<P, 'post', S> | Refusal>,
) => route('post', template, status, handle);

export const put = <P extends keyof paths, S extends 200 | 201 | 202>(
  template: P,
  status: S,
  handle: Handler<Res<P, 'put', S> | Refusal>,
) => route('put', template, status, handle);

export const patch = <P extends keyof paths, S extends 200 | 202>(
  template: P,
  status: S,
  handle: Handler<Res<P, 'patch', S> | Refusal>,
) => route('patch', template, status, handle);

/** DELETE(204 본문 없음) */
export const del = <P extends keyof paths>(template: P, handle: Handler<void | Refusal>) =>
  route('delete', template, 204, async (context) => {
    const result = await handle(context);
    return result === undefined ? new Response(null, { status: 204 }) : result;
  });

export function matchRoute(
  candidate: DemoRoute,
  segments: readonly string[],
): Record<string, string> | null {
  if (candidate.segments.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i += 1) {
    const expected = candidate.segments[i]!;
    const actual = segments[i]!;
    if (expected.startsWith('{')) params[expected.slice(1, -1)] = decodeURIComponent(actual);
    else if (expected !== actual) return null;
  }
  return params;
}

/** 경로 조각 → 맞는 경로(고정 조각이 많은 쪽 먼저) */
export function findRoute(
  routes: readonly DemoRoute[],
  method: string,
  segments: readonly string[],
) {
  let best: { route: DemoRoute; params: Record<string, string> } | null = null;
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const params = matchRoute(candidate, segments);
    if (params && (!best || candidate.staticCount > best.route.staticCount)) {
      best = { route: candidate, params };
    }
  }
  return best;
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  path: string,
  extra: Partial<ApiError> = {},
): Response {
  const body: ApiError = {
    code,
    message,
    status,
    timestamp: new Date().toISOString(),
    path: `${API_BASE_URL}${path}`,
    ...extra,
  };
  return Response.json(body, { status });
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface Dispatcher {
  /** 요청 하나에 답한다 */
  handle(request: Request): Promise<Response>;
  /** 404 'unknown' 봉투로 답한 요청('GET /path' — /api/v1 뒤 경로, 쿼리 없음) */
  readonly unknownRequests: readonly string[];
  /** 403 따라 하기 밖(`DEMO_READ_ONLY`)으로 답한 요청('POST /path') */
  readonly readOnlyRequests: readonly string[];
  /** 모델이 던진 예상 밖 오류(DemoHttpError가 아닌 것)로 500을 준 요청 — 테스트가 비어 있어야 한다 */
  readonly serverErrors: readonly string[];
}

/**
 * 요청 → 라우트 → 모델 → 응답(D-32). 같은 모델(`world`) 하나만 읽고 쓴다.
 * - 표에 없는 GET: 404 `DEMO_NOT_AVAILABLE`(`unknownRequests`) / 표에 없는 POST·PUT·PATCH·DELETE: 403 `DEMO_READ_ONLY`(`readOnlyRequests`)
 * - `{candidateId}`가 만들어 둔 예시 여정이 아니면 실제 BE처럼 404 `CANDIDATE_NOT_FOUND`
 * - 모델이 `DemoHttpError`를 던지면 실제 BE와 같은 오류 봉투로 답한다
 * - 상태를 바꾸는 요청이 성공하면 모델의 변경 알림(`world.changed()`)을 한 번 부른다
 */
export function createDispatcher(routes: readonly DemoRoute[], world: DemoWorld): Dispatcher {
  const unknownRequests: string[] = [];
  const readOnlyRequests: string[] = [];
  const serverErrors: string[] = [];

  const handle = async (request: Request): Promise<Response> => {
    const method = request.method.toUpperCase();
    const url = new URL(request.url);
    const path = url.pathname.startsWith(API_BASE_URL)
      ? url.pathname.slice(API_BASE_URL.length) || '/'
      : url.pathname;
    const segments = path.split('/').filter(Boolean);
    const found = findRoute(routes, method, segments);

    const readOnly = () => {
      readOnlyRequests.push(`${method} ${path}`);
      return errorResponse(403, 'DEMO_READ_ONLY', DEMO_TEXT.readOnly, path);
    };
    const notAvailable = () => {
      unknownRequests.push(`${method} ${path}`);
      return errorResponse(404, 'DEMO_NOT_AVAILABLE', DEMO_TEXT.notAvailable, path);
    };
    if (!found) return STATE_CHANGING.has(method) ? readOnly() : notAvailable();

    const { route: matched, params } = found;
    try {
      if (params.candidateId !== undefined && !world.hasCandidate(params.candidateId)) {
        throw candidateNotFound();
      }
      const context: RouteContext = {
        params,
        query: url.searchParams,
        request,
        world,
        json: async <T>() => {
          try {
            return ((await request.clone().json()) ?? {}) as Partial<T>;
          } catch {
            return {};
          }
        },
      };
      const result = await matched.handle(context);
      if (result === NOT_AVAILABLE) return notAvailable();
      if (result === READ_ONLY) return readOnly();
      if (STATE_CHANGING.has(method) && !matched.pure) world.changed();
      if (result instanceof Response) return result;
      // fixture 자리표시자([내 상호] 등)를 예시 가게 값으로(sample/shop)
      return new Response(fillShop(JSON.stringify(result)), {
        status: matched.status,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      if (error instanceof DemoHttpError) {
        // 실패한 요청도 상태를 바꿨을 수 있다(예: 시작은 했지만 거절) — 화면이 다시 읽게
        if (STATE_CHANGING.has(method) && !matched.pure) world.changed();
        const extra: Partial<ApiError> = {};
        if (error.extra.fieldErrors) extra.fieldErrors = error.extra.fieldErrors;
        if (error.extra.details) extra.details = error.extra.details;
        return errorResponse(error.status, error.code, error.message, path, extra);
      }
      serverErrors.push(
        `${method} ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return errorResponse(
        500,
        'INTERNAL_ERROR',
        '체험 모델에서 예상하지 못한 오류가 났습니다.',
        path,
      );
    }
  };

  return { handle, unknownRequests, readOnlyRequests, serverErrors };
}

export type { Schema };
