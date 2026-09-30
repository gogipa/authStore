import { inspect } from 'node:util';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import {
  COMMERCE_SECRET_KEYS,
  type CommerceSecretKey,
  secretKeysLabel,
} from '../../../common/secrets/secret-keys.js';
import { registerKnownSecret, SECRET_MASK } from '../../../common/secrets/secret-mask.js';
import { SECRET_STORE, type SecretStore } from '../../../common/secrets/secret-store.port.js';
import { CLOCK, type Clock } from '../http/clock.token.js';
import { EXTERNAL_TARGETS } from '../http/external-targets.js';
import {
  CLIENT_SECRET_FORMAT_INVALID,
  classifyCommerceAuthCause,
  type CommerceAuthCauseCategory,
  commerceAuthFailed,
} from './commerce-auth-cause.js';
import {
  COMMERCE_API_BASE_URL,
  COMMERCE_TOKEN_DEFAULT_TTL_SECONDS,
  COMMERCE_TOKEN_PATH,
  COMMERCE_TOKEN_REFRESH_BEFORE_MS,
  COMMERCE_TRACE_HEADER,
} from './commerce-endpoints.js';
import { commerceErrorCode, parseCommerceErrorBody } from './commerce-error.js';
import { buildTokenRequestForm, isBcryptSalt, signClientSecret } from './commerce-signature.js';
import {
  COMMERCE_TRANSPORT,
  type CommerceHttpResponse,
  type CommerceTransport,
} from './commerce-transport.port.js';

/**
 * 받은 토큰(메모리에만). 값은 JS private 필드에 두고 `toString`·`toJSON`·`inspect`는 가린 모양만 준다.
 * 값을 쓰는 곳은 `authorizationHeader()` 하나(CommerceApiClient가 Bearer 헤더로 붙인다).
 */
export class CommerceAccessToken {
  readonly #value: string;

  constructor(
    value: string,
    readonly issuedAt: Date,
    readonly expiresAt: Date,
    /** 이 시각부터 쓰기 전에 새로 받는다(만료 30분 전) */
    readonly refreshAt: Date,
  ) {
    this.#value = value;
  }

  authorizationHeader(): string {
    return `Bearer ${this.#value}`;
  }

  toString(): string {
    return `CommerceAccessToken(${SECRET_MASK})`;
  }

  toJSON(): Record<string, string> {
    return {
      value: SECRET_MASK,
      issuedAt: this.issuedAt.toISOString(),
      expiresAt: this.expiresAt.toISOString(),
    };
  }

  [inspect.custom](): string {
    return this.toString();
  }
}

/** 토큰 상태(값 없음). GET /auth-status가 쓴다 */
export interface CommerceTokenStatus {
  /** 메모리 캐시의 토큰이 있고 만료 전 */
  tokenValid: boolean;
  issuedAt: Date | null;
  expiresAt: Date | null;
  refreshAt: Date | null;
}

interface ParsedTokenResponse {
  accessToken: string;
  expiresInSeconds: number;
}

function parseTokenResponse(body: Buffer): ParsedTokenResponse | null {
  try {
    const o = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    const token = o?.access_token;
    if (typeof token !== 'string' || token.length === 0) return null;
    const raw = o.expires_in;
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    const expiresInSeconds = Number.isFinite(n) && n > 0 ? n : COMMERCE_TOKEN_DEFAULT_TTL_SECONDS;
    return { accessToken: token, expiresInSeconds };
  } catch {
    return null;
  }
}

/**
 * 커머스API 토큰 발급·캐시·갱신(F-BS-46·47, PRD §8.7 RG-01).
 * - 발급: `POST {base}/v1/oauth2/token`, form 다섯 필드(`type=SELF`, `account_id` 없음), bcrypt 서명.
 * - 캐시: BE 메모리에만 둔다(DB·파일·로그에 쓰지 않는다, Proposed — 05-1 §1.2 '키체인'과 달리 05-2를 따름).
 *   BE를 다시 켜면 첫 호출 때 새로 받는다.
 * - 갱신: 쓰기 전에 남은 시간이 30분 이하면 새로 받는다(14:00 발급 → 16:30부터, 만료 17:00).
 *   미리 받기가 실패해도 기존 토큰이 만료 전이면 그것을 쓴다(R04 A7 '기존 토큰은 만료 전까지 쓸 수 있다').
 * - 동시에 여러 요청이 와도 발급은 한 번만(single-flight, Proposed).
 * - 발급이 실패하면 SSE `auth.failed`를 보내고 409·502·503을 던진다(아래 `issue` 설명).
 * 토큰 값을 꺼내는 함수는 두지 않는다. `getToken()`은 가린 객체(`CommerceAccessToken`)를 준다.
 * P1-08·P4-01·P4-03은 이 서비스를 직접 쓰지 않고 CommerceApiClient만 쓴다.
 */
