import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type { CallUsageChangedEvent } from '../../../common/events/progress-event.types.js';
import {
  nextKstMidnight,
  startOfKstDay,
  toKstDate,
  toKstDateValue,
} from '../../../common/time/kst.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../http/clock.token.js';
import { DAILY_LIMIT_PROVIDER, type DailyLimitProvider } from '../http/daily-limit.provider.js';
import {
  CALL_LOG_TARGETS,
  type CallLogTarget,
  COOLDOWN_HTTP_STATUSES,
  COOLDOWN_MS,
  EXTERNAL_TARGETS,
} from '../http/external-targets.js';
import {
  type CallUsageByTargetDto,
  type CallUsageListDto,
  type CountsByFetchReason,
  RAKUTEN_FETCH_REASONS,
} from './call-usage.dto.js';

export interface ActiveCooldown {
  blockedUntil: Date;
  httpStatus: 403 | 418 | 429;
}

/** KST 0시 타이머를 0시 직후에 돌리기 위한 여유(ms) */
const MIDNIGHT_SLACK_MS = 1000;

/**
 * 오늘 외부 조회 수·하루 상한·24시간 쉼 상태(05-2 getCallUsage, ERD 결정 ⑦).
 * 원본은 call_log 하나다. 메모리로 따로 세지 않아 앱을 다시 켜도 판단이 같다.
 */
@Injectable()
export class CallUsageService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CallUsageService.name);
  private midnightTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: ProgressEventsService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DAILY_LIMIT_PROVIDER) private readonly dailyLimit: DailyLimitProvider,
  ) {}

  /**
   * GET /call-usage에 넣는 대상. Proposed(06-2 §9): 허용 표에 호스트가 있는 대상(= 이 앱이 HTTP로 부르는 대상),
   * CallLogTarget 순서. 지금은 COMMERCE_API·RAKUTEN_API·RAKUTEN_PAGE·DATALAB, P2-04 뒤 환율 두 곳이 더해진다.
   */
  listedTargets(): CallLogTarget[] {
    return CALL_LOG_TARGETS.filter((t) => EXTERNAL_TARGETS[t].hosts.length > 0);
  }

  async getCallUsage(): Promise<CallUsageListDto> {
    const now = this.clock.now();
    const items = await Promise.all(this.listedTargets().map((t) => this.getUsage(t, now)));
    return { items };
  }

  /** 대상 하나의 오늘 현황 */
  async getUsage(
    target: CallLogTarget,
    now: Date = this.clock.now(),
  ): Promise<CallUsageByTargetDto> {
    const [count, cooldown, countsByFetchReason] = await Promise.all([
      this.countToday(target, now),
      this.activeCooldown(target, now),
      target === 'RAKUTEN_PAGE' ? this.countRakutenFetchReasons(now) : Promise.resolve(null),
    ]);
    const dailyLimit = this.dailyLimit(target);
    return {
      target,
      kstDate: toKstDate(now),
      count,
      dailyLimit,
      remaining: dailyLimit === null ? null : Math.max(0, dailyLimit - count),
      limitReached: dailyLimit !== null && count >= dailyLimit,
      blockedUntil: cooldown ? cooldown.blockedUntil.toISOString() : null,
      httpStatus: cooldown ? cooldown.httpStatus : null,
      countsByFetchReason,
      budgetBuckets: null,
    };
  }

  /** 오늘(KST) call_log 행 수. 실패·중단된 요청도 센다 */
  countToday(target: CallLogTarget, now: Date): Promise<number> {
    return this.prisma.callLog.count({ where: { target, kstDate: toKstDateValue(now) } });
  }

  /**
   * 24시간 쉼. 비공식 수집만 본다: 최근 24시간 안의 403·418·429 행이 있으면
   * 그중 가장 늦은 행의 called_at + 24시간까지 쉰다. 공식 API는 쉼이 없다(null).
   */
  async activeCooldown(target: CallLogTarget, now: Date): Promise<ActiveCooldown | null> {
    if (!EXTERNAL_TARGETS[target].unofficial) return null;
    const row = await this.prisma.callLog.findFirst({
      where: {
        target,
        httpStatus: { in: [...COOLDOWN_HTTP_STATUSES] },
        calledAt: { gt: new Date(now.getTime() - COOLDOWN_MS) },
      },
      orderBy: [{ calledAt: 'desc' }, { id: 'desc' }],
      select: { calledAt: true, httpStatus: true },
    });
    if (!row || row.httpStatus === null) return null;
    return {
      blockedUntil: new Date(row.calledAt.getTime() + COOLDOWN_MS),
      httpStatus: row.httpStatus as ActiveCooldown['httpStatus'],
    };
  }

  /**
   * RAKUTEN_PAGE 조회 이유별 수. call_log에 이유 열이 없어 오늘 만든 rakuten_item.fetch_reason으로 센다.
   * 파싱에 실패해 rakuten_item이 안 생긴 호출은 빠지므로 합이 count보다 작을 수 있다.
   */
  async countRakutenFetchReasons(now: Date): Promise<CountsByFetchReason> {
    const from = startOfKstDay(now);
    const to = nextKstMidnight(now);
    const groups = await this.prisma.rakutenItem.groupBy({
      by: ['fetchReason'],
      where: { collectedAt: { gte: from, lt: to } },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(
      RAKUTEN_FETCH_REASONS.map((r) => [r, 0]),
    ) as CountsByFetchReason;
    for (const g of groups) {
      if ((RAKUTEN_FETCH_REASONS as readonly string[]).includes(g.fetchReason)) {
        counts[g.fetchReason as keyof CountsByFetchReason] = g._count._all;
      }
    }
    return counts;
  }

  /** SSE call-usage.changed 발행(조회 수 증가·상한 도달·쉼 시작·KST 0시) */
  async publishChanged(target: CallLogTarget): Promise<CallUsageChangedEvent> {
    const usage = await this.getUsage(target);
    const data: CallUsageChangedEvent = {
      target: usage.target,
      kstDate: usage.kstDate,
      count: usage.count,
      dailyLimit: usage.dailyLimit,
      remaining: usage.remaining,
      limitReached: usage.limitReached,
      blockedUntil: usage.blockedUntil,
      httpStatus: usage.httpStatus,
    };
    this.events.publish('call-usage.changed', data);
    return data;
  }

  /** KST 0시: 목록 대상 모두 새로 센 값을 알린다 */
  async onKstMidnight(): Promise<void> {
    for (const target of this.listedTargets()) {
      await this.publishChanged(target);
    }
  }

  onApplicationBootstrap(): void {
    this.scheduleMidnight();
  }

  onModuleDestroy(): void {
    if (this.midnightTimer) clearTimeout(this.midnightTimer);
    this.midnightTimer = null;
  }

  private scheduleMidnight(): void {
    const now = this.clock.now();
    const delay = nextKstMidnight(now).getTime() - now.getTime() + MIDNIGHT_SLACK_MS;
    this.midnightTimer = setTimeout(() => {
      this.onKstMidnight()
        .catch((e: unknown) => this.logger.error({ err: e }, 'KST 0시 조회 수 알림에 실패했습니다'))
        .finally(() => this.scheduleMidnight());
    }, delay);
    // 이 타이머 때문에 프로세스가 끝나지 않는 일은 없게 한다
    this.midnightTimer.unref();
  }
}
