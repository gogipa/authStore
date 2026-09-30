import type { Clock } from '../http/clock.token.js';
import type {
  CommerceApiClient,
  CommerceApiResponse,
} from '../naver-commerce/commerce-api.client.js';
import {
  RATE_LIMIT_BACKOFF_MS,
  RATE_LIMIT_DEFAULT_WAIT_MS,
  RATE_LIMIT_ERROR_CODE,
  RATE_LIMIT_HEADERS,
  RATE_LIMIT_MAX_WAIT_MS,
} from './commerce-meta.constants.js';

export type MetaQuery = Readonly<Record<string, string | number | boolean>>;

export interface MetaGetOptions {
  /** 이 상태면 오류가 아니라 null을 준다(원산지 하위 목록 없음 등) */
  emptyStatuses?: readonly number[];
}

/**
 * 동기화기가 쓰는 커머스API 읽기 창구. 호출은 하나씩 차례로(await) 하고, 2xx JSON만 돌려준다.
 * 2xx가 아니면(429 재시도 뒤) `MetaFetchError`를 던진다.
 */
export interface MetaApi {
  get(path: string, query?: MetaQuery, options?: MetaGetOptions): Promise<unknown>;
}

/** 커머스API가 2xx가 아닌 응답을 줬거나 읽을 수 없는 응답을 줬다(비밀 없음) */
export class MetaFetchError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
    readonly errorCode: string | null,
    readonly path: string,
  ) {
    super(message);
    this.name = 'MetaFetchError';
  }
}

function headerNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** 남은 토큰이 0 이하면 다음 호출 전에 쉴 시간(ms). 아니면 0 */
export function rateLimitPauseMs(headers: Headers): number {
  const remaining = headerNumber(headers, RATE_LIMIT_HEADERS.REMAINING);
  if (remaining === null || remaining > 0) return 0;
  const rate = headerNumber(headers, RATE_LIMIT_HEADERS.REPLENISH_RATE);
  if (rate === null || rate <= 0) return RATE_LIMIT_DEFAULT_WAIT_MS;
  return Math.min(RATE_LIMIT_MAX_WAIT_MS, Math.ceil(1000 / rate));
}

/** 429 뒤 다시 보내기 전 기다릴 시간(ms). Retry-After(초)가 있으면 그것, 없으면 1·2·4초 */
export function retryAfterMs(headers: Headers, attempt: number): number {
  const seconds = headerNumber(headers, 'Retry-After');
  if (seconds !== null && seconds >= 0) return Math.min(RATE_LIMIT_MAX_WAIT_MS, seconds * 1000);
  return RATE_LIMIT_BACKOFF_MS[Math.min(attempt, RATE_LIMIT_BACKOFF_MS.length - 1)]!;
}

function describe(res: CommerceApiResponse): string {
  const parts = [`HTTP ${res.status}`];
  if (res.error?.code) parts.push(res.error.code);
  if (res.error?.message) parts.push(res.error.message.slice(0, 200));
  return parts.join(' · ');
}

/**
 * P1-07 `CommerceApiClient`(토큰·401 재발급·call_log) 위의 메타 읽기(규칙 15).
 * - 응답의 `GNCP-GW-RateLimit-Remaining`이 0 이하면 다음 호출 전에 쉰다.
 * - 429(`GW.RATE_LIMIT`)면 기다렸다가 같은 요청을 다시 보낸다(최대 `RATE_LIMIT_BACKOFF_MS.length`번).
 * - 인증 실패(502 COMMERCE_AUTH_FAILED)·키 없음(409)·키체인(503)·연결 실패(502)는 클라이언트가 던진 그대로 올린다.
 */
export class CommerceMetaApi implements MetaApi {
  private pauseMs = 0;

  constructor(
    private readonly client: CommerceApiClient,
    private readonly clock: Clock,
  ) {}

  async get(path: string, query?: MetaQuery, options: MetaGetOptions = {}): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      if (this.pauseMs > 0) {
        await this.clock.sleep(this.pauseMs);
        this.pauseMs = 0;
      }
      const res = await this.client.request('GET', path, { query });
      this.pauseMs = rateLimitPauseMs(res.headers);
      if (res.status === 429) {
        if (attempt < RATE_LIMIT_BACKOFF_MS.length) {
          this.pauseMs = Math.max(this.pauseMs, retryAfterMs(res.headers, attempt));
          continue;
        }
        throw new MetaFetchError(
          `커머스API 호출 한도에 걸렸습니다(${describe(res)}). 잠시 뒤 다시 동기화해 주세요.`,
          res.status,
          res.error?.code ?? RATE_LIMIT_ERROR_CODE,
          path,
        );
      }
      if (options.emptyStatuses?.includes(res.status)) return null;
      if (!res.ok) {
        throw new MetaFetchError(
          `커머스API 응답 오류(${describe(res)})`,
          res.status,
          res.error?.code ?? null,
          path,
        );
      }
      if (res.data === null) {
        throw new MetaFetchError(
          `커머스API 응답을 읽을 수 없습니다(HTTP ${res.status} · JSON 아님).`,
          res.status,
          null,
          path,
        );
      }
      return res.data;
    }
  }
}
