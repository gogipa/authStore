import request from 'supertest';
import type { PublishedProgressEvent } from '../src/common/events/progress-events.service.js';
import { ProgressEventsService } from '../src/common/events/progress-events.service.js';
import { ApiException } from '../src/common/errors/api.exception.js';
import { secondsUntilNextKstMidnight, toKstDateValue } from '../src/common/time/kst.js';
import { CallUsageService } from '../src/modules/integrations/call-usage/call-usage.service.js';
import {
  APP_USER_AGENT,
  ExternalHttpGateway,
} from '../src/modules/integrations/http/external-http.gateway.js';
import {
  type CallLogTarget,
  DATALAB_REFERER,
} from '../src/modules/integrations/http/external-targets.js';
import { fixtureResponse, jsonResponse } from './helpers/fakes.js';
import { createTestApp, type TestApp, truncate } from './helpers/test-app.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const URLS: Record<string, string> = {
  RAKUTEN_PAGE: 'https://item.rakuten.co.jp/fixture-shop/fixture-item/',
  RAKUTEN_API:
    'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?applicationId=app-id-fixture&accessKey=access-fixture&keyword=a',
  DATALAB: 'https://datalab.naver.com/shoppingInsight/getCategoryKeywordRank.naver',
  COMMERCE_API: 'https://api.commerce.naver.com/external/v1/product-models',
};

