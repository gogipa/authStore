import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { BE_ROOT } from '../../../common/config/paths.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { FxFixtureAdapter } from '../../integrations/fx/fx-fixture.adapter.js';
import type { FxFetchOutcome } from '../../integrations/fx/fx-source.port.js';
import type { Clock } from '../../integrations/http/clock.token.js';
import { defaultFxCollectSchedule, FxCollectorService } from './fx-collector.service.js';
import type { CollectedFxRate, FxRatesService } from './fx-rates.service.js';

const FIXTURES = join(BE_ROOT, 'test', 'fixtures', 'fx');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const kst = (text: string) => new Date(`${text}+09:00`);

type Row = Pick<CollectedFxRate, 'rateKind' | 'currency' | 'source' | 'referenceAt'> & {
  rateValue: string;
  unit: number;
  rawResponse: unknown;
};

/**
 * 수집기 단위 테스트용 세계: fx_rate 행·call_log 호출 시각(메모리)과 가짜 시계.
 * 실제 DB·관문 흐름(call_log 실패 행·경고·중복 막기 SQL)은 test/fx-rates.e2e-spec.ts가 본다.
 */
class World {
  now = kst('2026-09-28T09:00:00');
  rows: Row[] = [];
  calls: { target: 'FX_KOREAEXIM' | 'FX_CUSTOMS'; calledAt: Date }[] = [];
  failed: string[] = [];
  readonly clock: Clock = { now: () => this.now, sleep: () => Promise.resolve() };

  readonly prisma = {
    fxRate: {
      count: ({
        where,
      }: {
        where: { rateKind: string; currency: string; source: string; referenceAt: Date };
      }) =>
        Promise.resolve(
          this.rows.filter(
            (r) =>
              r.rateKind === where.rateKind &&
              r.currency === where.currency &&
              r.source === where.source &&
              r.referenceAt.getTime() === where.referenceAt.getTime(),
          ).length,
        ),
      findMany: ({
        where,
      }: {
        where: { rateKind: string; source: string; referenceAt: { gte: Date; lt: Date } };
      }) =>
        Promise.resolve(
          [
            ...new Set(
              this.rows
                .filter(
                  (r) =>
                    r.rateKind === where.rateKind &&
                    r.source === where.source &&
                    r.referenceAt >= where.referenceAt.gte &&
                    r.referenceAt < where.referenceAt.lt,
                )
                .map((r) => r.currency),
            ),
          ].map((currency) => ({ currency })),
        ),
    },
    callLog: {
      findFirst: ({ where }: { where: { target: string } }) => {
        const last = this.calls.filter((c) => c.target === where.target).at(-1);
        return Promise.resolve(last ? { calledAt: last.calledAt } : null);
      },
    },
  };

  readonly rates = {
    saveCollected: (rows: readonly CollectedFxRate[]) => {
      const inserted: Row[] = [];
      for (const row of rows) {
        const dup = this.rows.some(
          (r) =>
            r.rateKind === row.rateKind &&
            r.currency === row.currency &&
            r.source === row.source &&
            r.referenceAt.getTime() === row.referenceAt.getTime(),
        );
        if (dup) continue;
        const saved = { ...row, rateValue: row.rateValue.toFixed() };
        this.rows.push(saved);
        inserted.push(saved);
      }
      return Promise.resolve({ inserted, rerunRequiredStepCount: 0 });
    },
    publishFetchFailed: (kind: string) => {
      this.failed.push(kind);
    },
  };

  readonly source = new FxFixtureAdapter();

  /** 부를 때마다 call_log 호출 시각을 남기는 응답 */
  answerCost(
    outcome: FxFetchOutcome<never> | ReturnType<typeof FxFixtureAdapter.costFromBody>,
  ): void {
    this.source.answerCost(() => {
      this.calls.push({ target: 'FX_KOREAEXIM', calledAt: this.now });
      return outcome;
    });
  }

  answerCustoms(outcome: ReturnType<typeof FxFixtureAdapter.customsFromBody>): void {
    this.source.answerCustoms(() => {
      this.calls.push({ target: 'FX_CUSTOMS', calledAt: this.now });
      return outcome;
    });
  }

  collector(): FxCollectorService {
    return new FxCollectorService(
      this.prisma as unknown as PrismaService,
      this.rates as unknown as FxRatesService,
      this.source,
      defaultFxCollectSchedule(false),
      this.clock,
    );
  }
}

