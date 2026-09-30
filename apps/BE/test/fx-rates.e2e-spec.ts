import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../src/common/events/progress-events.service.js';
import { SECRET_STORE } from '../src/common/secrets/secret-store.port.js';
import { FxCollectorService } from '../src/modules/pricing/fx/fx-collector.service.js';
import { FxRatesService } from '../src/modules/pricing/fx/fx-rates.service.js';
import { allRequiredCompleted, createCandidate } from './fixtures/step-engine/candidate.factory.js';
import { insertStepRun } from './fixtures/step-engine/step-run.factory.js';
import { STEP_ENGINE_TABLES } from './fixtures/step-engine/truncate.js';
import { createTestApp, type TestApp, truncate } from './helpers/test-app.js';
import { InMemorySecretStore } from './support/in-memory-secret-store.js';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'fx');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

/** KST 시각 → ms(가짜 시계) */
const kst = (text: string) => Date.parse(`${text}+09:00`);

const KEXIM_KEY = 'test-kexim-authkey-0001';
const CUSTOMS_KEY = 'test-customs-servicekey-0001';

interface FxRecordBody {
  id: number;
  rateKind: string;
  currency: string;
  rateValue: number;
  unit: number;
  source: string;
  sourceNote: string | null;
  referenceAt: string;
  collectedAt: string;
}
interface LatestBody {
  items: FxRecordBody[];
  warnings: { code: string; message: string; rateKind?: string | null; currency?: string | null }[];
}
interface ErrorBody {
  code: string;
  message: string;
  fieldErrors?: { field: string; message: string }[];
  details?: Record<string, unknown>;
}

const RECORD_KEYS = [
  'collectedAt',
  'currency',
  'id',
  'rateKind',
  'rateValue',
  'referenceAt',
  'source',
  'sourceNote',
  'unit',
];

