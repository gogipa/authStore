import { ApiException } from '../../common/errors/api.exception.js';
import {
  fetchPriority,
  orderRowsForFetch,
  type PageFetchRow,
  runPageFetchLoop,
} from './page-fetch-loop.js';

function row(rowId: number, price: number, extra: Partial<PageFetchRow> = {}): PageFetchRow {
  return {
    rowId,
    anchorMatch: 'MATCH',
    apiItemPriceMin3Yen: price,
    apiItemPriceYen: price,
    apiPostageFlag: 0,
    searchRank: rowId,
    ...extra,
  };
}

/** 가격 오름차순 12행(모두 앵커 일치) */
const ROWS = Array.from({ length: 12 }, (_, i) => row(i + 1, 10_000 + i * 100));

function loop(options: {
  pass?: (order: number) => boolean;
  failAt?: (order: number) => ApiException | null;
  rows?: PageFetchRow[];
}) {
  const reads: number[] = [];
  const promise = runPageFetchLoop<{ rowId: number }>({
    rows: options.rows ?? ROWS,
    targetPassed: 3,
    maxPages: 10,
    defaultShippingYen: 800,
    fetchPage: (r, order) => {
      const error = options.failAt?.(order);
      if (error) return Promise.reject(error);
      reads.push(r.rowId);
      return Promise.resolve({ kind: 'FETCHED', snapshot: { rowId: r.rowId } });
    },
    judgeStock: (_r, _s) => options.pass?.(reads.length) ?? false,
  });
  return { promise, reads };
}

describe('페이지 조회 순서·중단 기준(F-SO-12, P2-02 규칙 7)', () => {
  it('가짜 판정으로 1·3·4번째만 통과 → 4번 읽고 ENOUGH_CANDIDATES', async () => {
    const { promise, reads } = loop({ pass: (n) => [1, 3, 4].includes(n) });
    const result = await promise;
    expect(result).toMatchObject({
      fetchedCount: 4,
      passedCount: 3,
      stopReason: 'ENOUGH_CANDIDATES',
    });
    expect(reads).toEqual([1, 2, 3, 4]);
    expect(result.fetched.map((f) => f.passed)).toEqual([true, false, true, true]);
  });

  it('모두 실패 → 10번 읽고 PAGE_CAP', async () => {
    const { promise, reads } = loop({ pass: () => false });
    expect(await promise).toMatchObject({
      fetchedCount: 10,
      passedCount: 0,
      stopReason: 'PAGE_CAP',
    });
    expect(reads).toHaveLength(10);
  });

  it('5번째에 하루 상한(409 DAILY_LIMIT_REACHED) → 그 자리에서 DAILY_LIMIT', async () => {
    const { promise, reads } = loop({
      failAt: (order) => (order === 5 ? new ApiException('DAILY_LIMIT_REACHED') : null),
    });
    expect(await promise).toMatchObject({ fetchedCount: 4, stopReason: 'DAILY_LIMIT' });
    expect(reads).toHaveLength(4);
  });

  it('3번째가 403(24시간 쉼 409 EXTERNAL_CALL_COOLDOWN) → BLOCKED, 다시 보내지 않는다', async () => {
    let attempts = 0;
    const result = await runPageFetchLoop<number>({
      rows: ROWS,
      targetPassed: 3,
      maxPages: 10,
      defaultShippingYen: 800,
      fetchPage: (_r, order) => {
        attempts += 1;
        return order === 3
          ? Promise.reject(new ApiException('EXTERNAL_CALL_COOLDOWN'))
          : Promise.resolve({ kind: 'FETCHED', snapshot: order });
      },
      judgeStock: () => false,
    });
    expect(result).toMatchObject({ fetchedCount: 2, stopReason: 'BLOCKED' });
    expect(attempts).toBe(3);
  });

  it('읽을 행이 모자라면 NO_MORE_ROWS, 쓸 수 없는 페이지는 수동 확인으로 넘기고 계속', async () => {
    const result = await runPageFetchLoop<number>({
      rows: ROWS.slice(0, 3),
      targetPassed: 3,
      maxPages: 10,
      defaultShippingYen: 800,
      fetchPage: (_r, order) =>
        Promise.resolve(
          order === 2
            ? { kind: 'UNUSABLE', reason: 'MAINTENANCE_PAGE' }
            : { kind: 'FETCHED', snapshot: order },
        ),
      judgeStock: () => true,
    });
    expect(result).toMatchObject({ fetchedCount: 3, passedCount: 2, stopReason: 'NO_MORE_ROWS' });
    expect(result.fetched[1]).toEqual({
      rowId: 2,
      order: 2,
      passed: null,
      unusable: 'MAINTENANCE_PAGE',
    });
  });

  it('그 밖 오류는 그대로 던진다', async () => {
    const { promise } = loop({ failAt: () => new ApiException('EXTERNAL_API_ERROR') });
    await expect(promise).rejects.toMatchObject({ code: 'EXTERNAL_API_ERROR' });
  });

  it('순서: 앵커 일치 행만, itemPriceMin3 + 송료 추정(postageFlag=0이면 0, 아니면 기본 송료) 오름차순', () => {
    const rows = [
      row(1, 11_800, { apiPostageFlag: 1 }), // 12,600
      row(2, 12_000, { apiPostageFlag: 0 }), // 12,000
      row(3, 11_500, { apiPostageFlag: 1, anchorMatch: 'NEEDS_REVIEW' }),
      row(4, 11_000, { apiPostageFlag: 1, apiItemPriceMin3Yen: null }), // itemPrice 11,000 + 800
      row(5, 9_000, { anchorMatch: 'NO_MATCH' }),
      row(6, 12_000, { apiPostageFlag: 0, searchRank: 0 }), // 같은 값이면 검색 순위
    ];
    expect(orderRowsForFetch(rows, 800).map((r) => r.rowId)).toEqual([4, 6, 2, 1]);
    expect(fetchPriority(rows[0]!, 800)).toBe(12_600);
  });
});
