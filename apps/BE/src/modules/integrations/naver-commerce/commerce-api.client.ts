import { Inject, Injectable } from '@nestjs/common';
import {
  COMMERCE_API_BASE_URL,
  COMMERCE_AUTHN_ERROR_CODE,
  COMMERCE_AUTHN_RETRY_LIMIT,
  COMMERCE_IP_NOT_ALLOWED_CODE,
  COMMERCE_TRACE_HEADER,
} from './commerce-endpoints.js';
import {
  type CommerceErrorBody,
  commerceErrorCode,
  parseCommerceErrorBody,
} from './commerce-error.js';
import { type CommerceAccessToken, CommerceTokenService } from './commerce-token.service.js';
import {
  COMMERCE_TRANSPORT,
  type CommerceHttpMethod,
  type CommerceHttpResponse,
  type CommerceTransport,
} from './commerce-transport.port.js';

type QueryValue = string | number | boolean | null | undefined;

export interface CommerceRequestOptions {
  /** 쿼리(값이 null·undefined면 뺀다. 배열은 같은 이름을 여러 번) */
  query?: Readonly<Record<string, QueryValue | readonly QueryValue[]>>;
  /** JSON 본문(`application/json`) */
  json?: unknown;
  /** form 본문(`application/x-www-form-urlencoded`) */
  form?: Readonly<Record<string, string | number | boolean>>;
  /** multipart 본문(이미지 업로드, P4-01). 경계(boundary)는 fetch가 붙인다 */
  multipart?: FormData;
  /** 더 붙일 헤더(Authorization·Content-Type은 클라이언트가 정한다) */
  headers?: Readonly<Record<string, string>>;
  candidateId?: number | null;
  stepRunId?: number | null;
  timeoutMs?: number;
  /**
   * 401 `GW.AUTHN` 뒤 토큰을 다시 받아 원 요청을 한 번 더 보낼지(기본 true). P4-03 상품 등록(`POST /v2/products`)은 false —
   * 등록 요청은 자동으로 다시 보내지 않는다(멱등 규칙, Proposed). false면 401이 곧바로 502 `COMMERCE_AUTH_FAILED`다
   */
  authnRetry?: boolean;
}

/** 응답 한 건. 2xx가 아니어도 돌려준다(인증 실패만 예외) */
export interface CommerceApiResponse<T = unknown> {
  status: number;
  ok: boolean;
  headers: Headers;
  /** 본문 원문 */
  body: Buffer;
  /** 2xx이고 JSON이면 해석한 값, 아니면 null */
  data: T | null;
  /** 2xx가 아니면 오류 본문(`code`·`message`·`invalidInputs`) */
  error: CommerceErrorBody | null;
  /** `GNCP-GW-Trace-ID`(없으면 본문 traceId) */
  traceId: string | null;
  callLogId: number | null;
  /** 401 `GW.AUTHN` 뒤 토큰을 다시 받아 다시 보냈는지 */
  retriedAfterReissue: boolean;
}

/** 경로 + 쿼리 → 완성 URL. 경로는 `/`로 시작한다(`/v1/categories`) */
export function buildCommerceUrl(path: string, query?: CommerceRequestOptions['query']): string {
  if (!path.startsWith('/')) throw new Error(`커머스API 경로는 '/'로 시작해야 합니다: ${path}`);
  const url = new URL(`${COMMERCE_API_BASE_URL}${path}`);
  for (const [name, raw] of Object.entries(query ?? {})) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values as QueryValue[]) {
      if (v === null || v === undefined) continue;
      url.searchParams.append(name, String(v));
    }
  }
  return url.toString();
}

function encodeBody(options: CommerceRequestOptions): {
  body?: string | FormData;
  contentType?: string;
} {
  const kinds = [options.json !== undefined, !!options.form, !!options.multipart].filter(Boolean);
  if (kinds.length > 1) throw new Error('json·form·multipart 중 하나만 보낼 수 있습니다.');
  if (options.json !== undefined) {
    return { body: JSON.stringify(options.json), contentType: 'application/json; charset=utf-8' };
  }
  if (options.form) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.form)) params.append(k, String(v));
    return { body: params.toString(), contentType: 'application/x-www-form-urlencoded' };
  }
  if (options.multipart) return { body: options.multipart };
  return {};
}

