import {
  DatalabFixtureServer,
  datalabRankFixture,
} from '../../../test/support/datalab-fixture.adapter.js';
import { ApiException } from '../../common/errors/api.exception.js';
import type { ProgressEventsService } from '../../common/events/progress-events.service.js';
import type { KeywordSnapshot } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CallUsageService } from '../integrations/call-usage/call-usage.service.js';
import type { Clock } from '../integrations/http/clock.token.js';
import { DEFAULT_SETTINGS } from '../settings/defaults/default-settings.js';
import type { AppSettings } from '../settings/schema/settings.types.js';
import type { SettingsService } from '../settings/settings.service.js';
import { KeywordCollectionService, pagesPerCidOf } from './keyword-collection.service.js';
import type { KeywordRepository, KeywordRowInput, SnapshotCounts } from './keyword.repository.js';

/** 가짜 시계: sleep은 기다리지 않고 시간만 옮기고 기록한다 */
class RecordingClock implements Clock {
  sleeps: number[] = [];
  constructor(public ms: number) {}
  now(): Date {
    return new Date(this.ms);
  }
  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.ms += ms;
    return Promise.resolve();
  }
}

/** keyword_snapshot·keyword를 메모리에 두는 가짜 저장소 */
class MemoryKeywordRepo {
  snapshots = new Map<number, KeywordSnapshot>();
  keywords: (KeywordRowInput & { snapshotId: number })[] = [];
  seq = 0;

  create(data: Partial<KeywordSnapshot>): KeywordSnapshot {
    this.seq += 1;
    const defaults: KeywordSnapshot = {
      id: this.seq,
      method: 'BUTTON',
      collectedAt: new Date(0),
      requestedCids: [],
      periodStart: null,
      periodEnd: null,
      rankLimit: null,
      responseRange: null,
      rangeMatched: null,
      status: 'RUNNING',
      abortReason: null,
      httpStatus: null,
    };
    const row: KeywordSnapshot = { ...defaults, ...data };
    this.snapshots.set(row.id, row);
    return row;
  }

  findRunning(): Promise<KeywordSnapshot | null> {
    return Promise.resolve(
      [...this.snapshots.values()].find((s) => s.status === 'RUNNING') ?? null,
    );
  }

  insertKeywords(snapshotId: number, rows: readonly KeywordRowInput[]): Promise<void> {
    for (const r of rows) this.keywords.push({ ...r, snapshotId });
    return Promise.resolve();
  }

  complete(id: number, data: { responseRange: string | null; rangeMatched: boolean | null }) {
    const row = this.snapshots.get(id)!;
    if (row.status !== 'RUNNING') return Promise.resolve(false);
    Object.assign(row, { status: 'COMPLETED', ...data });
    return Promise.resolve(true);
  }

  abort(
    id: number,
    data: {
      reason: string;
      httpStatus: number | null;
      responseRange: string | null;
      rangeMatched: boolean | null;
    },
  ) {
    const row = this.snapshots.get(id)!;
    if (row.status !== 'RUNNING') return Promise.resolve(false);
    Object.assign(row, {
      status: 'ABORTED',
      abortReason: data.reason,
      httpStatus: data.httpStatus,
      responseRange: data.responseRange,
      rangeMatched: data.rangeMatched,
    });
    return Promise.resolve(true);
  }

  countsOf(ids: readonly number[]): Promise<Map<number, SnapshotCounts>> {
    const out = new Map<number, SnapshotCounts>();
    for (const id of ids) {
      const rows = this.keywords.filter((k) => k.snapshotId === id);
      out.set(id, {
        keywordCount: rows.length,
        excludedCount: rows.filter((k) => k.excluded).length,
      });
    }
    return Promise.resolve(out);
  }
}

interface Kit {
  service: KeywordCollectionService;
  repo: MemoryKeywordRepo;
  server: DatalabFixtureServer;
  clock: RecordingClock;
  events: { name: string; data: Record<string, unknown> }[];
  cooldown: { value: { blockedUntil: Date; httpStatus: 403 | 418 | 429 } | null };
  usedToday: { value: number };
}