describe('환율 GET /fx-rates/latest·GET /fx-rates·POST /fx-rates·자동 수집 (e2e)', () => {
  let t: TestApp;
  const secrets = new InMemorySecretStore({
    initial: { KOREAEXIM_API_KEY: KEXIM_KEY, CUSTOMS_SERVICE_KEY: CUSTOMS_KEY },
  });
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;
  /** 가짜 출처 응답(호스트별) */
  let keximAnswer: () => Response;
  let customsAnswer: () => Response;

  const http = () => request(t.app.getHttpServer());
  const post = (body: object, withClientHeader = true) => {
    const req = http().post('/api/v1/fx-rates');
    return (withClientHeader ? req.set('X-AutoStore-Client', '1') : req).send(body);
  };
  const latest = async () =>
    (await http().get('/api/v1/fx-rates/latest').expect(200)).body as LatestBody;
  const collector = () => t.app.get(FxCollectorService);
  const keximCalls = () => t.fetch.calls.filter((c) => c.url.includes('oapi.koreaexim.go.kr'));
  const customsCalls = () => t.fetch.calls.filter((c) => c.url.includes('apis.data.go.kr'));
  const json = (body: string, status = 200) =>
    new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
  const xml = (body: string) =>
    new Response(body, { status: 200, headers: { 'Content-Type': 'application/xml' } });

  beforeAll(async () => {
    t = await createTestApp({ overrides: [{ provide: SECRET_STORE, useValue: secrets }] });
    const sub = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
  });

  beforeEach(async () => {
    await truncate(t.prisma, ['fx_rate', 'call_log', ...STEP_ENGINE_TABLES]);
    secrets.reset();
    await secrets.set('KOREAEXIM_API_KEY', KEXIM_KEY);
    await secrets.set('CUSTOMS_SERVICE_KEY', CUSTOMS_KEY);
    t.fetch.reset();
    keximAnswer = () => json(fixture('kexim-jpy100.json'));
    customsAnswer = () => xml(fixture('customs-week.xml'));
    t.fetch.handler = (url) =>
      url.includes('oapi.koreaexim.go.kr') ? keximAnswer() : customsAnswer();
    t.clock.ms = kst('2026-09-28T09:00:00');
    events.length = 0;
  });

  afterAll(async () => {
    unsubscribe();
    await t.app.close();
  });

  describe('GET /fx-rates/latest', () => {
    it('빈 DB → 200 { items: [], warnings: [] }', async () => {
      expect(await latest()).toEqual({ items: [], warnings: [] });
    });

    it('세 종류를 넣은 뒤 → items 3개(COST/JPY → CUSTOMS/JPY → CUSTOMS/USD), rawResponse 키 없음, rateValue는 number', async () => {
      t.clock.ms = kst('2026-09-28T11:00:00');
      await collector().runOnce();
      const body = await latest();
      expect(body.items.map((i) => `${i.rateKind}/${i.currency}/${i.source}`)).toEqual([
        'COST/JPY/KEXIM',
        'CUSTOMS/JPY/CUSTOMS_SERVICE',
        'CUSTOMS/USD/CUSTOMS_SERVICE',
      ]);
      for (const item of body.items) expect(Object.keys(item).sort()).toEqual(RECORD_KEYS);
      expect(body.items.map((i) => [i.rateValue, i.unit])).toEqual([
        [876, 100],
        [876, 100],
        [1358.72, 1],
      ]);
      expect(body.items[0]!.referenceAt).toBe('2026-09-28T02:00:00.000Z');
      expect(body.items[1]!.referenceAt).toBe('2026-09-26T15:00:00.000Z');
      expect(body.warnings).toEqual([]);
    });

    it('종류·통화별 reference_at이 가장 큰 행이 최신값(같으면 나중 행)', async () => {
      await post({
        rateKind: 'COST',
        currency: 'JPY',
        rateValue: 870,
        unit: 100,
        referenceAt: '2026-09-27T11:00:00+09:00',
      }).expect(201);
      const newer = await post({
        rateKind: 'COST',
        currency: 'JPY',
        rateValue: 880,
        unit: 100,
        referenceAt: '2026-09-28T11:00:00+09:00',
      }).expect(201);
      await post({
        rateKind: 'COST',
        currency: 'JPY',
        rateValue: 860,
        unit: 100,
        referenceAt: '2026-09-26T11:00:00+09:00',
      }).expect(201);
      expect((await latest()).items[0]!.id).toBe((newer.body as FxRecordBody).id);
      const same = await post({
        rateKind: 'COST',
        currency: 'JPY',
        rateValue: 881,
        unit: 100,
        referenceAt: '2026-09-28T11:00:00+09:00',
      }).expect(201);
      expect((await latest()).items[0]!.id).toBe((same.body as FxRecordBody).id);
    });

    it('원가 8.76 · 과세 엔 10.52 → FX_DIVERGENCE(+20.09%), 정확히 10.512면 경고 없음', async () => {
      await post({
        rateKind: 'COST',
        currency: 'JPY',
        rateValue: 876,
        unit: 100,
        referenceAt: '2026-09-28T11:00:00+09:00',
      }).expect(201);
      await post({
        rateKind: 'CUSTOMS',
        currency: 'JPY',
        rateValue: 1051.2,
        unit: 100,
        referenceAt: '2026-09-27T00:00:00+09:00',
      }).expect(201);
      expect((await latest()).warnings).toEqual([]);
      events.length = 0;
      await post({
        rateKind: 'CUSTOMS',
        currency: 'JPY',
        rateValue: 10.52,
        unit: 1,
        referenceAt: '2026-09-27T00:00:00+09:00',
      }).expect(201);
      const body = await latest();
      expect(body.warnings).toEqual([
        {
          code: 'FX_DIVERGENCE',
          rateKind: 'CUSTOMS',
          currency: 'JPY',
          message:
            '과세환율(엔) 10.52원/엔이 원가 환율 8.76원/엔과 +20.09% 다릅니다. 두 값을 확인해 주세요.',
        },
      ]);
      const sse = events.filter((e) => e.name === 'fx-rate.updated');
      expect(sse.map((e) => e.data)).toEqual([
        {
          rateKind: 'CUSTOMS',
          currency: 'JPY',
          fxRateId: body.items[1]!.id,
          warningCode: 'FX_DIVERGENCE',
        },
      ]);
    });
  });

  describe('자동 수집(가짜 시계·가짜 fetch 뒤 fixture, 실제 어댑터·관문)', () => {
    it('평일 10:59 KST → 수출입은행을 부르지 않는다', async () => {
      t.clock.ms = kst('2026-09-28T10:59:00');
      const report = await collector().runOnce();
      expect(report.cost).toBe('SKIPPED');
      expect(keximCalls()).toHaveLength(0);
    });

    it('평일 11:00 KST, 오늘 행 없음 → 1회 호출, COST/JPY/KEXIM 1행, call_log 성공(키는 가림), raw_response에 키 없음', async () => {
      t.clock.ms = kst('2026-09-28T11:00:00');
      const report = await collector().runOnce();
      expect(report).toMatchObject({ cost: 'INSERTED', customs: 'INSERTED' });
      expect(keximCalls()).toHaveLength(1);
      expect(keximCalls()[0]!.url).toContain(`authkey=${KEXIM_KEY}`);
      expect(keximCalls()[0]!.url).toContain('searchdate=20260928');
      const rows = await t.prisma.fxRate.findMany({ where: { source: 'KEXIM' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ rateKind: 'COST', currency: 'JPY', unit: 100 });
      expect(rows[0]!.rateValue.toFixed()).toBe('876');
      expect(rows[0]!.referenceAt.toISOString()).toBe('2026-09-28T02:00:00.000Z');
      expect(rows[0]!.rawResponse).toMatchObject({ cur_unit: 'JPY(100)', deal_bas_r: '876.00' });
      const logs = await t.prisma.callLog.findMany({ where: { target: 'FX_KOREAEXIM' } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        succeeded: true,
        errorCode: null,
        itemCount: 1,
        host: 'oapi.koreaexim.go.kr',
      });
      expect(logs[0]!.urlMasked).toContain('authkey=***');
      expect(logs[0]!.urlMasked).not.toContain(KEXIM_KEY);
      const customsLog = await t.prisma.callLog.findFirstOrThrow({
        where: { target: 'FX_CUSTOMS' },
      });
      expect(customsLog.urlMasked).toContain('serviceKey=***');
      expect(customsLog.urlMasked).not.toContain(CUSTOMS_KEY);
      // 새 최신값마다 SSE
      expect(events.filter((e) => e.name === 'fx-rate.updated').map((e) => e.data)).toEqual([
        expect.objectContaining({ rateKind: 'COST', currency: 'JPY', warningCode: null }),
        expect.objectContaining({ rateKind: 'CUSTOMS', currency: 'JPY', warningCode: null }),
        expect.objectContaining({ rateKind: 'CUSTOMS', currency: 'USD', warningCode: null }),
      ]);
    });

    it('같은 날 두 번째 검사 → 호출 안 함', async () => {
      t.clock.ms = kst('2026-09-28T11:00:00');
      await collector().runOnce();
      t.clock.ms = kst('2026-09-28T17:30:00');
      expect(await collector().runOnce()).toEqual({
        cost: 'SKIPPED',
        customs: 'SKIPPED',
        rerunRequiredStepCount: 0,
      });
      expect(keximCalls()).toHaveLength(1);
      expect(customsCalls()).toHaveLength(1);
    });

    it('빈 응답 → 새 행 없음·경고 없음(call_log 성공, 건수 0), 1시간 뒤 다시 부른다', async () => {
      keximAnswer = () => json(fixture('kexim-empty.json'));
      t.clock.ms = kst('2026-09-28T11:00:00');
      expect((await collector().runOnce()).cost).toBe('EMPTY');
      expect(await t.prisma.fxRate.count({ where: { rateKind: 'COST' } })).toBe(0);
      expect(
        await t.prisma.callLog.findFirstOrThrow({ where: { target: 'FX_KOREAEXIM' } }),
      ).toMatchObject({
        succeeded: true,
        errorCode: null,
        itemCount: 0,
      });
      expect((await latest()).warnings).toEqual([]);
      t.clock.ms = kst('2026-09-28T11:30:00');
      expect((await collector().runOnce()).cost).toBe('SKIPPED');
      t.clock.ms = kst('2026-09-28T12:00:00');
      keximAnswer = () => json(fixture('kexim-jpy100.json'));
      expect((await collector().runOnce()).cost).toBe('INSERTED');
    });

    it('HTTP 500 → 새 행 없음, call_log 실패 1행, 최신값 경고 FX_FETCH_FAILED, SSE(warningCode FX_FETCH_FAILED)', async () => {
      // 어제 값이 있다 → 마지막 값을 계속 쓴다
      await post({
        rateKind: 'COST',
        currency: 'JPY',
        rateValue: 870,
        unit: 100,
        referenceAt: '2026-09-25T11:00:00+09:00',
      }).expect(201);
      const http500 = JSON.parse(fixture('kexim-http500.json')) as {
        status: number;
        contentType: string;
        body: string;
      };
      keximAnswer = () =>
        new Response(http500.body, {
          status: http500.status,
          headers: { 'Content-Type': http500.contentType },
        });
      t.clock.ms = kst('2026-09-28T11:00:00');
      events.length = 0;
      expect((await collector().runOnce()).cost).toBe('FAILED');
      expect(await t.prisma.fxRate.count({ where: { source: 'KEXIM' } })).toBe(0);
      const logs = await t.prisma.callLog.findMany({ where: { target: 'FX_KOREAEXIM' } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ succeeded: false, httpStatus: 500, errorCode: 'HTTP_500' });
      const body = await latest();
      expect(body.items[0]).toMatchObject({ rateKind: 'COST', rateValue: 870, source: 'MANUAL' });
      expect(body.warnings).toEqual([
        {
          code: 'FX_FETCH_FAILED',
          rateKind: 'COST',
          currency: 'JPY',
          message:
            '원가 환율 자동 수집이 실패했습니다(2026-09-28 11:00). 마지막 값을 계속 씁니다. 필요하면 환율을 직접 넣어 주세요.',
        },
      ]);
      expect(events.filter((e) => e.name === 'fx-rate.updated').map((e) => e.data)).toContainEqual({
        rateKind: 'COST',
        currency: 'JPY',
        fxRateId: null,
        warningCode: 'FX_FETCH_FAILED',
      });
      // 다음에 성공하면 경고가 사라진다
      keximAnswer = () => json(fixture('kexim-jpy100.json'));
      t.clock.ms = kst('2026-09-28T12:05:00');
      expect((await collector().runOnce()).cost).toBe('INSERTED');
      expect((await latest()).warnings).toEqual([]);
    });

    it('200인데 결과 코드 오류(result 3)·형식 깨진 XML → 실패로 센다(call_log error_code), 새 행 없음', async () => {
      keximAnswer = () => json(fixture('kexim-result3.json'));
      customsAnswer = () => xml(fixture('customs-broken.xml'));
      t.clock.ms = kst('2026-09-28T11:00:00');
      expect(await collector().runOnce()).toMatchObject({ cost: 'FAILED', customs: 'FAILED' });
      expect(await t.prisma.fxRate.count()).toBe(0);
      expect(
        await t.prisma.callLog.findFirstOrThrow({ where: { target: 'FX_KOREAEXIM' } }),
      ).toMatchObject({
        succeeded: true,
        errorCode: 'KEXIM_RESULT_3',
      });
      expect(
        await t.prisma.callLog.findFirstOrThrow({ where: { target: 'FX_CUSTOMS' } }),
      ).toMatchObject({
        errorCode: 'FX_RESPONSE_INVALID',
      });
      expect((await latest()).warnings.map((w) => [w.code, w.rateKind, w.currency])).toEqual([
        ['FX_FETCH_FAILED', 'COST', 'JPY'],
        ['FX_FETCH_FAILED', 'CUSTOMS', null],
      ]);
    });

    it('같은 고시 재수집 → 행 수 그대로, 오류 없음(uq_fx_rate_auto)', async () => {
      // 관세청이 아직 지난주 고시(9/20 시작)를 준다 → 이번 주 행이 없어 1시간 뒤 다시 부르지만 같은 고시다
      customsAnswer = () => xml(fixture('customs-week.xml').replace(/20260927/g, '20260920'));
      t.clock.ms = kst('2026-09-28T09:00:00');
      expect((await collector().runOnce()).customs).toBe('INSERTED');
      expect(await t.prisma.fxRate.count({ where: { source: 'CUSTOMS_SERVICE' } })).toBe(2);
      t.clock.ms = kst('2026-09-28T10:01:00');
      expect((await collector().runOnce()).customs).toBe('UNCHANGED');
      expect(customsCalls()).toHaveLength(2);
      expect(await t.prisma.fxRate.count({ where: { source: 'CUSTOMS_SERVICE' } })).toBe(2);
    });

    it('키 없음 → 외부 호출 0회, call_log 실패 1행(SECRET_NOT_CONFIGURED), 키 안내 경고', async () => {
      secrets.reset();
      t.clock.ms = kst('2026-09-28T11:00:00');
      expect(await collector().runOnce()).toMatchObject({ cost: 'FAILED', customs: 'FAILED' });
      expect(t.fetch.calls).toHaveLength(0);
      const logs = await t.prisma.callLog.findMany({ orderBy: { id: 'asc' } });
      expect(logs.map((l) => [l.target, l.succeeded, l.errorCode, l.host, l.urlMasked])).toEqual([
        ['FX_KOREAEXIM', false, 'SECRET_NOT_CONFIGURED', null, null],
        ['FX_CUSTOMS', false, 'SECRET_NOT_CONFIGURED', null, null],
      ]);
      const warnings = (await latest()).warnings;
      expect(warnings[0]!.message).toBe(
        '한국수출입은행 환율 API 키가 없어 원가 환율을 자동으로 받지 못했습니다. 시스템 상태에서 키를 넣거나 환율을 직접 넣어 주세요.',
      );
      expect(warnings[1]!.message).toContain('관세청 과세환율 키가 없어 과세환율을');
    });

    it('응답 항목에 authkey 최상위 키가 있어도 저장 전에 빠진다(DB CHECK까지 가지 않음)', async () => {
      const items = JSON.parse(fixture('kexim-jpy100.json')) as Record<string, unknown>[];
      items[1] = { ...items[1], authkey: 'LEAKED-VALUE', serviceKey: 'LEAKED-2' };
      keximAnswer = () => json(JSON.stringify(items));
      t.clock.ms = kst('2026-09-28T11:00:00');
      expect((await collector().runOnce()).cost).toBe('INSERTED');
      const row = await t.prisma.fxRate.findFirstOrThrow({ where: { source: 'KEXIM' } });
      expect(Object.keys(row.rawResponse as object)).not.toContain('authkey');
      expect(JSON.stringify(row.rawResponse)).not.toContain('LEAKED');
    });

    it('토요일에는 원가 환율을 부르지 않고, 앱이 11시에 꺼져 있었으면 켤 때(15시) 오늘 몫을 받는다', async () => {
      t.clock.ms = kst('2026-10-03T12:00:00');
      expect((await collector().runOnce()).cost).toBe('SKIPPED');
      t.clock.ms = kst('2026-10-05T15:00:00');
      expect((await collector().runOnce()).cost).toBe('INSERTED');
      expect(keximCalls()[0]!.url).toContain('searchdate=20261005');
    });
  });

  describe('POST /fx-rates(수동 입력)', () => {
    const body = {
      rateKind: 'COST',
      currency: 'JPY',
      rateValue: 876.5,
      unit: 100,
      sourceNote: '하나은행 고시 확인',
      referenceAt: '2026-09-28T11:00:00+09:00',
    };

    it('정상 → 201, source=MANUAL, 보낸 값 그대로(rateValue number), 감사 기록', async () => {
      const res = await post(body).expect(201);
      const record = res.body as FxRecordBody;
      expect(Object.keys(record).sort()).toEqual(RECORD_KEYS);
      expect(record).toMatchObject({
        rateKind: 'COST',
        currency: 'JPY',
        rateValue: 876.5,
        unit: 100,
        source: 'MANUAL',
        sourceNote: '하나은행 고시 확인',
        referenceAt: '2026-09-28T02:00:00.000Z',
        collectedAt: '2026-09-28T00:00:00.000Z',
      });
      const audit = await t.prisma.userActionLog.findMany({
        where: { eventType: 'SETTING_CHANGED' },
      });
      expect(audit.map((a) => a.detail)).toEqual([
        { setting: 'FX_RATE_MANUAL', fxRateId: record.id, rateKind: 'COST', currency: 'JPY' },
      ]);
      expect(events.filter((e) => e.name === 'fx-rate.updated').map((e) => e.data)).toEqual([
        { rateKind: 'COST', currency: 'JPY', fxRateId: record.id, warningCode: null },
      ]);
    });

    it('같은 수동 입력 두 번 → 201 두 번, 행 2개(수동은 여러 번 허용)', async () => {
      await post(body).expect(201);
      await post(body).expect(201);
      expect(await t.prisma.fxRate.count({ where: { source: 'MANUAL' } })).toBe(2);
    });

    it('USD + unit=100 → 422 VALIDATION_FAILED(unit)', async () => {
      const res = await post({ ...body, rateKind: 'CUSTOMS', currency: 'USD', unit: 100 }).expect(
        422,
      );
      expect(res.body as ErrorBody).toMatchObject({
        code: 'VALIDATION_FAILED',
        fieldErrors: [{ field: 'unit', message: '달러(USD)는 단위 1만 넣을 수 있습니다.' }],
      });
    });

    it('rateValue 0·음수·글자·소수 다섯째 자리 → 422 VALIDATION_FAILED', async () => {
      for (const rateValue of [0, -1, '876', 8.12345]) {
        const res = await post({ ...body, rateValue }).expect(422);
        expect((res.body as ErrorBody).code).toBe('VALIDATION_FAILED');
        expect((res.body as ErrorBody).fieldErrors!.map((e) => e.field)).toContain('rateValue');
      }
    });

    it('원가 환율인데 USD → 422(Proposed), 모르는 칸·빠진 칸·틀린 시각 → 422', async () => {
      const cost = await post({ ...body, currency: 'USD', unit: 1 }).expect(422);
      expect((cost.body as ErrorBody).fieldErrors).toEqual([
        {
          field: 'currency',
          message: '원가 환율은 엔(JPY)만 넣을 수 있습니다.',
          rejectedValue: 'USD',
        },
      ]);
      await post({ ...body, source: 'KEXIM' }).expect(422);
      await post({ ...body, referenceAt: undefined }).expect(422);
      await post({ ...body, referenceAt: '2026-09-28' }).expect(422);
      await post({ ...body, sourceNote: 'x'.repeat(201) }).expect(422);
      expect(await t.prisma.fxRate.count()).toBe(0);
    });

    it('X-AutoStore-Client 없음 → 403 CLIENT_HEADER_REQUIRED', async () => {
      const res = await post(body, false).expect(403);
      expect((res.body as ErrorBody).code).toBe('CLIENT_HEADER_REQUIRED');
    });
  });

  describe('GET /fx-rates(이력)', () => {
    beforeEach(async () => {
      t.clock.ms = kst('2026-09-28T11:00:00');
      await collector().runOnce();
    });

    it('?sort=foo,asc → 422 INVALID_QUERY_PARAMETER, 허용 밖 필터 값도 422', async () => {
      expect(
        ((await http().get('/api/v1/fx-rates?sort=foo,asc').expect(422)).body as ErrorBody).code,
      ).toBe('INVALID_QUERY_PARAMETER');
      expect(
        ((await http().get('/api/v1/fx-rates?rateKind=BASE').expect(422)).body as ErrorBody).code,
      ).toBe('INVALID_QUERY_PARAMETER');
      await http().get('/api/v1/fx-rates?size=101').expect(422);
    });

    it('?rateKind=CUSTOMS&size=1 → content 1개, page.totalElements 2, rawResponse 없음', async () => {
      const res = await http().get('/api/v1/fx-rates?rateKind=CUSTOMS&size=1').expect(200);
      const page = res.body as { content: FxRecordBody[]; page: Record<string, number> };
      expect(page.content).toHaveLength(1);
      expect(Object.keys(page.content[0]!).sort()).toEqual(RECORD_KEYS);
      expect(page.page).toEqual({ number: 0, size: 1, totalElements: 2, totalPages: 2 });
    });

    it('기본 정렬 referenceAt,desc · currency·source 필터', async () => {
      const all = (await http().get('/api/v1/fx-rates').expect(200)).body as {
        content: FxRecordBody[];
      };
      expect(all.content.map((r) => r.referenceAt)).toEqual([
        '2026-09-28T02:00:00.000Z',
        '2026-09-26T15:00:00.000Z',
        '2026-09-26T15:00:00.000Z',
      ]);
      const usd = (
        await http().get('/api/v1/fx-rates?currency=USD&source=CUSTOMS_SERVICE').expect(200)
      ).body as { content: FxRecordBody[] };
      expect(usd.content.map((r) => r.rateValue)).toEqual([1358.72]);
      const asc = (await http().get('/api/v1/fx-rates?sort=referenceAt,asc').expect(200)).body as {
        content: FxRecordBody[];
      };
      expect(asc.content[0]!.referenceAt).toBe('2026-09-26T15:00:00.000Z');
    });
  });

  describe('③ 재실행 필요 전파(규칙 10, P1-05 규칙대로)', () => {
    async function pricingCandidate(perUnit: string, status?: 'AWAITING_APPROVAL' | 'REGISTERING') {
      const fixture = await createCandidate(t.prisma, {
        gender: 'MALE',
        ...(status ? { status, steps: allRequiredCompleted() } : {}),
      });
      await insertStepRun(t.prisma, {
        candidateId: fixture.candidate.id,
        stepCode: 'PRICING',
        status: 'COMPLETED',
        inputs: [
          { inputKey: 'fx.costJpy', sourceType: 'SETTINGS', value: { perUnit } },
          { inputKey: 'fx.customsJpy', sourceType: 'SETTINGS', value: { perUnit: '8.76' } },
        ],
      });
      return fixture.candidate.id;
    }
    const pricingStep = (candidateId: number) =>
      t.prisma.candidateStep.findUniqueOrThrow({
        where: { candidateId_stepCode: { candidateId, stepCode: 'PRICING' } },
      });

    it('새 최신 원가 환율(값이 다름) → 그 값을 읽은 ③만 RERUN_REQUIRED(fx.costJpy), 자동 실행 없음, SSE', async () => {
      const used = await pricingCandidate('8.76');
      events.length = 0;
      await post({
        rateKind: 'COST',
        currency: 'JPY',
        rateValue: 880,
        unit: 100,
        referenceAt: '2026-09-28T11:00:00+09:00',
      }).expect(201);
      expect(await pricingStep(used)).toMatchObject({
        status: 'RERUN_REQUIRED',
        staleInputs: ['fx.costJpy'],
      });
      expect(await t.prisma.stepRun.count({ where: { candidateId: used } })).toBe(1);
      expect(events.filter((e) => e.name === 'candidate-step.changed').map((e) => e.data)).toEqual([
        expect.objectContaining({
          candidateId: used,
          stepCode: 'PRICING',
          status: 'RERUN_REQUIRED',
        }),
      ]);
    });

    it('같은 계산값(876/100 = 8.76/1)이면 새 행이어도 재실행 필요가 되지 않는다', async () => {
      const used = await pricingCandidate('8.76');
      await post({
        rateKind: 'COST',
        currency: 'JPY',
        rateValue: 8.76,
        unit: 1,
        referenceAt: '2026-09-28T11:00:00+09:00',
      }).expect(201);
      expect((await pricingStep(used)).status).toBe('COMPLETED');
    });

    it('최신값이 아닌 수동 입력(더 옛날 기준 시각)은 전파하지 않는다', async () => {
      await post({
        rateKind: 'COST',
        currency: 'JPY',
        rateValue: 876,
        unit: 100,
        referenceAt: '2026-09-28T11:00:00+09:00',
      }).expect(201);
      const used = await pricingCandidate('8.76');
      events.length = 0;
      await post({
        rateKind: 'COST',
        currency: 'JPY',
        rateValue: 900,
        unit: 100,
        referenceAt: '2026-09-20T11:00:00+09:00',
      }).expect(201);
      expect((await pricingStep(used)).status).toBe('COMPLETED');
      expect(events.filter((e) => e.name === 'fx-rate.updated')).toEqual([]);
    });

    it('자동 수집의 새 최신값도 전파한다. 승인대기 후보는 작업중으로, 잠긴 후보(등록요청중)는 건너뛴다', async () => {
      const waiting = await pricingCandidate('9.00', 'AWAITING_APPROVAL');
      const locked = await pricingCandidate('9.00', 'REGISTERING');
      t.clock.ms = kst('2026-09-28T11:00:00');
      const report = await collector().runOnce();
      expect(report.rerunRequiredStepCount).toBe(1);
      expect((await pricingStep(waiting)).status).toBe('RERUN_REQUIRED');
      expect((await t.prisma.candidate.findUniqueOrThrow({ where: { id: waiting } })).status).toBe(
        'WORKING',
      );
      expect((await pricingStep(locked)).status).toBe('COMPLETED');
    });
  });

  describe('③이 쓰는 창구 getLatestForJudgement(P2-05)', () => {
    it('3종 중 하나라도 없으면 409 FX_RATE_UNAVAILABLE(details.missing), 다 있으면 id·계산값', async () => {
      const service = t.app.get(FxRatesService);
      await post({
        rateKind: 'COST',
        currency: 'JPY',
        rateValue: 876,
        unit: 100,
        referenceAt: '2026-09-28T11:00:00+09:00',
      }).expect(201);
      await expect(service.getLatestForJudgement()).rejects.toMatchObject({
        code: 'FX_RATE_UNAVAILABLE',
        details: { missing: ['CUSTOMS/JPY', 'CUSTOMS/USD'] },
      });
      t.clock.ms = kst('2026-09-28T09:00:00');
      await collector().runOnce();
      const rates = await service.getLatestForJudgement();
      expect(rates.cost.perUnit.toFixed()).toBe('8.76');
      expect(rates.customsJpy.perUnit.toFixed()).toBe('8.76');
      expect(rates.customsUsd).toMatchObject({
        currency: 'USD',
        unit: 1,
        source: 'CUSTOMS_SERVICE',
      });
      expect(rates.customsUsd.perUnit.toFixed()).toBe('1358.72');
    });
  });

  describe('DB 트리거(fx_rate_append_only)', () => {
    it('fx_rate UPDATE·DELETE는 오류로 막힌다', async () => {
      await post({
        rateKind: 'COST',
        currency: 'JPY',
        rateValue: 876,
        unit: 100,
        referenceAt: '2026-09-28T11:00:00+09:00',
      }).expect(201);
      await expect(t.prisma.$executeRawUnsafe('UPDATE fx_rate SET rate_value = 1')).rejects.toThrow(
        /append-only/,
      );
      await expect(t.prisma.$executeRawUnsafe('DELETE FROM fx_rate')).rejects.toThrow(
        /append-only/,
      );
      await expect(
        t.prisma.$executeRawUnsafe(
          `INSERT INTO fx_rate (rate_kind, currency, rate_value, unit, source, reference_at, raw_response) VALUES ('COST','JPY',1,1,'KEXIM',now(),'{"authkey":"x"}')`,
        ),
      ).rejects.toThrow(/ck_fx_no_secret/);
    });
  });
});