describe('환율 자동 수집기(FxCollectorService, Clock 주입)', () => {
  let w: World;

  // 수집 결과 로그는 테스트 출력에 섞지 않는다(ESM이라 jest.spyOn 대신 직접 바꾼다)
  const original = { log: Logger.prototype.log, warn: Logger.prototype.warn };
  beforeAll(() => {
    Logger.prototype.log = () => undefined;
    Logger.prototype.warn = () => undefined;
  });

  afterAll(() => {
    Logger.prototype.log = original.log;
    Logger.prototype.warn = original.warn;
  });

  beforeEach(() => {
    w = new World();
    w.answerCost(FxFixtureAdapter.costFromBody(fixture('kexim-jpy100.json')));
    w.answerCustoms(FxFixtureAdapter.customsFromBody(fixture('customs-week.xml')));
  });

  it('평일 10:59 KST → 원가 환율을 부르지 않는다', async () => {
    w.now = kst('2026-09-28T10:59:00');
    const report = await w.collector().runOnce();
    expect(report.cost).toBe('SKIPPED');
    expect(w.source.callsOf('fetchCostJpy')).toEqual([]);
  });

  it('평일 11:00 KST, 오늘 행 없음 → 1회 호출, COST/JPY/KEXIM 1행(876 · 단위 100 · 기준 11:00)', async () => {
    w.now = kst('2026-09-28T11:00:00');
    const report = await w.collector().runOnce();
    expect(report.cost).toBe('INSERTED');
    expect(w.source.callsOf('fetchCostJpy')).toEqual(['2026-09-28']);
    const cost = w.rows.filter((r) => r.rateKind === 'COST');
    expect(cost).toHaveLength(1);
    expect(cost[0]).toMatchObject({
      currency: 'JPY',
      source: 'KEXIM',
      rateValue: '876',
      unit: 100,
      referenceAt: kst('2026-09-28T11:00:00'),
    });
    expect(cost[0]!.rawResponse).toMatchObject({ cur_unit: 'JPY(100)', deal_bas_r: '876.00' });
  });

  it('같은 날 두 번째 검사 → 호출 안 함(과세환율도 이번 주 행이 있어 안 부른다)', async () => {
    w.now = kst('2026-09-28T11:00:00');
    const collector = w.collector();
    await collector.runOnce();
    w.now = kst('2026-09-28T16:00:00');
    const second = await collector.runOnce();
    expect(second).toEqual({ cost: 'SKIPPED', customs: 'SKIPPED', rerunRequiredStepCount: 0 });
    expect(w.source.callsOf('fetchCostJpy')).toHaveLength(1);
    expect(w.source.callsOf('fetchCustomsRates')).toHaveLength(1);
  });

  it('과세환율: 이번 주 행이 없으면 JPY(100엔 → 단위 100)·USD(단위 1) 두 행, 기준 = 적용 시작일 00:00 KST', async () => {
    w.now = kst('2026-09-28T09:00:00');
    const report = await w.collector().runOnce();
    expect(report.customs).toBe('INSERTED');
    const customs = w.rows.filter((r) => r.rateKind === 'CUSTOMS');
    expect(customs.map((r) => [r.currency, r.rateValue, r.unit, r.source])).toEqual([
      ['JPY', '876', 100, 'CUSTOMS_SERVICE'],
      ['USD', '1358.72', 1, 'CUSTOMS_SERVICE'],
    ]);
    expect(customs[0]!.referenceAt).toEqual(kst('2026-09-27T00:00:00'));
  });

  it('빈 응답 fixture → 새 행 없음, 실패 알림 없음(Proposed: 휴일·11시 전은 실패가 아니다)', async () => {
    w.answerCost(FxFixtureAdapter.costFromBody(fixture('kexim-empty.json')));
    w.now = kst('2026-09-28T11:05:00');
    const report = await w.collector().runOnce();
    expect(report.cost).toBe('EMPTY');
    expect(w.rows.filter((r) => r.rateKind === 'COST')).toEqual([]);
    expect(w.failed).toEqual([]);
  });

  it('HTTP 500 → 새 행 없음, 실패 알림(FX_FETCH_FAILED SSE). 1시간 안에는 다시 부르지 않는다', async () => {
    w.answerCost(FxFixtureAdapter.failed('HTTP_500'));
    w.now = kst('2026-09-28T11:00:00');
    const collector = w.collector();
    expect((await collector.runOnce()).cost).toBe('FAILED');
    expect(w.rows.filter((r) => r.rateKind === 'COST')).toEqual([]);
    expect(w.failed).toEqual(['COST']);
    w.now = kst('2026-09-28T11:30:00');
    expect((await collector.runOnce()).cost).toBe('SKIPPED');
    w.now = kst('2026-09-28T12:00:00');
    w.answerCost(FxFixtureAdapter.costFromBody(fixture('kexim-jpy100.json')));
    expect((await collector.runOnce()).cost).toBe('INSERTED');
  });

  it('같은 고시 재수집 → 행 수 그대로, 오류 없음(UNCHANGED)', async () => {
    // 지난주 고시(적용 시작 9/20)가 이미 있고, 이번 주에도 관세청이 아직 지난주 값을 준다
    const lastWeek = fixture('customs-week.xml').replace(/20260927/g, '20260920');
    w.answerCustoms(FxFixtureAdapter.customsFromBody(lastWeek));
    w.now = kst('2026-09-28T09:00:00');
    const collector = w.collector();
    expect((await collector.runOnce()).customs).toBe('INSERTED');
    const before = w.rows.length;
    w.now = kst('2026-09-28T10:30:00');
    expect((await collector.runOnce()).customs).toBe('UNCHANGED');
    expect(w.rows).toHaveLength(before);
  });

  it('동시에 두 번 부르면 한 번만 돈다(single-flight)', async () => {
    w.now = kst('2026-09-28T11:00:00');
    const collector = w.collector();
    const [a, b] = await Promise.all([collector.runOnce(), collector.runOnce()]);
    expect(a).toBe(b);
    expect(w.source.callsOf('fetchCostJpy')).toHaveLength(1);
  });
});
