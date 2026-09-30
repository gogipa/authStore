import { compareByEffectivePrice, rankedRowIds, type RankableRow } from './ranking.js';

const r = (
  id: number,
  effectivePriceYen: number | null,
  extra: Partial<RankableRow> = {},
): RankableRow => ({
  id,
  isVerified: true,
  stockPass: true,
  effectivePriceYen,
  searchRank: id,
  ...extra,
});

describe('ranking(F-SO-27)', () => {
  it('검증 행만 실질가 낮은 순, 실질가 없는 검증 행은 뒤, 미검증은 뺀다', () => {
    const rows = [
      r(1, 12_332),
      r(2, 11_455),
      r(3, null),
      r(4, 11_000, { isVerified: false }),
      r(5, 11_900),
    ];
    expect(rankedRowIds(rows)).toEqual([2, 5, 1, 3]);
  });

  it('재고 부족·판정 전 검증 행은 실질가가 낮아도 재고 통과 행 뒤(Proposed)', () => {
    const rows = [
      r(1, 12_000),
      r(2, 10_900, { stockPass: false }),
      r(3, 11_000, { stockPass: null }),
    ];
    expect(rankedRowIds(rows)).toEqual([1, 2, 3]);
  });

  it('같은 실질가면 검색 순위(수동 행은 뒤) → id(Proposed)', () => {
    const rows = [
      r(10, 11_455, { searchRank: 7 }),
      r(11, 11_455, { searchRank: null }),
      r(12, 11_455, { searchRank: 3 }),
      r(9, 11_455, { searchRank: null }),
    ];
    expect(rankedRowIds(rows)).toEqual([12, 10, 9, 11]);
  });

  it('정렬 비교: 미검증은 늘 뒤', () => {
    const sorted = [r(1, null, { isVerified: false }), r(2, 13_000)].sort(compareByEffectivePrice);
    expect(sorted.map((x) => x.id)).toEqual([2, 1]);
  });
});