describe('외부 호출 관문·GET /call-usage (e2e, 가짜 fetch·가짜 시계)', () => {
  let t: TestApp;
  let gateway: ExternalHttpGateway;
  let events: ProgressEventsService;

  const call = (target: CallLogTarget, init: { headers?: Record<string, string> } = {}) =>
    gateway.request(target, {
      method: target === 'DATALAB' ? 'POST' : 'GET',
      url: URLS[target]!,
      headers: target === 'DATALAB' && !init.headers ? { Referer: DATALAB_REFERER } : init.headers,
    });

  /** 막힌 요청의 ApiException을 받는다 */
  const rejected = async (p: Promise<unknown>): Promise<ApiException> => {
    const e = await p.then(
      () => null,
      (err: unknown) => err,
    );
    expect(e).toBeInstanceOf(ApiException);
    return e as ApiException;
  };

  const insertLogs = async (
    target: CallLogTarget,
    n: number,
    calledAt: Date,
    extra: { httpStatus?: number } = {},
  ) => {
    await t.prisma.callLog.createMany({
      data: Array.from({ length: n }, () => ({
        calledAt,
        kstDate: toKstDateValue(calledAt),
        target,
        httpMethod: 'GET',
        host: 'item.rakuten.co.jp',
        urlMasked: URLS.RAKUTEN_PAGE,
        httpStatus: extra.httpStatus ?? 200,
        succeeded: (extra.httpStatus ?? 200) < 300,
        durationMs: 10,
      })),
    });
  };

  beforeAll(async () => {
    t = await createTestApp();
    gateway = t.app.get(ExternalHttpGateway);
    events = t.app.get(ProgressEventsService);
  });

  beforeEach(async () => {
    await truncate(t.prisma, ['call_log', 'rakuten_item']);
    t.fetch.reset();
    // 앞 테스트의 간격 대기가 섞이지 않도록 시계를 앞으로만 옮긴다
    t.clock.advance(HOUR);
  });

  afterAll(async () => {
    await t.app.close();
  });

  describe('허용 목록(F-BS-06)', () => {
    it.each([
      ['RAKUTEN_PAGE', 'https://example.com/x'],
      ['RAKUTEN_API', 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?x=1'],
    ] as const)('%s → %s 는 거부한다(fetch 0회, call_log 0행)', async (target, url) => {
      const e = await rejected(gateway.request(target, { method: 'GET', url }));
      expect(e.code).toBe('EXTERNAL_REQUEST_NOT_ALLOWED');
      expect(t.fetch.calls).toHaveLength(0);
      expect(await t.prisma.callLog.count()).toBe(0);
    });
  });

  describe('정직한 UA·헤더(F-BS-08)', () => {
    it('가짜 fetch가 받은 User-Agent는 앱 UA이고 Mozilla/로 시작하지 않는다. 리다이렉트는 따라가지 않는다', async () => {
      await call('RAKUTEN_PAGE');
      const headers = t.fetch.calls[0]!.init.headers as Record<string, string>;
      expect(headers['User-Agent']).toBe(APP_USER_AGENT);
      expect(headers['User-Agent']!.startsWith('Mozilla/')).toBe(false);
      expect(t.fetch.calls[0]!.init.redirect).toBe('manual');
    });

    it.each(['Origin', 'Cookie', 'User-Agent'])(
      '호출자가 %s를 넣으면 거부한다(fetch 0회, call_log 0행)',
      async (header) => {
        const e = await rejected(call('COMMERCE_API', { headers: { [header]: 'x' } }));
        expect(e.code).toBe('EXTERNAL_REQUEST_NOT_ALLOWED');
        expect(e.details).toMatchObject({ reason: 'HEADER_NOT_ALLOWED' });
        expect(t.fetch.calls).toHaveLength(0);
        expect(await t.prisma.callLog.count()).toBe(0);
      },
    );

    it('Referer는 DATALAB만 통과한다', async () => {
      await call('DATALAB');
      expect((t.fetch.calls[0]!.init.headers as Record<string, string>).Referer).toBe(
        DATALAB_REFERER,
      );
      const e = await rejected(call('RAKUTEN_PAGE', { headers: { Referer: DATALAB_REFERER } }));
      expect(e.code).toBe('EXTERNAL_REQUEST_NOT_ALLOWED');
      expect(t.fetch.calls).toHaveLength(1);
    });
  });

  describe('대상별 직렬·최소 간격(F-BS-09)', () => {
    it.each([
      ['RAKUTEN_PAGE', 3000],
      ['DATALAB', 2000],
      ['RAKUTEN_API', 1500],
    ] as const)('%s 요청 3개를 동시에 넣어도 겹치지 않고 시작 간격 ≥ %ims', async (target, gap) => {
      t.fetch.durationMs = 200;
      await Promise.all([call(target), call(target), call(target)]);
      expect(t.fetch.calls).toHaveLength(3);
      expect(t.fetch.maxInFlight).toBe(1);
      const starts = t.fetch.calls.map((c) => c.startedAt);
      for (let i = 1; i < starts.length; i += 1) {
        expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(gap);
        // 앞 요청이 끝난 때부터 잰다(Proposed)
        expect(starts[i]! - t.fetch.calls[i - 1]!.finishedAt!).toBeGreaterThanOrEqual(gap);
      }
    });

    it('대상이 다르면 서로 기다리지 않는다', async () => {
      await call('RAKUTEN_PAGE');
      const before = t.clock.now().getTime();
      await call('COMMERCE_API');
      expect(t.fetch.calls[1]!.startedAt).toBe(before);
    });
  });

  describe('하루 상한(F-BS-09, RK-04)', () => {
    it('오늘(KST) RAKUTEN_PAGE 110행이면 409 DAILY_LIMIT_REACHED, fetch 0회, Retry-After는 다음 KST 0시까지', async () => {
      const now = t.clock.now();
      await insertLogs('RAKUTEN_PAGE', 110, now);
      const e = await rejected(call('RAKUTEN_PAGE'));
      expect(e.code).toBe('DAILY_LIMIT_REACHED');
      expect(e.getStatus()).toBe(409);
      expect(e.details).toEqual({ target: 'RAKUTEN_PAGE', dailyLimit: 110 });
      expect(e.headers).toEqual({ 'Retry-After': String(secondsUntilNextKstMidnight(now)) });
      expect(e.message).toBe(
        '오늘 라쿠텐 상품 페이지 조회 한도(110건)를 다 썼습니다. 내일 0시(한국 시간)에 다시 됩니다.',
      );
      expect(t.fetch.calls).toHaveLength(0);
      expect(await t.prisma.callLog.count()).toBe(110);
    });

    it('같은 110행이 어제(KST) 날짜면 통과한다', async () => {
      await insertLogs('RAKUTEN_PAGE', 110, new Date(t.clock.now().getTime() - DAY));
      const res = await call('RAKUTEN_PAGE');
      expect(res.status).toBe(200);
      expect(t.fetch.calls).toHaveLength(1);
    });

    it('fetch가 예외를 던져도 call_log 행이 남고(succeeded=false) 상한 수에 든다', async () => {
      await insertLogs('RAKUTEN_PAGE', 109, t.clock.now());
      t.fetch.handler = () => {
        throw new TypeError('fetch failed');
      };
      const e = await rejected(call('RAKUTEN_PAGE'));
      expect(e.code).toBe('EXTERNAL_API_ERROR');
      expect(e.getStatus()).toBe(502);
      const last = await t.prisma.callLog.findFirst({ orderBy: { id: 'desc' } });
      expect(last).toMatchObject({
        target: 'RAKUTEN_PAGE',
        succeeded: false,
        errorCode: 'NETWORK_ERROR',
        httpStatus: null,
      });
      expect(last!.durationMs).toBeGreaterThanOrEqual(0);
      // 110번째(실패)까지 세어 다음 요청은 상한
      const next = await rejected(call('RAKUTEN_PAGE'));
      expect(next.code).toBe('DAILY_LIMIT_REACHED');
      expect(t.fetch.calls).toHaveLength(1);
    });
  });

  describe('차단 응답 뒤 24시간 쉼(F-BS-10)', () => {
    it.each([
      [429, 'too-many-requests-429.html'],
      [403, 'forbidden-403.html'],
      [418, 'teapot-418.html'],
    ])(
      'RAKUTEN_PAGE %i → 예외, 다음 요청은 409 EXTERNAL_CALL_COOLDOWN, 24h+1s 뒤 통과',
      async (status, fixture) => {
        t.fetch.handler = () => fixtureResponse(status, fixture, 'text/html');
        const first = await rejected(call('RAKUTEN_PAGE'));
        expect(first.code).toBe('EXTERNAL_CALL_COOLDOWN');
        const row = await t.prisma.callLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
        expect(row.httpStatus).toBe(status);
        expect(row.succeeded).toBe(false);
        const blockedUntil = new Date(row.calledAt.getTime() + DAY).toISOString();
        expect(first.details).toMatchObject({
          target: 'RAKUTEN_PAGE',
          blockedUntil,
          httpStatus: status,
        });

        const second = await rejected(call('RAKUTEN_PAGE'));
        expect(second.code).toBe('EXTERNAL_CALL_COOLDOWN');
        expect(second.getStatus()).toBe(409);
        expect(second.details).toMatchObject({ target: 'RAKUTEN_PAGE', blockedUntil });
        expect(Number(second.headers?.['Retry-After'])).toBeGreaterThan(0);
        expect(second.message).toMatch(/^라쿠텐 상품 페이지가 요청을 막아 .+까지 쉽니다/);
        expect(t.fetch.calls).toHaveLength(1);

        t.fetch.handler = () => jsonResponse(200, { ok: true });
        t.clock.advance(DAY + 1000);
        const res = await call('RAKUTEN_PAGE');
        expect(res.status).toBe(200);
        expect(t.fetch.calls).toHaveLength(2);
      },
    );

    it('DATALAB 429도 쉼을 만든다', async () => {
      t.fetch.handler = () => fixtureResponse(429, 'too-many-requests-429.html', 'text/html');
      expect((await rejected(call('DATALAB'))).code).toBe('EXTERNAL_CALL_COOLDOWN');
      expect((await rejected(call('DATALAB'))).code).toBe('EXTERNAL_CALL_COOLDOWN');
      expect(t.fetch.calls).toHaveLength(1);
    });

    it('공식 API(RAKUTEN_API) 429·503은 쉼을 만들지 않는다(응답을 그대로 돌려준다)', async () => {
      t.fetch.handler = () => fixtureResponse(429, 'too-many-requests-429.html', 'text/html');
      const res = await call('RAKUTEN_API');
      expect(res.status).toBe(429);
      expect(res.body.toString('utf8')).toContain('Too Many Requests');
      t.fetch.handler = () => fixtureResponse(503, 'unavailable-503.html', 'text/html');
      expect((await call('RAKUTEN_API')).status).toBe(503);
      t.fetch.handler = () => jsonResponse(200, { Items: [] });
      expect((await call('RAKUTEN_API')).status).toBe(200);
      expect(t.fetch.calls).toHaveLength(3);
    });
  });

  describe('call_log 기록(F-BS-11)', () => {
    it('결과 열이 채워지고 비밀 쿼리값은 가려지며 call-usage.changed가 발행된다', async () => {
      const got: PublishedProgressEvent[] = [];
      const sub = events.stream().subscribe((e) => got.push(e));
      const res = await gateway.request(
        'RAKUTEN_API',
        { method: 'GET', url: URLS.RAKUTEN_API! },
        { describeResponse: () => ({ itemCount: 30 }) },
      );
      sub.unsubscribe();
      const row = await t.prisma.callLog.findUniqueOrThrow({ where: { id: res.callLogId } });
      expect(row).toMatchObject({
        target: 'RAKUTEN_API',
        httpMethod: 'GET',
        host: 'openapi.rakuten.co.jp',
        httpStatus: 200,
        succeeded: true,
        errorCode: null,
        itemCount: 30,
      });
      expect(row.urlMasked).toContain('applicationId=***&accessKey=***&keyword=a');
      expect(row.urlMasked).not.toContain('app-id-fixture');
      expect(row.durationMs).toBeGreaterThanOrEqual(0);
      expect(got.map((e) => e.name)).toEqual(['call-usage.changed']);
      expect(got[0]!.candidateId).toBeNull();
      expect(got[0]!.data).toMatchObject({ target: 'RAKUTEN_API', count: 1, dailyLimit: null });
    });

    it('응답 본문은 Buffer로 넘긴다(문자열로 바꾸지 않는다)', async () => {
      const euc = Buffer.from([0xa4, 0xb3, 0xa4, 0xf3]); // EUC-JP 'こん'
      t.fetch.handler = () => new Response(new Uint8Array(euc), { status: 200 });
      const res = await call('RAKUTEN_PAGE');
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect(res.body.equals(euc)).toBe(true);
    });

    it('recordItemCount는 건수를 한 번만 채운다', async () => {
      const res = await call('DATALAB');
      expect(await gateway.recordItemCount(res.callLogId, 20)).toBe(true);
      expect(await gateway.recordItemCount(res.callLogId, 99)).toBe(false);
      const row = await t.prisma.callLog.findUniqueOrThrow({ where: { id: res.callLogId } });
      expect(row.itemCount).toBe(20);
    });

    it('candidateId·stepRunId를 넘기지 않으면 NULL(로그성 참조)', async () => {
      const res = await call('COMMERCE_API');
      const row = await t.prisma.callLog.findUniqueOrThrow({ where: { id: res.callLogId } });
      expect(row.candidateId).toBeNull();
      expect(row.stepRunId).toBeNull();
    });
  });

  describe('GET /api/v1/call-usage', () => {
    const http = () => request(t.app.getHttpServer());
    type Usage = Record<string, unknown> & { target: string };
    const byTarget = async (target: string): Promise<Usage> => {
      const res = await http().get('/api/v1/call-usage').expect(200);
      const items = (res.body as { items: Usage[] }).items;
      return items.find((i) => i.target === target)!;
    };

    it('빈 DB: 대상 목록과 RAKUTEN_PAGE 기본값', async () => {
      const res = await http().get('/api/v1/call-usage').expect(200);
      const body = res.body as { items: Usage[] };
      expect(Object.keys(body)).toEqual(['items']);
      expect(body.items.map((i) => i.target)).toEqual([
        'COMMERCE_API',
        'RAKUTEN_API',
        'RAKUTEN_PAGE',
        'DATALAB',
        'FX_KOREAEXIM',
        'FX_CUSTOMS',
      ]);
      const page = body.items.find((i) => i.target === 'RAKUTEN_PAGE')!;
      expect(page).toEqual({
        target: 'RAKUTEN_PAGE',
        kstDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown,
        count: 0,
        dailyLimit: 110,
        remaining: 110,
        limitReached: false,
        blockedUntil: null,
        httpStatus: null,
        countsByFetchReason: { SOURCING: 0, URL_ENTRY: 0, STOCK_CHECK: 0, REFETCH: 0, SYNC: 0 },
        budgetBuckets: null,
      });
      const api = body.items.find((i) => i.target === 'RAKUTEN_API')!;
      expect(api).toMatchObject({
        dailyLimit: null,
        remaining: null,
        limitReached: false,
        countsByFetchReason: null,
      });
    });

    it('오늘 행 38개 → count 38·remaining 72', async () => {
      await insertLogs('RAKUTEN_PAGE', 38, t.clock.now());
      expect(await byTarget('RAKUTEN_PAGE')).toMatchObject({
        count: 38,
        remaining: 72,
        limitReached: false,
      });
    });

    it('오늘 행 110개 → limitReached true·remaining 0', async () => {
      await insertLogs('RAKUTEN_PAGE', 110, t.clock.now());
      expect(await byTarget('RAKUTEN_PAGE')).toMatchObject({
        count: 110,
        remaining: 0,
        limitReached: true,
      });
    });

    it('1시간 전 429 행 → blockedUntil이 지금+23h, httpStatus 429', async () => {
      const now = t.clock.now().getTime();
      await insertLogs('RAKUTEN_PAGE', 1, new Date(now - HOUR), { httpStatus: 429 });
      expect(await byTarget('RAKUTEN_PAGE')).toMatchObject({
        blockedUntil: new Date(now + 23 * HOUR).toISOString(),
        httpStatus: 429,
      });
    });

    it('24시간이 지난 429 행은 쉼이 아니다. 공식 API 429 행은 쉼이 아니다', async () => {
      const now = t.clock.now().getTime();
      await insertLogs('RAKUTEN_PAGE', 1, new Date(now - DAY - 1000), { httpStatus: 429 });
      await insertLogs('RAKUTEN_API', 1, new Date(now - HOUR), { httpStatus: 429 });
      expect(await byTarget('RAKUTEN_PAGE')).toMatchObject({
        blockedUntil: null,
        httpStatus: null,
      });
      expect(await byTarget('RAKUTEN_API')).toMatchObject({ blockedUntil: null, httpStatus: null });
    });

    it('countsByFetchReason은 오늘 만든 rakuten_item.fetch_reason으로 센다(합이 count보다 작을 수 있다)', async () => {
      const now = t.clock.now();
      await insertLogs('RAKUTEN_PAGE', 3, now);
      const item = (code: string, fetchReason: string) => ({
        itemCode: code,
        shopCode: 'fixture-shop',
        itemName: '픽스처 상품',
        itemUrl: `https://item.rakuten.co.jp/fixture-shop/${code}/`,
        entrySource: 'MANUAL',
        fetchReason,
        collectedAt: now,
        genreSource: 'NOT_FOUND',
      });
      await t.prisma.rakutenItem.createMany({
        data: [item('a', 'SOURCING'), item('b', 'STOCK_CHECK')],
      });
      expect(await byTarget('RAKUTEN_PAGE')).toMatchObject({
        count: 3,
        countsByFetchReason: { SOURCING: 1, URL_ENTRY: 0, STOCK_CHECK: 1, REFETCH: 0, SYNC: 0 },
      });
    });

    it('KST 0시 타이머가 돌면 목록 대상마다 call-usage.changed를 보낸다', async () => {
      const got: PublishedProgressEvent[] = [];
      const sub = events.stream().subscribe((e) => got.push(e));
      await t.app.get(CallUsageService).onKstMidnight();
      sub.unsubscribe();
      expect(got.map((e) => (e.data as { target: string }).target)).toEqual([
        'COMMERCE_API',
        'RAKUTEN_API',
        'RAKUTEN_PAGE',
        'DATALAB',
        'FX_KOREAEXIM',
        'FX_CUSTOMS',
      ]);
    });

    it('Host가 틀리면 403 HOST_NOT_ALLOWED', async () => {
      const res = await http()
        .get('/api/v1/call-usage')
        .set('Host', 'evil.example:3100')
        .expect(403);
      expect((res.body as { code: string }).code).toBe('HOST_NOT_ALLOWED');
    });
  });
});
