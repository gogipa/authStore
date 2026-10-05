import { rakutenSearchFixture } from '../../../test/support/rakuten-fixture.adapters.js';
import { ApiException } from '../../common/errors/api.exception.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type {
  RakutenApiCallContext,
  RakutenSearchItem,
  RakutenSearchPort,
  RakutenSearchQuery,
  RakutenSearchResult,
} from '../integrations/rakuten/rakuten-search.port.js';
import {
  parseSearchResponse,
  toSearchItem,
} from '../integrations/rakuten/rakuten-search.request.js';
import { DEFAULT_SETTINGS } from '../settings/defaults/default-settings.js';
import type { SettingsService } from '../settings/settings.service.js';
import { AnchorService, PAGE2_MATCH_THRESHOLD } from './anchor.service.js';
import type { ComparisonScope } from './comparison-scope.js';
import type {
  HeadWithRun,
  SourcingComparisonRepository,
} from './sourcing-comparison.repository.js';

/**
 * 같은 상품 검색(D-47, 지금까지의 'page 2' 대체) 단위 시험. 기준 상품에 모델 번호가 있을 때만 그 모델 번호로 가격순 검색을
 * 하고, 일치 < 20이고 1페이지가 가득이면 2페이지까지. 모델 번호가 없으면 새 검색을 하지 않는다. 실패는 넘어간다.
 */
const HITS = DEFAULT_SETTINGS.sourcing.rakutenApi.hits;
const FETCHED_AT = new Date('2026-10-05T01:00:00Z');

function fixtureItems(name: string): RakutenSearchItem[] {
  const parsed = parseSearchResponse(rakutenSearchFixture(name))!;
  return parsed.items.map(toSearchItem).filter((i): i is RakutenSearchItem => i !== null);
}

const PAGE_FULL = fixtureItems('anchor-match12-p1.json');

type Answer = RakutenSearchItem[] | Error;

function setup(options: {
  anchorModelCode?: string | null;
  matchCount?: number;
  pages?: Answer[];
}) {
  const queries: { query: RakutenSearchQuery; ctx: RakutenApiCallContext | undefined }[] = [];
  const answers = [...(options.pages ?? [])];
  const search: RakutenSearchPort = {
    search: (query, ctx) => {
      queries.push({ query, ctx });
      const answer = answers.shift() ?? [];
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({
        items: answer,
        page: query.page ?? 1,
        totalCount: null,
        fetchedAt: FETCHED_AT,
        fromCache: false,
        queryHash: 'q'.repeat(64),
      } satisfies RakutenSearchResult);
    },
  };
  const created: { data: Record<string, unknown>[]; skipDuplicates: boolean | undefined }[] = [];
  const head = {
    id: 5,
    stepRunId: 50,
    stepRun: { candidateId: 7 },
    anchorModelCode: options.anchorModelCode === undefined ? '1201A019' : options.anchorModelCode,
    detectedGender: 'MALE',
  } as unknown as HeadWithRun;
  const tx = {
    sourcingComparisonRow: {
      createMany: (args: { data: Record<string, unknown>[]; skipDuplicates?: boolean }) => {
        created.push({ data: args.data, skipDuplicates: args.skipDuplicates });
        return Promise.resolve({ count: args.data.length });
      },
    },
    sourcingComparison: { findUniqueOrThrow: () => Promise.resolve(head) },
  };
  const scope = {
    forJob: (_candidateId: number, _stepRunId: number, fn: (s: unknown, c: unknown) => unknown) =>
      Promise.resolve(fn({ tx }, { candidate: { sourceKeywordId: null } })),
  } as unknown as ComparisonScope;
  const classified = { count: 0 };
  const repo = {
    classifyRows: () => {
      classified.count += 1;
      return Promise.resolve(0);
    },
    detectGender: () => Promise.resolve(null),
  } as unknown as SourcingComparisonRepository;
  const prisma = {
    sourcingComparisonRow: { count: () => Promise.resolve(options.matchCount ?? 12) },
  } as unknown as PrismaService;
  const settings = { current: () => DEFAULT_SETTINGS } as unknown as SettingsService;
  const service = new AnchorService(
    prisma,
    scope,
    undefined as never,
    settings,
    undefined as never,
    search,
    undefined as never,
    repo,
    undefined as never,
  );
  const run = () =>
    (
      service as unknown as {
        searchSameProduct(h: HeadWithRun, s: typeof DEFAULT_SETTINGS): Promise<void>;
      }
    ).searchSameProduct(head, DEFAULT_SETTINGS);
  return { run, queries, created, classified };
}