function parseJson(body: Buffer): unknown {
  if (body.length === 0) return null;
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

/**
 * 커머스API 클라이언트(P1-07). P1-08(메타 동기화)·P4-01(이미지 업로드)·P4-03(등록)은 이것만 쓴다.
 * - 토큰을 받아 `Authorization: Bearer`를 붙인다(토큰 값은 이 파일 밖으로 나가지 않는다).
 * - 401 `GW.AUTHN`(또는 코드 없는 401)이면 토큰을 다시 받아 원 요청을 한 번 다시 보낸다(Proposed 1회).
 *   다시 보낸 것도 401이면 멈추고 SSE `auth.failed` 1건 + 502 `COMMERCE_AUTH_FAILED`.
 * - 403 `GW.IP_NOT_ALLOWED`도 인증 실패로 본다(재발급해도 같다, Proposed): SSE `auth.failed` + 502.
 * - 그 밖의 2xx가 아닌 응답은 던지지 않고 `error`(code·message·invalidInputs)와 함께 돌려준다.
 * - 연결 실패·응답 없음은 502 `EXTERNAL_API_ERROR`(관문이 던진다).
 */
@Injectable()
export class CommerceApiClient {
  constructor(
    private readonly tokens: CommerceTokenService,
    @Inject(COMMERCE_TRANSPORT) private readonly transport: CommerceTransport,
  ) {}

  async request<T = unknown>(
    method: CommerceHttpMethod,
    path: string,
    options: CommerceRequestOptions = {},
  ): Promise<CommerceApiResponse<T>> {
    const url = buildCommerceUrl(path, options.query);
    const { body, contentType } = encodeBody(options);
    let token = await this.tokens.getToken();
    let res = await this.send(method, url, token, body, contentType, options);
    let retried = false;
    const retryLimit = options.authnRetry === false ? 0 : COMMERCE_AUTHN_RETRY_LIMIT;
    for (let attempt = 0; attempt < retryLimit && isAuthnRejected(res); attempt++) {
      token = await this.tokens.reissue(token);
      res = await this.send(method, url, token, body, contentType, options);
      retried = true;
    }
    if (isAuthnRejected(res)) {
      this.tokens.discard(token);
      throw this.authFailure(res);
    }
    if (isIpNotAllowed(res)) throw this.authFailure(res);
    return toApiResponse<T>(res, retried);
  }

  private send(
    method: CommerceHttpMethod,
    url: string,
    token: CommerceAccessToken,
    body: string | FormData | undefined,
    contentType: string | undefined,
    options: CommerceRequestOptions,
  ): Promise<CommerceHttpResponse> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
      Authorization: token.authorizationHeader(),
    };
    if (contentType) headers['Content-Type'] = contentType;
    return this.transport.send(
      { method, url, headers, body, timeoutMs: options.timeoutMs },
      { candidateId: options.candidateId, stepRunId: options.stepRunId },
    );
  }

  private authFailure(res: CommerceHttpResponse) {
    const error = parseCommerceErrorBody(res.body);
    return this.tokens.reportAuthFailure({
      httpStatus: res.status,
      errorCode: commerceErrorCode(res.status, error),
      traceId: res.headers.get(COMMERCE_TRACE_HEADER) ?? error.traceId,
    });
  }
}

function isAuthnRejected(res: CommerceHttpResponse): boolean {
  if (res.status !== 401) return false;
  const code = parseCommerceErrorBody(res.body).code;
  return code === null || code === COMMERCE_AUTHN_ERROR_CODE;
}

function isIpNotAllowed(res: CommerceHttpResponse): boolean {
  return (
    res.status === 403 && parseCommerceErrorBody(res.body).code === COMMERCE_IP_NOT_ALLOWED_CODE
  );
}

function toApiResponse<T>(res: CommerceHttpResponse, retried: boolean): CommerceApiResponse<T> {
  const ok = res.status >= 200 && res.status < 300;
  const error = ok ? null : parseCommerceErrorBody(res.body);
  return {
    status: res.status,
    ok,
    headers: res.headers,
    body: res.body,
    data: ok ? (parseJson(res.body) as T | null) : null,
    error,
    traceId: res.headers.get(COMMERCE_TRACE_HEADER) ?? error?.traceId ?? null,
    callLogId: res.callLogId,
    retriedAfterReissue: retried,
  };
}