const NOW = Date.parse('2026-09-24T00:30:00+09:00');

function kit(settings: AppSettings = DEFAULT_SETTINGS): Kit {
  const repo = new MemoryKeywordRepo();
  const server = new DatalabFixtureServer();
  const clock = new RecordingClock(NOW);
  const events: Kit['events'] = [];
  const cooldown: Kit['cooldown'] = { value: null };
  const usedToday = { value: 0 };
  const prisma = {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) =>
      fn({
        $executeRawUnsafe: () => Promise.resolve(1),
        keywordSnapshot: {
          create: ({ data }: { data: Partial<KeywordSnapshot> }) =>
            Promise.resolve(repo.create(data)),
          findFirst: () => repo.findRunning(),
        },
      }),
  } as unknown as PrismaService;
  const service = new KeywordCollectionService(
    prisma,
    repo as unknown as KeywordRepository,
    { current: () => settings } as unknown as SettingsService,
    {
      activeCooldown: () => Promise.resolve(cooldown.value),
      countToday: () => Promise.resolve(usedToday.value),
    } as unknown as CallUsageService,
    {
      publish: (name: string, data: Record<string, unknown>) => {
        events.push({ name, data });
      },
    } as unknown as ProgressEventsService,
    clock,
    server.port,
    () => 100,
  );
  return { service, repo, server, clock, events, cooldown, usedToday };
}

async function collect(k: Kit, rankLimit: 100 | 500 = 100) {
  const accepted = await k.service.start({ rankLimit });
  await k.service.whenIdle();
  return { accepted, snapshot: k.repo.snapshots.get(accepted.keywordSnapshotId)! };
}

