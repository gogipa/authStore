import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { toKstDate } from '../../../common/time/kst.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  FX_SOURCE_PORT,
  type FxFetchOutcome,
  type FxSourcePort,
} from '../../integrations/fx/fx-source.port.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import { FxRatesService, type CollectedFxRate } from './fx-rates.service.js';
import {
  normalizeCostRate,
  normalizeCustomsRate,
  stripSecretKeys,
  type FxRateKind,
} from './fx-rate.normalize.js';
import {
  customsReferenceAt,
  customsWeekEnd,
  customsWeekStart,
  FX_RETRY_AFTER_MS,
  keximReferenceAt,
  planFxCollection,
  type FxCollectionState,
} from './fx-schedule.js';

/** 자동 수집 설정(주입 토큰). 테스트는 `{ enabled: false }`로 끈다(createTestApp) — 수집은 `runOnce()`로 직접 부른다 */
export interface FxCollectSchedule {
  enabled: boolean;
  /** 앱을 켜고 첫 검사까지(ms) */
  initialDelayMs: number;
  /** 검사 간격(ms) */
  intervalMs: number;
  /** 실패·빈 응답 뒤 같은 출처를 다시 부르기까지(ms) */
  retryAfterMs: number;
}

export const FX_COLLECT_SCHEDULE = Symbol('FX_COLLECT_SCHEDULE');

/** Proposed: 앱 시작 15초 뒤 한 번 + 10분마다 검사(부르는 것은 계획이 필요하다고 할 때만), 실패 뒤 1시간 */
export const FX_COLLECT_DEFAULTS = {
  initialDelayMs: 15_000,
  intervalMs: 10 * 60_000,
  retryAfterMs: FX_RETRY_AFTER_MS,
} as const;

export function defaultFxCollectSchedule(enabled: boolean): FxCollectSchedule {
  return { enabled, ...FX_COLLECT_DEFAULTS };
}

/** 출처 하나의 이번 결과 */
export type FxCollectStatus = 'SKIPPED' | 'INSERTED' | 'UNCHANGED' | 'EMPTY' | 'FAILED';

export interface FxCollectReport {
  cost: FxCollectStatus;
  customs: FxCollectStatus;
  rerunRequiredStepCount: number;
}

/**
 * 환율 자동 수집(F-BS-40·41·42, P2-04 규칙 1·2·4·5). 방식은 Proposed: 새 의존성(@nestjs/schedule) 없이 `setTimeout`(앱 시작 뒤
 * 한 번) + `setInterval`(10분마다) — 둘 다 unref. 검사마다 '오늘(KST) 원가 환율'·'이번 주 과세환율'이 있는지 보고 없을 때만
 * 부른다(`planFxCollection`, 시각은 주입한 CLOCK). 앱이 11시에 꺼져 있었으면 켤 때 오늘 몫을 받는다.
 * - 새 행이면 `FxRatesService.saveCollected`가 ③ 재실행 필요 전파 + SSE. 같은 고시면 새 행 없이 성공(UNCHANGED)
 * - 빈 응답(휴일·11시 전)은 행·경고 없이 EMPTY. 실패는 행 없이 마지막 값을 계속 쓰고 SSE `FX_FETCH_FAILED`(call_log는 어댑터가 남긴다)
 * 끄기: 환경변수 `FX_AUTO_COLLECT=off`(06-4), 테스트는 `FX_COLLECT_SCHEDULE` 토큰을 `{ enabled: false }`로.
 */
