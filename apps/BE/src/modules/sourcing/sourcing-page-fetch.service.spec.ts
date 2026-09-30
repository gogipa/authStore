import { ApiException } from '../../common/errors/api.exception.js';
import type { ProgressEventsService } from '../../common/events/progress-events.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { FetchedSnapshot, RakutenItemFetcher } from './rakuten-item-fetcher.js';
import {
  type PageFetchTargetRow,
  SourcingPageFetchService,
} from './sourcing-page-fetch.service.js';

function row(rowId: number, price: number): PageFetchTargetRow {
  return {
    rowId,
    anchorMatch: 'MATCH',
    apiItemPriceMin3Yen: price,
    apiItemPriceYen: price,
    apiPostageFlag: 0,
    searchRank: rowId,
    itemUrl: `https://item.rakuten.co.jp/shop-${rowId}/item-${rowId}/`,
    itemCode: `shop-${rowId}:${rowId}`,
    shopCode: `shop-${rowId}`,
  };
}

function setup(fail: (rowId: number) => ApiException | null = () => null) {
  const fetched: { url: string; itemCode?: string; fetchReason: string }[] = [];
  const fetcher = {
    fetchSnapshot: (url: { url: string; shopCode: string }, options: Record<string, unknown>) => {
      const rowId = Number(url.shopCode.replace('shop-', ''));
      const error = fail(rowId);
      if (error) return Promise.reject(error);
      fetched.push({
        url: url.url,
        itemCode: (options.knownItemCode as { itemCode: string } | undefined)?.itemCode,
        fetchReason: options.fetchReason as string,
      });
      return Promise.resolve({ item: { id: rowId } } as unknown as FetchedSnapshot);
    },
  } as unknown as RakutenItemFetcher;
  const published: { name: string; data: unknown; options: unknown }[] = [];
  const events = {
    publish: (name: string, data: unknown, options: unknown) =>
      published.push({ name, data, options }),
  } as unknown as ProgressEventsService;
  const settings = {
    current: () => ({
      sourcing: { pageFetchTargetCandidates: 3, pageFetchMaxPages: 10, defaultShippingYen: 800 },
    }),
  } as unknown as SettingsService;
  return { service: new SourcingPageFetchService(fetcher, events, settings), fetched, published };
}

const ROWS = [row(1, 12_000), row(2, 11_000), row(3, 13_000), row(4, 11_500), row(5, 14_000)];

describe('앵커 뒤 페이지 조회 반복(F-SO-12, P2-02 규칙 7)', () => {
  it('가격 순으로 읽고(API 행 itemCode·fetch_reason=SOURCING), 끝나면 SSE sourcing.page-fetch-finished를 그 후보로', async () => {
    const { service, fetched, published } = setup();
    const result = await service.run({
      candidateId: 7,
      stepRunId: 70,
      sourcingComparisonId: 31,
      rows: ROWS,
      judgeStock: (r) => r.rowId !== 4,
    });
    expect(fetched.map((f) => f.itemCode)).toEqual([
      'shop-2:2',
      'shop-4:4',
      'shop-1:1',
      'shop-3:3',
    ]);
    expect(fetched.every((f) => f.fetchReason === 'SOURCING')).toBe(true);
    expect(result).toMatchObject({
      fetchedCount: 4,
      passedCount: 3,
      stopReason: 'ENOUGH_CANDIDATES',
    });
    expect(published).toEqual([
      {
        name: 'sourcing.page-fetch-finished',
        data: {
          sourcingComparisonId: 31,
          fetchedCount: 4,
          passedCount: 3,
          stopReason: 'ENOUGH_CANDIDATES',
        },
        options: { candidateId: 7 },
      },
    ]);
  });

  it('점검 페이지(502)는 그 행만 수동 확인으로 넘기고 계속, 하루 상한(409)은 DAILY_LIMIT로 멈춘다', async () => {
    const { service, published } = setup((rowId) =>
      rowId === 2
        ? new ApiException('EXTERNAL_API_ERROR', {
            details: { target: 'RAKUTEN_PAGE', reason: 'MAINTENANCE_PAGE' },
          })
        : rowId === 1
          ? new ApiException('DAILY_LIMIT_REACHED')
          : null,
    );
    const result = await service.run({
      candidateId: 7,
      stepRunId: 70,
      sourcingComparisonId: 31,
      rows: ROWS,
      judgeStock: () => true,
    });
    expect(result.fetched).toEqual([
      { rowId: 2, order: 1, passed: null, unusable: 'MAINTENANCE_PAGE' },
      { rowId: 4, order: 2, passed: true, unusable: null },
    ]);
    expect(result.stopReason).toBe('DAILY_LIMIT');
    expect((published[0]!.data as { stopReason: string }).stopReason).toBe('DAILY_LIMIT');
  });
});