@Injectable()
export class CommerceTokenService {
  private readonly logger = new Logger(CommerceTokenService.name);
  private cached: CommerceAccessToken | null = null;
  private inflight: Promise<CommerceAccessToken> | null = null;
  /** invalidate()마다 늘린다. 그 전에 시작한 발급 결과는 캐시에 넣지 않는다 */
  private generation = 0;

  constructor(
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(COMMERCE_TRANSPORT) private readonly transport: CommerceTransport,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly events: ProgressEventsService,
  ) {}

  /** 쓸 토큰. 없거나 30분 이하로 남았으면 새로 받는다 */
  async getToken(): Promise<CommerceAccessToken> {
    const cached = this.cached;
    if (cached && this.clock.now() < cached.refreshAt) return cached;
    try {
      return await this.issueShared();
    } catch (e) {
      if (cached && this.cached === cached && this.clock.now() < cached.expiresAt) {
        this.logger.warn('토큰 미리 받기에 실패해 만료 전 기존 토큰을 씁니다.');
        return cached;
      }
      throw e;
    }
  }

  /**
   * 캐시와 상관없이 한 번 새로 받는다(POST /auth-checks). 이미 받는 중이면 그 결과를 같이 쓴다.
   * 실패하면 기존 토큰(만료 전이면)은 그대로 둔다.
   */
  async forceRefresh(): Promise<CommerceTokenStatus> {
    await this.issueShared();
    return this.status();
  }

  /** 401 `GW.AUTHN`을 받은 토큰을 버리고 새로 받는다. 다른 요청이 이미 새 토큰을 받았으면 그것을 준다 */
  async reissue(rejected: CommerceAccessToken): Promise<CommerceAccessToken> {
    if (this.cached === rejected) this.cached = null;
    const current = this.cached;
    if (current && this.clock.now() < current.expiresAt) return current;
    return this.issueShared();
  }

  /** 이 토큰이 캐시에 있으면 버린다(재발급 뒤에도 거절된 토큰) */
  discard(token: CommerceAccessToken): void {
    if (this.cached === token) this.cached = null;
  }

  /** 캐시를 비운다(커머스 키를 바꿨을 때, 05-2 saveSecret). 진행 중인 발급 결과도 버린다 */
  invalidate(): void {
    this.cached = null;
    this.inflight = null;
    this.generation += 1;
  }

  status(): CommerceTokenStatus {
    const token = this.cached;
    if (!token || this.clock.now() >= token.expiresAt) {
      return { tokenValid: false, issuedAt: null, expiresAt: null, refreshAt: null };
    }
    return {
      tokenValid: true,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
      refreshAt: token.refreshAt,
    };
  }

  /**
   * 인증 실패를 알린다: SSE `auth.failed` 1건 + 던질 `COMMERCE_AUTH_FAILED`(재발급까지 실패, 05-1 §3).
   * CommerceApiClient가 재발급 뒤에도 401 `GW.AUTHN`이거나 403 `GW.IP_NOT_ALLOWED`일 때 부른다.
   */
  reportAuthFailure(input: {
    httpStatus: number | null;
    errorCode: string;
    traceId: string | null;
  }): ApiException {
    const causeCategory = classifyCommerceAuthCause(input.httpStatus, input.errorCode);
    this.publishAuthFailed(input.errorCode, causeCategory);
    return commerceAuthFailed({ causeCategory, ...input });
  }

  private issueShared(): Promise<CommerceAccessToken> {
    if (this.inflight) return this.inflight;
    const generation = this.generation;
    const run = this.issue().then((token) => {
      if (generation === this.generation) this.cached = token;
      return token;
    });
    const tracked = run.finally(() => {
      if (this.inflight === tracked) this.inflight = null;
    });
    this.inflight = tracked;
    return tracked;
  }

