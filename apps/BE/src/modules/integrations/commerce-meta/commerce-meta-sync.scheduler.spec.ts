import {
  createMetaKit,
  type MetaKit,
  muteNestLogger,
} from '../../../../test/support/commerce-meta-kit.js';
import {
  CommerceMetaSyncScheduler,
  defaultCommerceMetaSchedule,
  planAutoSync,
} from './commerce-meta-sync.scheduler.js';
import { META_SYNC_TARGETS, type MetaSyncTarget } from './commerce-meta.constants.js';
import type { CommerceMetaSyncRunDto } from './dto/commerce-meta-sync.dto.js';

/** 2026-09-28 15:00 KST */
const NOW = new Date('2026-09-28T06:00:00Z');
const HOUR = 3_600_000;

function run(
  target: MetaSyncTarget,
  status: CommerceMetaSyncRunDto['status'],
  startedAt: Date,
): CommerceMetaSyncRunDto {
  return {
    id: 1,
    target,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: status === 'RUNNING' ? null : startedAt.toISOString(),
    itemCount: null,
    errorMessage: status === 'FAILED' ? 'x' : null,
  };
}

describe('자동 실행 판단 planAutoSync(가짜 시계, 하루 = 한국 날짜)', () => {
  it('한 번도 안 돈 대상은 모두 실행', () => {
    const statuses = META_SYNC_TARGETS.map((target) => ({
      target,
      latestRun: null,
      lastSucceededAt: null,
    }));
    expect(planAutoSync(statuses, NOW)).toEqual([...META_SYNC_TARGETS]);
  });

  it('마지막 성공이 오늘(KST)이면 건너뛰고, 어제면 실행', () => {
    const todayMorning = new Date('2026-09-28T00:10:00Z'); // 09:10 KST
    const yesterdayNight = new Date('2026-09-27T14:59:00Z'); // 09-27 23:59 KST
    expect(
      planAutoSync(
        [
          {
            target: 'CATEGORY',
            latestRun: run('CATEGORY', 'SUCCEEDED', todayMorning),
            lastSucceededAt: todayMorning.toISOString(),
          },
          {
            target: 'ADDRESSBOOK',
            latestRun: run('ADDRESSBOOK', 'SUCCEEDED', yesterdayNight),
            lastSucceededAt: yesterdayNight.toISOString(),
          },
        ],
        NOW,
      ),
    ).toEqual(['ADDRESSBOOK']);
  });

  it('RUNNING은 건너뛰고, FAILED는 시작 뒤 6시간이 지나야 다시(성공은 어제)', () => {
    const yesterday = new Date(NOW.getTime() - 26 * HOUR).toISOString();
    const statuses = [
      {
        target: 'CATEGORY' as const,
        latestRun: run('CATEGORY', 'RUNNING', NOW),
        lastSucceededAt: yesterday,
      },
      {
        target: 'ORIGIN_AREA' as const,
        latestRun: run('ORIGIN_AREA', 'FAILED', new Date(NOW.getTime() - 2 * HOUR)),
        lastSucceededAt: yesterday,
      },
      {
        target: 'ADDRESSBOOK' as const,
        latestRun: run('ADDRESSBOOK', 'FAILED', new Date(NOW.getTime() - 7 * HOUR)),
        lastSucceededAt: yesterday,
      },
    ];
    expect(planAutoSync(statuses, NOW)).toEqual(['ADDRESSBOOK']);
    expect(planAutoSync(statuses, NOW, HOUR)).toEqual(['ORIGIN_AREA', 'ADDRESSBOOK']);
  });
});

describe('CommerceMetaSyncScheduler.runOnce(같은 서비스로 자동 실행)', () => {
  muteNestLogger();
  let k: MetaKit;
  const scheduler = (kit: MetaKit) =>
    new CommerceMetaSyncScheduler(
      kit.sync,
      kit.recovery,
      defaultCommerceMetaSchedule(true),
      kit.clock,
    );

  beforeEach(async () => {
    k = createMetaKit();
    await k.recovery.onApplicationBootstrap();
  });

  it('처음이면 8개를 돌리고, 같은 날 다시 보면 건너뛴다. 다음 날(KST)이면 다시 돈다', async () => {
    const s = scheduler(k);
    expect(await s.runOnce()).toEqual([...META_SYNC_TARGETS]);
    await k.sync.whenIdle();
    expect(k.prisma.commerceMetaSyncRun.rows.every((r) => r.status === 'SUCCEEDED')).toBe(true);

    k.clock.advance(HOUR);
    expect(await s.runOnce()).toEqual([]);

    k.clock.advance(24 * HOUR);
    expect(await s.runOnce()).toEqual([...META_SYNC_TARGETS]);
    await k.sync.whenIdle();
    expect(k.prisma.commerceMetaSyncRun.rows).toHaveLength(16);
  });

  it('커머스 키가 없으면 조용히 건너뛴다(행·호출·SSE 없음)', async () => {
    const noKeys = createMetaKit({ secrets: {} });
    await noKeys.recovery.onApplicationBootstrap();
    expect(await scheduler(noKeys).runOnce()).toEqual([]);
    expect(noKeys.prisma.commerceMetaSyncRun.rows).toHaveLength(0);
    expect(noKeys.transport.requests).toHaveLength(0);
    expect(noKeys.events.published).toHaveLength(0);
  });

  it('키체인을 열 수 없어도 던지지 않고 건너뛴다', async () => {
    k.store.unavailable = true;
    await expect(scheduler(k).runOnce()).resolves.toEqual([]);
    expect(k.prisma.commerceMetaSyncRun.rows).toHaveLength(0);
  });

  it('꺼져 있으면(enabled=false) 타이머를 걸지 않는다', () => {
    const off = new CommerceMetaSyncScheduler(
      k.sync,
      k.recovery,
      defaultCommerceMetaSchedule(false),
      k.clock,
    );
    const originalSetTimeout = globalThis.setTimeout;
    const originalSetInterval = globalThis.setInterval;
    let scheduled = 0;
    globalThis.setTimeout = (() => {
      scheduled += 1;
    }) as unknown as typeof setTimeout;
    globalThis.setInterval = (() => {
      scheduled += 1;
    }) as unknown as typeof setInterval;
    try {
      off.onApplicationBootstrap();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.setInterval = originalSetInterval;
    }
    expect(scheduled).toBe(0);
    off.onModuleDestroy();
  });
});
