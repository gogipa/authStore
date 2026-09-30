/**
 * 실질가 순위(F-SO-27, P2-03 규칙 11·12). 순수 함수.
 * - `rankedRowIds`: **검증 행만** 실질가 낮은 순. 재고 부족(`stock_pass=false`)·판정 전(NULL) 행은 재고 통과 행 뒤(Proposed —
 *   '재고 사이즈가 3개보다 적은 샵은 뺍니다'), 실질가가 없는 행(대표 SKU 없음·성별 대기)은 그 안에서 뒤.
 *   미검증 행은 넣지 않는다(실질가 정렬에서 빠지고 고를 수 없다)
 * - 같은 실질가(Proposed): 검색 순위가 앞선 행(수동 행은 검색 순위가 없어 뒤) → 행 id 순
 * `compareByEffectivePrice`는 비교표 조회 기본 정렬(`sort=effectivePriceYen,asc`, 미검증 행은 뒤)도 같이 쓴다.
 */

export interface RankableRow {
  id: number;
  isVerified: boolean;
  stockPass: boolean | null;
  effectivePriceYen: number | null;
  searchRank: number | null;
}

function nullsLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** 검증 → 재고 통과 → 실질가 오름차순 → 검색 순위 → id */
export function compareByEffectivePrice(a: RankableRow, b: RankableRow): number {
  if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
  const ap = a.stockPass === true;
  const bp = b.stockPass === true;
  if (ap !== bp) return ap ? -1 : 1;
  return (
    nullsLast(a.effectivePriceYen, b.effectivePriceYen) ||
    nullsLast(a.searchRank, b.searchRank) ||
    a.id - b.id
  );
}

export function rankedRowIds(rows: readonly RankableRow[]): number[] {
  return rows
    .filter((row) => row.isVerified)
    .sort(compareByEffectivePrice)
    .map((row) => row.id);
}
