import { performance } from 'node:perf_hooks';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_VERSION } from '../../../common/config/app-version.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { formatKstDateTime, secondsUntilNextKstMidnight } from '../../../common/time/kst.js';
import { CallUsageService } from '../call-usage/call-usage.service.js';
import { CallLogService } from './call-log.service.js';
import { CLOCK, type Clock } from './clock.token.js';
import { DAILY_LIMIT_PROVIDER, type DailyLimitProvider } from './daily-limit.provider.js';
import {
  type CallLogTarget,
  COOLDOWN_HTTP_STATUSES,
  COOLDOWN_MS,
  EXTERNAL_TARGETS,
  isCallLogTarget,
} from './external-targets.js';
import { HTTP_FETCH, type HttpFetch } from './http-fetch.token.js';

/**
 * 모든 외부 요청에 붙이는 앱 고유 UA(F-BS-08, CON-04). 브라우저로 위장하지 않는다.
 * 형식은 Proposed(06-2 §9): `autoStore/<앱 버전> (local single-seller tool)`.
 * 위장을 막으려고 설정으로 바꿀 수 없게 코드 상수로 둔다.
 */
export const APP_USER_AGENT = `autoStore/${APP_VERSION} (local single-seller tool)`;

/** 기본 응답 대기 시간(Proposed). 넘으면 끊고 TIMEOUT으로 기록한다 */
export const DEFAULT_EXTERNAL_TIMEOUT_MS = 30_000;

/**
 * 호출하는 쪽이 넣을 수 없는 헤더(F-BS-08: 식별 위장·세션 자동화·IP 교체·Origin 주입 금지).
 * Referer는 대상 표의 allowedReferer(DATALAB)만 그 값으로 허용한다.
 */
export const FORBIDDEN_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  'user-agent',
  'origin',
  'cookie',
  'host',
  'forwarded',
  'via',
  'x-real-ip',
  'x-client-ip',
  'client-ip',
  'true-client-ip',
  'proxy-authorization',
  'proxy-connection',
]);

export interface ExternalHttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: RequestInit['body'];
  /** 응답 대기 최대 시간(ms). 기본 30초 */
  timeoutMs?: number;
}

export interface ExternalResponseSummary {
  errorCode?: string | null;
  /** 비밀 없는 오류 요약 */
  errorMessage?: string | null;
  itemCount?: number | null;
}

export interface ExternalCallContext {
  candidateId?: number | null;
  stepRunId?: number | null;
  /**
   * 응답에서 call_log 결과 열(error_code·error_message·item_count)을 뽑는다. 결과 열은 한 번만 쓰므로
   * 본문을 봐야 아는 값(예: 커머스API GW.AUTHN)은 여기서 준다. 건수는 나중에 recordItemCount로도 채울 수 있다.
   */
  describeResponse?: (res: {
    status: number;
    headers: Headers;
    body: Buffer;
  }) => ExternalResponseSummary | undefined;
}

export interface ExternalHttpResponse {
  status: number;
  headers: Headers;
  /** 본문(문자열로 바꾸지 않는다. 라쿠텐 페이지는 EUC-JP라 부르는 쪽이 디코딩한다) */
  body: Buffer;
  callLogId: number;
}

type RejectReason =
  | 'UNKNOWN_TARGET'
  | 'INVALID_URL'
  | 'PROTOCOL_NOT_ALLOWED'
  | 'CREDENTIALS_IN_URL'
  | 'PORT_NOT_ALLOWED'
  | 'HOST_NOT_ALLOWED'
  | 'HEADER_NOT_ALLOWED';

function reject(
  target: string,
  reason: RejectReason,
  extra: Record<string, unknown> = {},
): ApiException {
  return new ApiException('EXTERNAL_REQUEST_NOT_ALLOWED', {
    details: { target, reason, ...extra },
  });
}

/**
 * 요청이 허용 규칙에 맞는지 검사한다(보내기 전, call_log를 쓰기 전).
 * https만, 기본 포트만, URL에 사용자 정보 없음, 대상 표의 호스트와 정확히 일치, 금지 헤더 없음.
 * 어기면 EXTERNAL_REQUEST_NOT_ALLOWED(details.reason). details에 URL 원문은 넣지 않는다(비밀 쿼리값).
 */
