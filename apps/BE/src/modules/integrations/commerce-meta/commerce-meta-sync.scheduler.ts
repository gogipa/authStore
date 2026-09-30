import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { toKstDate } from '../../../common/time/kst.js';
import { CLOCK, type Clock } from '../http/clock.token.js';
import { CommerceMetaRecovery } from './commerce-meta-recovery.js';
import { CommerceMetaSyncService } from './commerce-meta-sync.service.js';
import { META_AUTO_SYNC_DEFAULTS, type MetaSyncTarget } from './commerce-meta.constants.js';
import type { CommerceMetaSyncTargetStatusDto } from './dto/commerce-meta-sync.dto.js';

/** 자동 실행 설정(주입 토큰). 테스트는 `{ enabled: false }`로 끈다(createTestApp) */
export interface CommerceMetaSchedule {
  enabled: boolean;
  /** 앱을 켜고 첫 확인까지(ms) */
  initialDelayMs: number;
  /** 확인 간격(ms) */
  intervalMs: number;
  /** 실패한 대상을 자동으로 다시 해 보기까지(ms) */
  failedRetryAfterMs: number;
}

export const COMMERCE_META_SCHEDULE = Symbol('COMMERCE_META_SCHEDULE');

export function defaultCommerceMetaSchedule(enabled: boolean): CommerceMetaSchedule {
  return { enabled, ...META_AUTO_SYNC_DEFAULTS };
}

/**
 * 자동으로 돌릴 대상(순수 함수, 규칙 9 — '하루' 기준은 Proposed: 한국 날짜).
 * - 오늘(KST) 끝난 SUCCEEDED가 있으면 건너뛴다(마지막 성공 시각으로 판단).
 * - 지금 RUNNING이면 건너뛴다.
 * - 마지막 실행이 FAILED이고 시작한 지 `failedRetryAfterMs`가 안 지났으면 건너뛴다(계속 실패하는 대상을 매시간 부르지 않게).
 */
export function planAutoSync(
  statuses: readonly Pick<
    CommerceMetaSyncTargetStatusDto,
    'target' | 'latestRun' | 'lastSucceededAt'
  >[],
  now: Date,
  failedRetryAfterMs: number = META_AUTO_SYNC_DEFAULTS.failedRetryAfterMs,
): MetaSyncTarget[] {
  const today = toKstDate(now);
  return statuses
    .filter((s) => {
      if (s.lastSucceededAt && toKstDate(new Date(s.lastSucceededAt)) === today) return false;
      const run = s.latestRun;
      if (run?.status === 'RUNNING') return false;
      if (
        run?.status === 'FAILED' &&
        now.getTime() - new Date(run.startedAt).getTime() < failedRetryAfterMs
      ) {
        return false;
      }
      return true;
    })
    .map((s) => s.target);
}

/**
 * 하루 1회 자동 동기화(F-BS-48, 규칙 9). 수동과 같은 서비스(`startAuto`)를 쓴다.
 * 방식은 Proposed: 라이브러리 없이 `setTimeout`(앱 시작 뒤 한 번) + `setInterval`(매시간) — 둘 다 unref.
 * 끄기: 환경변수 `COMMERCE_META_AUTO_SYNC=off`(06-4), 테스트는 `COMMERCE_META_SCHEDULE` 토큰을 `{ enabled: false }`로.
 */
@Injectable()
export class CommerceMetaSyncScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CommerceMetaSyncScheduler.name);
  private startTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private checking: Promise<MetaSyncTarget[]> | null = null;

  constructor(
    private readonly sync: CommerceMetaSyncService,
    private readonly recovery: CommerceMetaRecovery,
    @Inject(COMMERCE_META_SCHEDULE) private readonly schedule: CommerceMetaSchedule,
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

  /**
   * 한 번 확인하고 필요한 대상을 돌린다(시작한 대상을 돌려준다). 이미 확인 중이면 그 결과를 같이 쓴다.
   * 커머스 키가 없으면 조용히 건너뛴다(Proposed).
   */
  runOnce(): Promise<MetaSyncTarget[]> {
    if (!this.checking) {
      this.checking = this.check().finally(() => {
        this.checking = null;
      });
    }
    return this.checking;
  }

  private async tick(): Promise<void> {
    try {
      await this.runOnce();
    } catch (e) {
      this.logger.error({ err: e }, '메타데이터 자동 동기화 확인에 실패했습니다');
    }
  }

  private async check(): Promise<MetaSyncTarget[]> {
    await this.recovery.ready;
    const { items } = await this.sync.latest();
    const targets = planAutoSync(items, this.clock.now(), this.schedule.failedRetryAfterMs);
    if (targets.length === 0) return [];
    const runs = await this.sync.startAuto(targets);
    return runs ? runs.map((r) => r.target) : [];
  }
}