  /**
   * 토큰을 한 번 받는다.
   * - 키가 없으면 409 `SECRET_NOT_CONFIGURED`(details.secretKeys), 키체인 오류는 503 `KEYCHAIN_UNAVAILABLE`(알림 없음).
   * - 발급 거절(4xx, 429 제외)은 502 `COMMERCE_AUTH_FAILED`(details.causeCategory).
   * - 응답 없음·연결 오류·429·5xx·읽을 수 없는 200은 502 `EXTERNAL_API_ERROR`(details.target·reason·traceId, Proposed).
   * - 발급 호출이 실패하면(위 두 502) SSE `auth.failed`를 보낸다.
   */
  private async issue(): Promise<CommerceAccessToken> {
    const { clientId, clientSecret } = await this.readCredentials();
    if (!isBcryptSalt(clientSecret)) {
      throw this.reportAuthFailure({
        httpStatus: null,
        errorCode: CLIENT_SECRET_FORMAT_INVALID,
        traceId: null,
      });
    }
    const timestampMs = this.clock.now().getTime();
    let clientSecretSign: string;
    try {
      clientSecretSign = signClientSecret(clientId, clientSecret, timestampMs);
    } catch {
      throw this.reportAuthFailure({
        httpStatus: null,
        errorCode: CLIENT_SECRET_FORMAT_INVALID,
        traceId: null,
      });
    }
    registerKnownSecret(clientSecretSign);

    let res: CommerceHttpResponse;
    try {
      res = await this.transport.send({
        method: 'POST',
        url: `${COMMERCE_API_BASE_URL}${COMMERCE_TOKEN_PATH}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildTokenRequestForm({ clientId, timestampMs, clientSecretSign }),
      });
    } catch (e) {
      const error = toTransportError(e);
      if (error.code === 'EXTERNAL_API_ERROR') {
        const reason = (error.details as { reason?: unknown } | undefined)?.reason;
        this.publishAuthFailed(typeof reason === 'string' ? reason : 'NETWORK_ERROR', 'UNKNOWN');
      }
      throw error;
    }

    const traceId = res.headers.get(COMMERCE_TRACE_HEADER);
    if (res.status >= 200 && res.status < 300) {
      const parsed = parseTokenResponse(res.body);
      if (!parsed) {
        this.publishAuthFailed('INVALID_TOKEN_RESPONSE', 'UNKNOWN');
        throw externalApiError('INVALID_RESPONSE', '응답 형식 오류', res.status, traceId);
      }
      registerKnownSecret(parsed.accessToken);
      const issuedAt = this.clock.now();
      const ttlMs = parsed.expiresInSeconds * 1000;
      const expiresAt = new Date(issuedAt.getTime() + ttlMs);
      // 유효 시간이 30분보다 짧게 오면(규격상 없음) 절반 지점에서 새로 받는다
      const refreshAt = new Date(
        ttlMs > COMMERCE_TOKEN_REFRESH_BEFORE_MS
          ? expiresAt.getTime() - COMMERCE_TOKEN_REFRESH_BEFORE_MS
          : issuedAt.getTime() + ttlMs / 2,
      );
      return new CommerceAccessToken(parsed.accessToken, issuedAt, expiresAt, refreshAt);
    }

    const errorCode = commerceErrorCode(res.status, parseCommerceErrorBody(res.body));
    if (res.status === 429 || res.status >= 500) {
      this.publishAuthFailed(errorCode, classifyCommerceAuthCause(res.status, errorCode));
      throw res.status === 429
        ? externalApiError('RATE_LIMITED', `요청 과다, HTTP ${res.status}`, res.status, traceId)
        : externalApiError('SERVER_ERROR', `서버 오류, HTTP ${res.status}`, res.status, traceId);
    }
    throw this.reportAuthFailure({ httpStatus: res.status, errorCode, traceId });
  }

  private async readCredentials(): Promise<{ clientId: string; clientSecret: string }> {
    const values = await Promise.all(COMMERCE_SECRET_KEYS.map((key) => this.secrets.get(key)));
    const missing: CommerceSecretKey[] = COMMERCE_SECRET_KEYS.filter((_, i) => !values[i]);
    if (missing.length > 0) {
      throw new ApiException('SECRET_NOT_CONFIGURED', {
        message: formatErrorMessage('SECRET_NOT_CONFIGURED', {
          '키 이름': secretKeysLabel(missing),
        }),
        details: { secretKeys: missing },
      });
    }
    return { clientId: values[0]!, clientSecret: values[1]! };
  }

  private publishAuthFailed(errorCode: string, causeCategory: CommerceAuthCauseCategory): void {
    try {
      this.events.publish('auth.failed', {
        target: 'COMMERCE_API',
        errorCode: errorCode.slice(0, 100),
        causeCategory,
        occurredAt: this.clock.now().toISOString(),
      });
    } catch (e) {
      this.logger.warn(`auth.failed 발행에 실패했습니다: ${e instanceof Error ? e.name : 'Error'}`);
    }
  }
}

/** 502 `EXTERNAL_API_ERROR`(details.target·reason·httpStatus·traceId) */
function externalApiError(
  reason: string,
  label: string,
  httpStatus: number | null,
  traceId: string | null,
): ApiException {
  return new ApiException('EXTERNAL_API_ERROR', {
    message: formatErrorMessage('EXTERNAL_API_ERROR', {
      대상: EXTERNAL_TARGETS.COMMERCE_API.label,
      사유: label,
    }),
    details: { target: 'COMMERCE_API', reason, httpStatus, traceId },
  });
}

/** 전송이 던진 예외: ApiException은 그대로(관문의 502·409·500), 그 밖은 연결 실패 502로 */
function toTransportError(e: unknown): ApiException {
  if (e instanceof ApiException) {
    if (e.code === 'EXTERNAL_API_ERROR' && e.details && !('traceId' in e.details)) {
      return new ApiException('EXTERNAL_API_ERROR', {
        message: e.message,
        details: { ...e.details, traceId: null },
      });
    }
    return e;
  }
  const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
  return externalApiError(
    timeout ? 'TIMEOUT' : 'NETWORK_ERROR',
    timeout ? '응답 시간 초과' : '연결 실패',
    null,
    null,
  );
}