describe('데이터랩 버튼 수집 작업(가짜 포트·가짜 대기, P2-01 규칙 1·2·4·6~8)', () => {
  it('100위 → 호출 10회, 순서 (173, p1~p5) → (174, p1~p5), 호출 사이 대기 ≥ 2000ms, COMPLETED', async () => {
    const k = kit();
    const { accepted, snapshot } = await collect(k);
    expect(accepted).toEqual({
      keywordSnapshotId: 1,
      status: 'RUNNING',
      rankLimit: 100,
      requestedCids: ['50000173', '50000174'],
    });
    expect(k.server.callKeys).toEqual([
      '50000173:p1',
      '50000173:p2',
      '50000173:p3',
      '50000173:p4',
      '50000173:p5',
      '50000174:p1',
      '50000174:p2',
      '50000174:p3',
      '50000174:p4',
      '50000174:p5',
    ]);
    expect(k.server.calls.every((c) => !c.cid.includes(','))).toBe(true);
    expect(k.server.calls[0]).toMatchObject({ startDate: '2026-08-23', endDate: '2026-09-23' });
    expect(k.clock.sleeps).toHaveLength(9);
    expect(k.clock.sleeps.every((ms) => ms >= 2000)).toBe(true);
    expect(snapshot).toMatchObject({
      status: 'COMPLETED',
      responseRange: '2026.08.23. ~ 2026.09.23.',
      rangeMatched: true,
      abortReason: null,
    });
    // 200줄 저장, 아동 단어 3줄은 제외 표시(지우지 않음)
    expect(k.repo.keywords).toHaveLength(200);
    expect(k.repo.keywords.filter((r) => r.excluded).map((r) => r.keyword)).toEqual([
      '키즈 운동화',
      'キッズ スニーカー',
      '주니어 축구화',
    ]);
    // 진행 알림 10개(페이지마다) + 완료 1개
    const progress = k.events.filter((e) => e.name === 'keyword-collection.progress');
    expect(progress).toHaveLength(10);
    expect(progress[2]!.data).toEqual({
      keywordSnapshotId: 1,
      cid: '50000173',
      page: 3,
      pagesPerCid: 5,
      requestsDone: 3,
      requestsTotal: 10,
    });
    expect(k.events.at(-1)).toEqual({
      name: 'keyword-collection.completed',
      data: { keywordSnapshotId: 1, keywordCount: 200, excludedCount: 3, rangeMatched: true },
    });
    // call_log 요약: 페이지마다 item_count 20
    expect(k.server.described.map((d) => d.itemCount)).toEqual(Array(10).fill(20));
  });

  it('500위 → 호출 50회(cid당 25페이지) — fixture 없는 페이지는 빈 ranks라 그 cid를 끝낸다', async () => {
    expect(pagesPerCidOf(500, 20, 25)).toBe(25);
    expect(pagesPerCidOf(100, 20, 25)).toBe(5);
    const k = kit();
    for (const cid of ['50000173', '50000174']) {
      for (let page = 6; page <= 25; page += 1) {
        const file = `${cid}-p${((page - 1) % 5) + 1}.json`;
        const body = JSON.parse(datalabRankFixture(file)) as { ranks: { rank: number }[] };
        for (const r of body.ranks) r.rank += (page - 1 - ((page - 1) % 5)) * 20;
        k.server.answer(cid, page, {
          response: { httpStatus: 200, contentType: 'text/html', bodyText: JSON.stringify(body) },
        });
      }
    }
    const { accepted, snapshot } = await collect(k, 500);
    expect(accepted.rankLimit).toBe(500);
    expect(k.server.calls).toHaveLength(50);
    expect(snapshot.status).toBe('COMPLETED');
    expect(k.repo.keywords).toHaveLength(1000);
  });

  it('빈 ranks·짧은 페이지는 그 cid의 끝(다음 cid로), 정상 종료', async () => {
    const k = kit();
    k.server.answer('50000173', 3, { file: 'empty-ranks.json' });
    k.server.answer('50000174', 1, {
      response: {
        httpStatus: 200,
        contentType: 'text/html',
        bodyText: JSON.stringify({ returnCode: 0, ranks: [{ rank: 1, keyword: '로퍼' }] }),
      },
    });
    const { snapshot } = await collect(k);
    expect(k.server.callKeys).toEqual(['50000173:p1', '50000173:p2', '50000173:p3', '50000174:p1']);
    expect(snapshot.status).toBe('COMPLETED');
    expect(k.repo.keywords).toHaveLength(41);
  });

  it('3번째 호출 429 → 호출 3회로 끝, 재시도 0, 묶음 ABORTED·HTTP_429·429', async () => {
    const k = kit();
    k.server.answer('50000173', 3, { statusCase: 429 });
    const { snapshot } = await collect(k);
    expect(k.server.calls).toHaveLength(3);
    expect(snapshot).toMatchObject({ status: 'ABORTED', abortReason: 'HTTP_429', httpStatus: 429 });
    // 받은 두 페이지는 남는다(Proposed)
    expect(k.repo.keywords).toHaveLength(40);
    const aborted = k.events.filter((e) => e.name === 'keyword-collection.aborted');
    expect(aborted).toHaveLength(1);
    expect(aborted[0]!.data).toMatchObject({
      abortReason: 'HTTP_429',
      httpStatus: 429,
      structureChangeSuspected: false,
    });
    expect(k.events.some((e) => e.name === 'keyword-collection.completed')).toBe(false);
  });

  it.each([
    ['no-ranks-key.json', 'NO_RANKS_KEY'],
    ['not-json.html', 'NOT_JSON'],
    ['return-code-1.json', 'RETURN_CODE'],
    ['count-mismatch.json', 'COUNT_MISMATCH'],
  ])('%s → 곧바로 %s(구조 변경 의심, 자동 재시도 없음)', async (file, reason) => {
    const k = kit();
    k.server.answer('50000173', 1, { file });
    const { snapshot } = await collect(k);
    expect(k.server.calls).toHaveLength(1);
    expect(snapshot).toMatchObject({ status: 'ABORTED', abortReason: reason, httpStatus: null });
    expect(k.events.find((e) => e.name === 'keyword-collection.aborted')!.data).toMatchObject({
      structureChangeSuspected: true,
      blockedUntil: null,
    });
  });

  it('404 → HTTP_404(구조 변경 의심), 403·418 → 막힘', async () => {
    for (const status of [404, 403, 418] as const) {
      const k = kit();
      k.server.answer('50000174', 2, { statusCase: status });
      const { snapshot } = await collect(k);
      expect(k.server.calls).toHaveLength(7);
      expect(snapshot).toMatchObject({ abortReason: `HTTP_${status}`, httpStatus: status });
      expect(k.events.find((e) => e.name === 'keyword-collection.aborted')!.data).toMatchObject({
        structureChangeSuspected: status === 404,
      });
    }
  });

  it('응답을 받지 못함(502 EXTERNAL_API_ERROR) → NETWORK_ERROR, 그 밖 예외 → INTERRUPTED(RUNNING을 남기지 않는다)', async () => {
    const k1 = kit();
    k1.server.answer('50000173', 2, {
      error: new ApiException('EXTERNAL_API_ERROR', { details: { reason: 'TIMEOUT' } }),
    });
    expect((await collect(k1)).snapshot).toMatchObject({
      status: 'ABORTED',
      abortReason: 'NETWORK_ERROR',
    });
    const k2 = kit();
    k2.server.answer('50000173', 2, {
      error: new ApiException('DAILY_LIMIT_REACHED', { details: { target: 'DATALAB' } }),
    });
    expect((await collect(k2)).snapshot).toMatchObject({ abortReason: 'INTERRUPTED' });
    expect(k2.server.calls).toHaveLength(2);
  });

  it('range가 요청 기간과 다르면 멈추지 않고 rangeMatched=false로만 표시(Proposed)', async () => {
    const k = kit();
    k.clock.ms = Date.parse('2026-09-25T12:00:00+09:00');
    const { snapshot } = await collect(k);
    expect(snapshot).toMatchObject({ status: 'COMPLETED', rangeMatched: false });
    expect(k.server.calls).toHaveLength(10);
  });

  it('수집 중 두 번째 시작 → 409 ALREADY_IN_PROGRESS(details.job=KEYWORD_COLLECTION)', async () => {
    const k = kit();
    k.server.hold();
    await k.service.start({ rankLimit: 100 });
    await expect(k.service.start({ rankLimit: 100 })).rejects.toMatchObject({
      code: 'ALREADY_IN_PROGRESS',
      details: { job: 'KEYWORD_COLLECTION', keywordSnapshotId: 1 },
    });
    k.server.release();
    await k.service.whenIdle();
  });

  it('24시간 쉼 중이면 409 EXTERNAL_CALL_COOLDOWN(Retry-After), 오늘 남은 요청이 모자라면 409 DAILY_LIMIT_REACHED', async () => {
    const k = kit();
    k.cooldown.value = { blockedUntil: new Date(NOW + 3600_000), httpStatus: 429 };
    const cooldown = await k.service.start({ rankLimit: 100 }).catch((e: unknown) => e);
    expect(cooldown).toBeInstanceOf(ApiException);
    expect(cooldown).toMatchObject({
      code: 'EXTERNAL_CALL_COOLDOWN',
      details: { target: 'DATALAB', httpStatus: 429 },
      headers: { 'Retry-After': '3600' },
    });
    k.cooldown.value = null;
    k.usedToday.value = 60;
    await expect(k.service.start({ rankLimit: 500 })).rejects.toMatchObject({
      code: 'DAILY_LIMIT_REACHED',
      details: { required: 50, remaining: 40 },
    });
    expect(k.server.calls).toHaveLength(0);
    // 100위(10요청)는 된다
    await k.service.start({ rankLimit: 100 });
    await k.service.whenIdle();
    expect(k.server.calls).toHaveLength(10);
  });

  it('요청 간격은 설정값(3초면 3000ms)', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS) as AppSettings;
    settings.keywords.datalab.requestIntervalSeconds = 3;
    const k = kit(settings);
    await collect(k);
    expect(new Set(k.clock.sleeps)).toEqual(new Set([3000]));
  });
});