describe('같은 상품 검색(D-47) — AnchorService.searchSameProduct', () => {
  it('설정 hits와 시험용 fixture가 맞는다(1페이지가 가득)', () => {
    expect(PAGE_FULL).toHaveLength(HITS);
    expect(PAGE2_MATCH_THRESHOLD).toBe(20);
  });

  it('모델 번호가 없으면 새 검색을 하지 않는다(같은 키워드 page 2도 없다)', async () => {
    for (const anchorModelCode of [null, '', '   ']) {
      const t = setup({ anchorModelCode, pages: [PAGE_FULL] });
      await t.run();
      expect(t.queries).toHaveLength(0);
      expect(t.created).toHaveLength(0);
    }
  });

  it('모델 번호가 있으면 그 모델 번호로 가격순(+itemPrice) page 1을 검색하고, 행을 skipDuplicates로 더한 뒤 분류한다', async () => {
    const t = setup({ matchCount: 25, pages: [PAGE_FULL] });
    await t.run();
    expect(t.queries).toHaveLength(1);
    expect(t.queries[0]!.query).toEqual({ keyword: '1201A019', page: 1, sort: '+itemPrice' });
    expect(t.queries[0]!.ctx).toEqual({ candidateId: 7, stepRunId: 50 });
    expect(t.created).toHaveLength(1);
    expect(t.created[0]!.skipDuplicates).toBe(true);
    // 아동 단어 행(1건)은 뺀다 — fixture 30건 중 29행
    expect(t.created[0]!.data).toHaveLength(29);
    // 같은 상품 검색 행은 검색 순위가 없다(null)
    expect(t.created[0]!.data.every((row) => row.searchRank === null)).toBe(true);
    expect(t.created[0]!.data.every((row) => row.rowSource === 'API')).toBe(true);
    expect(t.classified.count).toBe(1);
  });

  it('일치가 20개 미만이고 page 1이 가득이면 page 2까지(같은 모델 번호·가격순)', async () => {
    const t = setup({
      matchCount: PAGE2_MATCH_THRESHOLD - 1,
      pages: [PAGE_FULL, PAGE_FULL.slice(0, 3)],
    });
    await t.run();
    expect(t.queries.map((q) => q.query)).toEqual([
      { keyword: '1201A019', page: 1, sort: '+itemPrice' },
      { keyword: '1201A019', page: 2, sort: '+itemPrice' },
    ]);
    expect(t.created).toHaveLength(2);
    expect(t.created[1]!.data.every((row) => row.searchRank === null)).toBe(true);
  });

  it('일치가 20개 이상이면 page 2를 부르지 않는다', async () => {
    const t = setup({ matchCount: PAGE2_MATCH_THRESHOLD, pages: [PAGE_FULL, PAGE_FULL] });
    await t.run();
    expect(t.queries).toHaveLength(1);
  });

  it('page 1이 hits건보다 적게 왔으면 page 2를 부르지 않는다', async () => {
    const t = setup({ matchCount: 3, pages: [PAGE_FULL.slice(0, HITS - 1), PAGE_FULL] });
    await t.run();
    expect(t.queries).toHaveLength(1);
    expect(t.created).toHaveLength(1);
  });

  it('page 1 검색이 실패하면 로그만 남기고 넘어간다(오류를 던지지 않고 행·page 2도 없다)', async () => {
    const t = setup({ pages: [new ApiException('EXTERNAL_API_ERROR'), PAGE_FULL] });
    await expect(t.run()).resolves.toBeUndefined();
    expect(t.queries).toHaveLength(1);
    expect(t.created).toHaveLength(0);
    expect(t.classified.count).toBe(0);
  });

  it('page 2 검색이 실패해도 page 1 행은 남고 오류를 던지지 않는다', async () => {
    const t = setup({ matchCount: 5, pages: [PAGE_FULL, new Error('boom')] });
    await expect(t.run()).resolves.toBeUndefined();
    expect(t.queries).toHaveLength(2);
    expect(t.created).toHaveLength(1);
  });

  it('결과가 전부 아동 단어로 걸러지면 행을 더하지 않지만 받은 원본 수는 page 2 판단에 쓴다', async () => {
    const kids = PAGE_FULL.map((item) => ({ ...item, itemName: `${item.itemName} キッズ` }));
    const t = setup({ matchCount: 3, pages: [kids, []] });
    await t.run();
    expect(t.created).toHaveLength(0);
    expect(t.queries).toHaveLength(2);
  });
});