export function validateExternalRequest(
  target: CallLogTarget,
  req: Pick<ExternalHttpRequest, 'url' | 'headers'>,
): { url: URL; headers: Record<string, string> } {
  if (!isCallLogTarget(target)) throw reject(String(target), 'UNKNOWN_TARGET');
  const spec = EXTERNAL_TARGETS[target];
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    throw reject(target, 'INVALID_URL');
  }
  if (url.protocol !== 'https:') throw reject(target, 'PROTOCOL_NOT_ALLOWED');
  if (url.username !== '' || url.password !== '') throw reject(target, 'CREDENTIALS_IN_URL');
  if (url.port !== '') throw reject(target, 'PORT_NOT_ALLOWED', { host: url.hostname });
  const host = url.hostname.toLowerCase();
  if (!spec.hosts.includes(host)) throw reject(target, 'HOST_NOT_ALLOWED', { host });

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    const lower = name.toLowerCase();
    if (FORBIDDEN_REQUEST_HEADERS.has(lower) || lower.startsWith('x-forwarded-')) {
      throw reject(target, 'HEADER_NOT_ALLOWED', { header: lower });
    }
    if (lower === 'referer' && (!spec.allowedReferer || value !== spec.allowedReferer)) {
      throw reject(target, 'HEADER_NOT_ALLOWED', { header: lower });
    }
    headers[name] = value;
  }
  headers['User-Agent'] = APP_USER_AGENT;
  return { url, headers };
}

