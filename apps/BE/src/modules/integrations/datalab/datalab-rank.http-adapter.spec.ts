import { ApiException } from '../../../common/errors/api.exception.js';
import { DEFAULT_SETTINGS } from '../../settings/defaults/default-settings.js';
import type { SettingsService } from '../../settings/settings.service.js';
import {
  type ExternalCallContext,
  type ExternalHttpGateway,
  type ExternalHttpRequest,
  validateExternalRequest,
} from '../http/external-http.gateway.js';
import { DATALAB_REFERER } from '../http/external-targets.js';
import { buildDatalabRankRequest, DatalabRankHttpAdapter } from './datalab-rank.http-adapter.js';
import { DatalabCidError } from './datalab-rank.port.js';

const request = { cid: '50000173', startDate: '2026-08-23', endDate: '2026-09-23', page: 3 };
const config = DEFAULT_SETTINGS.keywords.datalab;

interface GatewayCall {
  target: string;
  req: ExternalHttpRequest;
  ctx: ExternalCallContext;
}

/** 관문 가짜: 받은 요청을 기록하고, 응답 요약(describeResponse)을 부른 뒤 답하거나 던진다 */
function fakeGateway(
  reply: { status: number; body: string; contentType?: string },
  throwAfterDescribe?: ApiException,
  throwBeforeSend?: ApiException,
) {
  const calls: GatewayCall[] = [];
  const gateway = {
    request: (target: string, req: ExternalHttpRequest, ctx: ExternalCallContext = {}) => {
      calls.push({ target, req, ctx });
      if (throwBeforeSend) return Promise.reject(throwBeforeSend);
      const raw = {
        status: reply.status,
        headers: new Headers({ 'Content-Type': reply.contentType ?? 'text/html;charset=UTF-8' }),
        body: Buffer.from(reply.body, 'utf8'),
      };
      ctx.describeResponse?.(raw);
      if (throwAfterDescribe) return Promise.reject(throwAfterDescribe);
      return Promise.resolve({ ...raw, callLogId: 1 });
    },
  };
  return { gateway: gateway as unknown as ExternalHttpGateway, calls };
}

const settings = { current: () => DEFAULT_SETTINGS } as unknown as SettingsService;

describe('데이터랩 요청 조립·어댑터(F-BS-33, P2-01 규칙 3)', () => {
  it('form: cid·timeUnit=date·기간·빈 age·gender·device·page·count=20, POST form-urlencoded, Referer 정확값', () => {
    const req = buildDatalabRankRequest(request, config);
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://datalab.naver.com/shoppingInsight/getCategoryKeywordRank.naver');
    expect(req.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Referer: 'https://datalab.naver.com/shoppingInsight/sCategory.naver',
    });
    expect(DATALAB_REFERER).toBe('https://datalab.naver.com/shoppingInsight/sCategory.naver');
    const form = new URLSearchParams(req.body as string);
    expect(Object.fromEntries(form)).toEqual({
      cid: '50000173',
      timeUnit: 'date',
      startDate: '2026-08-23',
      endDate: '2026-09-23',
      age: '',
      gender: '',
      device: '',
      page: '3',
      count: '20',
    });
  });

  it('관문을 지나면 UA는 앱 고유 값(Mozilla 없음 — 브라우저 위장 금지), Referer는 허용 값 그대로', () => {
    const { headers } = validateExternalRequest(
      'DATALAB',
      buildDatalabRankRequest(request, config),
    );
    expect(headers['User-Agent']).toMatch(/^autoStore\//);
    expect(headers['User-Agent']).not.toMatch(/Mozilla/i);
    expect(headers.Referer).toBe(DATALAB_REFERER);
  });

  it("cid='50000173,50000174' → 호출 0회로 오류", async () => {
    expect(() => buildDatalabRankRequest({ ...request, cid: '50000173,50000174' }, config)).toThrow(
      DatalabCidError,
    );
    const { gateway, calls } = fakeGateway({ status: 200, body: '{}' });
    const adapter = new DatalabRankHttpAdapter(gateway, settings);
    await expect(
      adapter.fetchRankPage({ ...request, cid: '50000173,50000174' }),
    ).rejects.toBeInstanceOf(DatalabCidError);
    expect(calls).toHaveLength(0);
  });

  it('관문 target=DATALAB으로 보내고 응답 본문을 글자로 돌려준다(describe로 call_log 요약)', async () => {
    const { gateway, calls } = fakeGateway({ status: 200, body: '{"returnCode":0,"ranks":[]}' });
    const adapter = new DatalabRankHttpAdapter(gateway, settings);
    const described: unknown[] = [];
    const res = await adapter.fetchRankPage(request, {
      describe: (r) => {
        described.push(r);
        return { itemCount: 0 };
      },
    });
    expect(calls[0]!.target).toBe('DATALAB');
    expect(res).toEqual({
      httpStatus: 200,
      contentType: 'text/html;charset=UTF-8',
      bodyText: '{"returnCode":0,"ranks":[]}',
    });
    expect(described).toHaveLength(1);
  });

  it('429 응답: 관문이 쉼을 기록하고 던져도 받은 응답을 그대로 돌려준다(해석은 keywords)', async () => {
    const cooldown = new ApiException('EXTERNAL_CALL_COOLDOWN', {
      details: { target: 'DATALAB', httpStatus: 429 },
    });
    const { gateway } = fakeGateway({ status: 429, body: 'Too Many Requests' }, cooldown);
    const adapter = new DatalabRankHttpAdapter(gateway, settings);
    await expect(adapter.fetchRankPage(request)).resolves.toMatchObject({ httpStatus: 429 });
  });

  it('보내기 전에 막힘(쉼 중 409·하루 상한)·연결 실패(502)는 그대로 던진다', async () => {
    const blocked = new ApiException('EXTERNAL_CALL_COOLDOWN', { details: { target: 'DATALAB' } });
    const { gateway } = fakeGateway({ status: 200, body: '' }, undefined, blocked);
    const adapter = new DatalabRankHttpAdapter(gateway, settings);
    await expect(adapter.fetchRankPage(request)).rejects.toBe(blocked);
  });
});