@Injectable()
export class FxCollectorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FxCollectorService.name);
  private startTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private running: Promise<FxCollectReport> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: FxRatesService,
    @Inject(FX_SOURCE_PORT) private readonly source: FxSourcePort,
    @Inject(FX_COLLECT_SCHEDULE) private readonly schedule: FxCollectSchedule,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.schedule.enabled) return;
    this.startTimer = setTimeout(() => void this.tick(), this.schedule.initialDelayMs);
    this.startTimer.unref();
    this.intervalTimer = setInterval(() => void this.tick(), this.schedule.intervalMs);
    this.intervalTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startTimer = null;
    this.intervalTimer = null;
  }

  /** 한 번 검사하고 필요한 출처를 부른다. 이미 도는 중이면 그 결과를 같이 쓴다 */
  runOnce(): Promise<FxCollectReport> {
    if (!this.running) {
      this.running = this.collect().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  /** 지금 상태(오늘 원가 환율·이번 주 과세환율·마지막 호출 시각) — 계획의 입력 */
  async state(now: Date): Promise<FxCollectionState> {
    const weekStart = customsWeekStart(now);
    const weekEnd = customsWeekEnd(weekStart);
    const [todayCost, weekCustoms, lastCost, lastCustoms] = await Promise.all([
      this.prisma.fxRate.count({
        where: {
          rateKind: 'COST',
          currency: 'JPY',
          source: 'KEXIM',
          referenceAt: keximReferenceAt(toKstDate(now)),
        },
      }),
      this.prisma.fxRate.findMany({
        where: {
          rateKind: 'CUSTOMS',
          source: 'CUSTOMS_SERVICE',
          referenceAt: { gte: weekStart, lt: weekEnd },
        },
        select: { currency: true },
        distinct: ['currency'],
      }),
      this.prisma.callLog.findFirst({
        where: { target: 'FX_KOREAEXIM' },
        orderBy: [{ calledAt: 'desc' }, { id: 'desc' }],
        select: { calledAt: true },
      }),
      this.prisma.callLog.findFirst({
        where: { target: 'FX_CUSTOMS' },
        orderBy: [{ calledAt: 'desc' }, { id: 'desc' }],
        select: { calledAt: true },
      }),
    ]);
    const currencies = new Set(weekCustoms.map((r) => r.currency));
    return {
      now,
      hasTodayCost: todayCost > 0,
      hasThisWeekCustoms: currencies.has('JPY') && currencies.has('USD'),
      lastCostCallAt: lastCost?.calledAt ?? null,
      lastCustomsCallAt: lastCustoms?.calledAt ?? null,
    };
  }

  private async tick(): Promise<void> {
    try {
      await this.runOnce();
    } catch (e) {
      this.logger.error({ err: e }, '환율 자동 수집 검사에 실패했습니다');
    }
  }

  private async collect(): Promise<FxCollectReport> {
    const now = this.clock.now();
    const plan = planFxCollection(await this.state(now), this.schedule.retryAfterMs);
    let rerunRequiredStepCount = 0;
    const run = async (
      kind: FxRateKind,
      enabled: boolean,
      fetch: () => Promise<{ status: FxCollectStatus; rerun: number }>,
    ): Promise<FxCollectStatus> => {
      if (!enabled) return 'SKIPPED';
      try {
        const { status, rerun } = await fetch();
        rerunRequiredStepCount += rerun;
        return status;
      } catch (e) {
        this.logger.error({ err: e }, `${kind} 환율 수집 중 오류가 났습니다`);
        this.rates.publishFetchFailed(kind);
        return 'FAILED';
      }
    };
    const cost = await run('COST', plan.cost, () => this.collectCost(now));
    const customs = await run('CUSTOMS', plan.customs, () => this.collectCustoms(now));
    if (cost !== 'SKIPPED' || customs !== 'SKIPPED') {
      this.logger.log(
        `환율 자동 수집: 원가 ${cost} · 과세 ${customs} · 재실행 필요 ${rerunRequiredStepCount}개`,
      );
    }
    return { cost, customs, rerunRequiredStepCount };
  }

  private async collectCost(now: Date): Promise<{ status: FxCollectStatus; rerun: number }> {
    const kstDate = toKstDate(now);
    const outcome = await this.source.fetchCostJpy(kstDate);
    const early = this.earlyStatus('COST', outcome);
    if (early) return { status: early, rerun: 0 };
    if (outcome.kind !== 'OK') return { status: 'EMPTY', rerun: 0 };
    const raw = outcome.rates[0]!;
    const normalized = normalizeCostRate(raw);
    if (!normalized) return this.invalidValue('COST', raw.dealBasR);
    return this.save([
      {
        rateKind: 'COST',
        currency: 'JPY',
        rateValue: normalized.rateValue,
        unit: normalized.unit,
        source: 'KEXIM',
        referenceAt: keximReferenceAt(kstDate),
        rawResponse: stripSecretKeys(raw.raw),
      },
    ]);
  }

  private async collectCustoms(now: Date): Promise<{ status: FxCollectStatus; rerun: number }> {
    const outcome = await this.source.fetchCustomsRates(toKstDate(now));
    const early = this.earlyStatus('CUSTOMS', outcome);
    if (early) return { status: early, rerun: 0 };
    if (outcome.kind !== 'OK') return { status: 'EMPTY', rerun: 0 };
    const rows: CollectedFxRate[] = [];
    for (const raw of outcome.rates) {
      const normalized = normalizeCustomsRate(raw);
      if (!normalized) return this.invalidValue('CUSTOMS', raw.rate);
      rows.push({
        rateKind: 'CUSTOMS',
        currency: normalized.currency,
        rateValue: normalized.rateValue,
        unit: normalized.unit,
        source: 'CUSTOMS_SERVICE',
        referenceAt: customsReferenceAt(raw.applyStartDate, now),
        rawResponse: stripSecretKeys(raw.raw),
      });
    }
    return this.save(rows);
  }

  /** 실패·빈 응답이면 그 상태(실패는 SSE로 알린다), 받은 값이 있으면 null */
  private earlyStatus<T>(kind: FxRateKind, outcome: FxFetchOutcome<T>): FxCollectStatus | null {
    if (outcome.kind === 'FAILED') {
      this.logger.warn(`${kind} 환율 자동 수집 실패(${outcome.errorCode}): ${outcome.message}`);
      this.rates.publishFetchFailed(kind);
      return 'FAILED';
    }
    return outcome.kind === 'EMPTY' ? 'EMPTY' : null;
  }

  private invalidValue(kind: FxRateKind, text: string): { status: FxCollectStatus; rerun: number } {
    this.logger.warn(
      `${kind} 환율 값을 읽지 못했습니다(${text.slice(0, 40)}) — 새 행을 만들지 않았습니다`,
    );
    this.rates.publishFetchFailed(kind);
    return { status: 'FAILED', rerun: 0 };
  }

  private async save(rows: CollectedFxRate[]): Promise<{ status: FxCollectStatus; rerun: number }> {
    const { inserted, rerunRequiredStepCount } = await this.rates.saveCollected(rows);
    return {
      status: inserted.length > 0 ? 'INSERTED' : 'UNCHANGED',
      rerun: rerunRequiredStepCount,
    };
  }
}
