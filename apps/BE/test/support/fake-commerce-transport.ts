/**
 * 가짜 커머스API 서버(P1-07). 실제 커머스API를 부르지 않는다.
 * - 받은 요청을 기록하고(`requests`), 줄 세운 fixture 응답을 차례로 돌려준다(없으면 기본 응답).
 * - 막힘(`block()` → `release()`)·연결 오류(`failNext()`) 모드가 있다.
 * 두 가지로 끼운다.
 * - 단위 테스트: `CommerceTransport`로 바로(`new CommerceTokenService(store, fake, clock, events)`).
 * - e2e: `fetchHandler`를 가짜 fetch(HTTP_FETCH)의 handler로. 그러면 실제 관문(허용 목록·UA·call_log)을 지난다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMERCE_TOKEN_PATH } from '../../src/modules/integrations/naver-commerce/commerce-endpoints.js';
import type {
  CommerceHttpRequest,
  CommerceHttpResponse,
  CommerceTransport,
} from '../../src/modules/integrations/naver-commerce/commerce-transport.port.js';

const AUTH_FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'commerce', 'auth');

export type CommerceAuthFixtureName =
  | 'token-200'
  | 'token-401-authn'
  | 'token-403-ip-not-allowed'
  | 'token-403-dormant'
  | 'token-403-store-suspended'
  | 'token-400-invalid-client'
  | 'token-400-bad-timestamp'
  | 'token-503-unavailable'
  | 'api-200-ok'
  | 'api-401-authn'
  | 'api-400-invalid-inputs';

export interface CommerceFixture {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export function commerceAuthFixture(name: CommerceAuthFixtureName): CommerceFixture {
  return JSON.parse(readFileSync(join(AUTH_FIXTURES, `${name}.json`), 'utf8')) as CommerceFixture;
}

export interface SignatureVector {
  clientId: string;
  clientSecret: string;
  timestamp: number;
  expectedSign: string;
  source: string;
}

export function signatureVector(): SignatureVector {
  return JSON.parse(
    readFileSync(join(AUTH_FIXTURES, 'signature-vector.json'), 'utf8'),
  ) as SignatureVector;
}

/** fixture의 가짜 토큰 문자열(누출 검사용) */
export const FAKE_ACCESS_TOKEN = (commerceAuthFixture('token-200').body as { access_token: string })
  .access_token;

export interface RecordedCommerceRequest {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  /** 문자열 본문(form·JSON). FormData는 null */
  body: string | null;
  contentType: string | null;
  /** multipart 본문(FormData — P4-01 이미지 업로드). 그 밖은 null */
  form: FormData | null;
}

type Responder =
  CommerceAuthFixtureName | CommerceFixture | ((req: RecordedCommerceRequest) => CommerceFixture);

function headerMap(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export class FakeCommerceTransport implements CommerceTransport {
  readonly requests: RecordedCommerceRequest[] = [];
  private readonly queue: Responder[] = [];
  private blocked: Promise<void> | null = null;
  private releaseBlocked: (() => void) | null = null;
  private failures: Error[] = [];
  /** 줄이 비었을 때: 토큰 경로는 token-200, 그 밖은 api-200-ok */
  defaultResponder: (req: RecordedCommerceRequest) => CommerceFixture = (req) =>
    commerceAuthFixture(req.path.endsWith(COMMERCE_TOKEN_PATH) ? 'token-200' : 'api-200-ok');

  /** 다음 응답들을 차례로 정한다 */
  respondWith(...responders: Responder[]): this {
    this.queue.push(...responders);
    return this;
  }

  /** 다음 요청 하나를 연결 오류로(기본 TypeError('fetch failed')) */
  failNext(error: Error = new TypeError('fetch failed')): this {
    this.failures.push(error);
    return this;
  }

  /** 이후 요청을 release() 전까지 붙잡는다(동시 요청 검사) */
  block(): this {
    this.blocked = new Promise((resolve) => {
      this.releaseBlocked = resolve;
    });
    return this;
  }

  release(): void {
    this.releaseBlocked?.();
    this.blocked = null;
    this.releaseBlocked = null;
  }

  reset(): void {
    this.requests.length = 0;
    this.queue.length = 0;
    this.failures = [];
    this.release();
  }

  get tokenRequests(): RecordedCommerceRequest[] {
    return this.requests.filter((r) => r.path.endsWith(COMMERCE_TOKEN_PATH));
  }

  get apiRequests(): RecordedCommerceRequest[] {
    return this.requests.filter((r) => !r.path.endsWith(COMMERCE_TOKEN_PATH));
  }

  /** CommerceTransport(단위 테스트) */
  async send(req: CommerceHttpRequest): Promise<CommerceHttpResponse> {
    const fixture = await this.handle(req.method, req.url, req.headers, req.body);
    return {
      status: fixture.status,
      headers: new Headers(fixture.headers),
      body: Buffer.from(JSON.stringify(fixture.body)),
      callLogId: null,
    };
  }

  /** 가짜 fetch(HTTP_FETCH)의 handler(e2e). 관문이 call_log를 남긴다 */
  readonly fetchHandler = async (url: string, init: RequestInit): Promise<Response> => {
    const fixture = await this.handle(
      init.method ?? 'GET',
      url,
      headerMap(init.headers),
      init.body as CommerceHttpRequest['body'],
    );
    return new Response(JSON.stringify(fixture.body), {
      status: fixture.status,
      headers: { 'Content-Type': 'application/json', ...fixture.headers },
    });
  };

  private async handle(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: CommerceHttpRequest['body'],
  ): Promise<CommerceFixture> {
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
    const recorded: RecordedCommerceRequest = {
      method: method.toUpperCase(),
      url,
      path: new URL(url).pathname,
      headers: lower,
      body:
        typeof body === 'string'
          ? body
          : body instanceof Uint8Array
            ? Buffer.from(body).toString('utf8')
            : null,
      contentType: lower['content-type'] ?? null,
      form: body instanceof FormData ? body : null,
    };
    this.requests.push(recorded);
    if (this.blocked) await this.blocked;
    const failure = this.failures.shift();
    if (failure) throw failure;
    const next = this.queue.shift();
    if (next === undefined) return this.defaultResponder(recorded);
    if (typeof next === 'string') return commerceAuthFixture(next);
    if (typeof next === 'function') return next(recorded);
    return next;
  }
}