/** 예외 요약(비밀 없는 한 줄). URL 쿼리는 지운다 */
function summarizeError(e: unknown): string {
  const err = e instanceof Error ? e : new Error(String(e));
  const cause = (err as { cause?: { code?: unknown } }).cause;
  const code = cause && typeof cause.code === 'string' ? ` (${cause.code})` : '';
  return `${err.name}: ${err.message}${code}`.replace(/\?[^\s'"]*/g, '?…').slice(0, 500);
}

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

/**
 * 외부 호출 관문(F-BS-06~11). 밖으로 나가는 HTTP는 모두 여기를 지난다.
 * 순서: 허용 검사 → 쉼·상한 검사 → 대상별 직렬 큐·간격 대기 → (쉼·상한 다시 검사) → call_log insert →
 *       fetch → 결과 열 채움 → (비공식 수집 403·418·429면 쉼 시작·예외) → SSE call-usage.changed
 * - 쉼·상한 판단의 원본은 call_log다. 직렬 큐와 간격 대기만 프로세스 메모리에 둔다.
 * - 리다이렉트는 따라가지 않는다(redirect: 'manual'). 다른 호스트로 새지 않게 3xx를 그대로 돌려준다.
 * 공개 시그니처(이후 실행 문서가 그대로 쓴다): `request(target, { method, url, headers?, body? }, { candidateId?, stepRunId? })`
 */
@Injectable()
export class ExternalHttpGateway {
  private readonly logger = new Logger(ExternalHttpGateway.name);
  /** 대상별 직렬 큐의 꼬리 */
  private readonly tails = new Map<CallLogTarget, Promise<void>>();
  /** 대상별 앞 요청이 끝난 시각(ms, CLOCK 기준). 간격은 여기서부터 잰다 */
  private readonly lastFinishedAt = new Map<CallLogTarget, number>();

  constructor(
    private readonly callLogs: CallLogService,
    private readonly usage: CallUsageService,
    @Inject(HTTP_FETCH) private readonly fetchImpl: HttpFetch,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DAILY_LIMIT_PROVIDER) private readonly dailyLimit: DailyLimitProvider,
  ) {}

  async request(
    target: CallLogTarget,
    req: ExternalHttpRequest,
    ctx: ExternalCallContext = {},
  ): Promise<ExternalHttpResponse> {
    const { url, headers } = validateExternalRequest(target, req);
    // 큐에서 기다리기 전에 한 번(빨리 거절), 보내기 직전에 한 번 더(판단 원본) 본다
    await this.assertCanCall(target, this.clock.now());
    return this.runSerial(target, () => this.send(target, url, headers, req, ctx));
  }

  /**
   * 보내지 않고 지금 부를 수 있는지만 본다(P2-02: 202로 받기 전에 409를 먼저 알리려고 — 재조회). 쉼이면 409
   * EXTERNAL_CALL_COOLDOWN, 하루 상한이면 409 DAILY_LIMIT_REACHED(Retry-After). 요청도 call_log 행도 만들지 않는다.
   * 실제로 보낼 때(request) 다시 본다(판단 원본은 늘 call_log).
   */
  assertCallable(target: CallLogTarget): Promise<void> {
    return this.assertCanCall(target, this.clock.now());
  }

  /** call_log 결과 건수를 나중에 채운다(한 번만) */
  recordItemCount(callLogId: number, itemCount: number): Promise<boolean> {
    return this.callLogs.recordItemCount(callLogId, itemCount);
  }

  /** 24시간 쉼·하루 상한이면 409로 막는다 */
  private async assertCanCall(target: CallLogTarget, now: Date): Promise<void> {
    const spec = EXTERNAL_TARGETS[target];
    const cooldown = await this.usage.activeCooldown(target, now);
    if (cooldown) {
      throw cooldownException(target, cooldown.blockedUntil, cooldown.httpStatus, now);
    }
    const limit = this.dailyLimit(target);
    if (limit !== null) {
      const count = await this.usage.countToday(target, now);
      if (count >= limit) {
        throw new ApiException('DAILY_LIMIT_REACHED', {
          message: formatErrorMessage('DAILY_LIMIT_REACHED', { 대상: spec.label, n: limit }),
          details: { target, dailyLimit: limit },
          headers: { 'Retry-After': String(secondsUntilNextKstMidnight(now)) },
        });
      }
    }
  }

  private runSerial<T>(target: CallLogTarget, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(target) ?? Promise.resolve();
    const run = prev.then(task);
    this.tails.set(
      target,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private async send(
    target: CallLogTarget,
    url: URL,
    headers: Record<string, string>,
    req: ExternalHttpRequest,
    ctx: ExternalCallContext,
  ): Promise<ExternalHttpResponse> {
    const spec = EXTERNAL_TARGETS[target];
    const last = this.lastFinishedAt.get(target);
    if (last !== undefined && spec.minIntervalMs > 0) {
      const wait = last + spec.minIntervalMs - this.clock.now().getTime();
      if (wait > 0) await this.clock.sleep(wait);
    }
    const calledAt = this.clock.now();
    await this.assertCanCall(target, calledAt);

    const log = await this.callLogs.start({
      target,
      calledAt,
      httpMethod: req.method,
      host: url.hostname.toLowerCase(),
      url: url.toString(),
      candidateId: ctx.candidateId,
      stepRunId: ctx.stepRunId,
    });
    const started = performance.now();
    const durationMs = () => performance.now() - started;

    let response: Response;
    let body: Buffer;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: req.method.toUpperCase(),
        headers,
        body: req.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_EXTERNAL_TIMEOUT_MS),
      });
      body = Buffer.from(await response.arrayBuffer());
    } catch (e) {
      this.lastFinishedAt.set(target, this.clock.now().getTime());
      const reason = isTimeout(e) ? 'TIMEOUT' : 'NETWORK_ERROR';
      await this.callLogs.finish(log.id, {
        succeeded: false,
        errorCode: reason,
        errorMessage: summarizeError(e),
        durationMs: durationMs(),
      });
      await this.publishUsage(target);
      throw new ApiException('EXTERNAL_API_ERROR', {
        message: formatErrorMessage('EXTERNAL_API_ERROR', {
          대상: spec.label,
          사유: reason === 'TIMEOUT' ? '응답 시간 초과' : '연결 실패',
        }),
        details: { target, reason, callLogId: log.id },
      });
    }
    this.lastFinishedAt.set(target, this.clock.now().getTime());

    const status = response.status;
    const succeeded = status >= 200 && status < 300;
    let summary: ExternalResponseSummary | undefined;
    try {
      summary = ctx.describeResponse?.({ status, headers: response.headers, body });
    } catch (e) {
      this.logger.warn(`응답 요약에 실패했습니다(${target}): ${summarizeError(e)}`);
    }
    await this.callLogs.finish(log.id, {
      httpStatus: status,
      succeeded,
      errorCode: summary?.errorCode ?? (succeeded ? null : `HTTP_${status}`),
      errorMessage: summary?.errorMessage ?? null,
      itemCount: summary?.itemCount ?? null,
      durationMs: durationMs(),
      traceId: response.headers.get('gncp-gw-trace-id'),
    });
    await this.publishUsage(target);

    if (spec.unofficial && COOLDOWN_HTTP_STATUSES.includes(status)) {
      // 비공식 수집이 막혔다: 이 수집은 바로 멈추고(예외) 24시간 쉰다. 남은 요청은 큐에서 409를 받는다
      throw cooldownException(
        target,
        new Date(calledAt.getTime() + COOLDOWN_MS),
        status,
        this.clock.now(),
      );
    }
    return { status, headers: response.headers, body, callLogId: log.id };
  }

  private async publishUsage(target: CallLogTarget): Promise<void> {
    try {
      await this.usage.publishChanged(target);
    } catch (e) {
      this.logger.warn(`call-usage.changed 발행에 실패했습니다(${target}): ${summarizeError(e)}`);
    }
  }
}

function cooldownException(
  target: CallLogTarget,
  blockedUntil: Date,
  httpStatus: number,
  now: Date,
): ApiException {
  const retryAfter = Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000));
  return new ApiException('EXTERNAL_CALL_COOLDOWN', {
    message: formatErrorMessage('EXTERNAL_CALL_COOLDOWN', {
      대상: EXTERNAL_TARGETS[target].label,
      시각: formatKstDateTime(blockedUntil),
    }),
    details: { target, blockedUntil: blockedUntil.toISOString(), httpStatus },
    headers: { 'Retry-After': String(retryAfter) },
  });
}
