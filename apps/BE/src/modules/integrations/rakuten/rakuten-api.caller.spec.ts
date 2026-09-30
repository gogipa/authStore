import { rakutenSearchFixture } from '../../../../test/support/rakuten-fixture.adapters.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import type { Clock } from '../http/clock.token.js';
import type {
  ExternalCallContext,
  ExternalHttpGateway,
  ExternalHttpRequest,
} from '../http/external-http.gateway.js';
import { RakutenApiError } from './rakuten-api-error.mapper.js';
import { callRakutenApi, rakutenApiErrorToException } from './rakuten-api.caller.js';

/** 가짜 시계: sleep은 기다리지 않고 시간만 옮기고 기록한다 */
class RecordingClock implements Clock {
  sleeps: number[] = [];
  constructor(public ms = 0) {}
  now(): Date {
    return new Date(this.ms);
  }
  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.ms += ms;
    return Promise.resolve();
  }
}

interface Reply {
  status: number;
  body: string;
}

/** 관문 가짜: 차례로 답하고, describeResponse(call_log 결과 열)를 기록한다 */
function fakeGateway(replies: Reply[]) {
  const calls: { target: string; req: ExternalHttpRequest }[] = [];
  const described: unknown[] = [];
  const gateway = {
    request: (target: string, req: ExternalHttpRequest, ctx: ExternalCallContext = {}) => {
      calls.push({ target, req });
      const reply = replies.shift() ?? { status: 200, body: '{"Items":[]}' };
      const raw = { status: reply.status, headers: new Headers(), body: Buffer.from(reply.body) };
      described.push(ctx.describeResponse?.(raw));
      return Promise.resolve({ ...raw, callLogId: calls.length });
    },
  };
  return { gateway: gateway as unknown as ExternalHttpGateway, calls, described };
}

const URL = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?keyword=a';
const ok = { status: 200, body: '{"Items":[{"itemCode":"a:1"}]}' };
const s429 = { status: 429, body: rakutenSearchFixture('status-429.json') };
const s503 = { status: 503, body: rakutenSearchFixture('status-503.json') };

describe('라쿠텐 API 호출·재시도(F-BS-34, P2-02 규칙 2)', () => {
  it('429·429·200 → 호출 3회, 백오프 2초·4초 뒤 본문', async () => {
    const clock = new RecordingClock();
    const { gateway, calls } = fakeGateway([s429, s429, ok]);
    const body = await callRakutenApi(gateway, clock, URL, { maxRetries: 3 });
    expect(body).toBe(ok.body);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.target === 'RAKUTEN_API')).toBe(true);
    expect(clock.sleeps).toEqual([2000, 4000]);
  });

  it('503 네 번 → 1+3회 부른 뒤 RAKUTEN_UNAVAILABLE(점검 안내)로 실패', async () => {
    const clock = new RecordingClock();
    const { gateway, calls } = fakeGateway([s503, s503, s503, s503, ok]);
    const error = await callRakutenApi(gateway, clock, URL, { maxRetries: 3 }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RakutenApiError);
    expect(error).toMatchObject({ errorCode: 'RAKUTEN_UNAVAILABLE', httpStatus: 503 });
    expect(calls).toHaveLength(4);
    expect(clock.sleeps).toEqual([2000, 4000, 8000]);
  });

  it('403 → 재시도 0회(키 오류)', async () => {
    const clock = new RecordingClock();
    const { gateway, calls } = fakeGateway([
      { status: 403, body: rakutenSearchFixture('err-403-invalid-access-key.json') },
    ]);
    await expect(callRakutenApi(gateway, clock, URL, { maxRetries: 3 })).rejects.toMatchObject({
      errorCode: 'RAKUTEN_INVALID_ACCESS_KEY',
    });
    expect(calls).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('call_log 결과 열: 200은 건수, 실패는 오류 코드·한국어 문구', async () => {
    const { gateway, described } = fakeGateway([s429, ok]);
    await callRakutenApi(
      gateway,
      new RecordingClock(),
      URL,
      { maxRetries: 3, countItems: () => 1 },
      { candidateId: 7, stepRunId: 9 },
    );
    expect(described[0]).toMatchObject({ errorCode: 'RAKUTEN_RATE_LIMITED' });
    expect(described[1]).toEqual({ itemCount: 1 });
  });

  it('관문 예외(응답 없음 502·쉼 409)는 그대로 던진다', async () => {
    const gateway = {
      request: () => Promise.reject(new ApiException('EXTERNAL_API_ERROR')),
    } as unknown as ExternalHttpGateway;
    await expect(
      callRakutenApi(gateway, new RecordingClock(), URL, { maxRetries: 3 }),
    ).rejects.toMatchObject({ code: 'EXTERNAL_API_ERROR' });
  });

  it('동기 API는 502 EXTERNAL_API_ERROR(details.target=RAKUTEN_API·reason=코드)로 바꾼다', () => {
    const e = rakutenApiErrorToException(
      new RakutenApiError({
        errorCode: 'CLIENT_IP_NOT_ALLOWED',
        message: '허용 IP',
        httpStatus: 403,
      }),
    );
    expect(e.getStatus()).toBe(502);
    expect(e.details).toEqual({
      target: 'RAKUTEN_API',
      reason: 'CLIENT_IP_NOT_ALLOWED',
      httpStatus: 403,
    });
  });
});
