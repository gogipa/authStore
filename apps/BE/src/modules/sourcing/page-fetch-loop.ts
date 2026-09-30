import { ApiException } from '../../common/errors/api.exception.js';

/**
 * 페이지 조회 순서·중단 기준(F-SO-12, PRD §8.2 RK-04 '2단계 조회', P2-02 규칙 7). 재고 통과 판정과 페이지 읽기는 인자로 받는다
 * (P2-03이 앵커 분류·재고 판정을 넣는다 — 같은 SOURCING 실행기 안). 페이지 읽기는 외부 호출 관문의 RAKUTEN_PAGE 직렬 큐 하나를
 * 지나야 한다(3초 간격·하루 상한·24시간 쉼은 관문이 지킨다 — 이 함수는 기다리지 않는다).
 *
 * 순서: 앵커와 일치(anchorMatch=MATCH)한 행을 `itemPriceMin3 + 송료 추정`(postageFlag=0이면 0, 아니면 기본 송료) 오름차순,
 * 같으면 검색 순위 순. 멈춤:
 * - 재고 통과 행이 K(설정 3)개 → ENOUGH_CANDIDATES
 * - M(설정 10)페이지를 읽음 → PAGE_CAP
 * - 하루 상한(409 DAILY_LIMIT_REACHED) → DAILY_LIMIT, 403·418·429 쉼(409 EXTERNAL_CALL_COOLDOWN) → BLOCKED — 그 자리에서
 * - 읽을 행이 더 없음 → NO_MORE_ROWS(Proposed, 05-2 SourcingPageFetchFinishedEvent.stopReason에 더함)
 * 한 페이지 실패(점검·파싱 실패·응답 없음)는 멈추지 않고 그 행을 '수동 확인'으로 넘긴 뒤 다음 행을 읽는다(읽은 수에는 든다).
 */
export type PageFetchStopReason =
  'ENOUGH_CANDIDATES' | 'PAGE_CAP' | 'DAILY_LIMIT' | 'BLOCKED' | 'NO_MORE_ROWS';

export interface PageFetchRow {
  rowId: number;
  anchorMatch: string | null;
  apiItemPriceMin3Yen: number | null;
  apiItemPriceYen: number | null;
  apiPostageFlag: number | null;
  searchRank: number | null;
}

/** 한 행 읽기의 결과 */
export type PageFetchOutcome<S> =
  | { kind: 'FETCHED'; snapshot: S }
  /** 읽었지만 쓸 수 없음(점검·파싱 실패 등) → 수동 확인 */
  | { kind: 'UNUSABLE'; reason: string };

export interface PageFetchLoopOptions<S> {
  rows: readonly PageFetchRow[];
  /** K: 재고 통과 후보 수 목표(설정 sourcing.pageFetchTargetCandidates) */
  targetPassed: number;
  /** M: 최대 읽기 페이지 수(설정 sourcing.pageFetchMaxPages) */
  maxPages: number;
  /** 송료 추정(설정 sourcing.defaultShippingYen) */
  defaultShippingYen: number;
  /** 한 행의 페이지를 읽는다(관문 큐). 409 DAILY_LIMIT_REACHED·EXTERNAL_CALL_COOLDOWN은 던진다 */
  fetchPage(row: PageFetchRow, order: number): Promise<PageFetchOutcome<S>>;
  /** 재고 통과 판정(P2-03이 넣는다) */
  judgeStock(row: PageFetchRow, snapshot: S): boolean | Promise<boolean>;
}

export interface PageFetchLoopResult {
  fetchedCount: number;
  passedCount: number;
  stopReason: PageFetchStopReason;
  /** 읽은 순서대로의 행 id와 결과 */
  fetched: { rowId: number; order: number; passed: boolean | null; unusable: string | null }[];
}

/** 1차 순위 값(itemPriceMin3 없으면 itemPrice) + 송료 추정 */
export function fetchPriority(row: PageFetchRow, defaultShippingYen: number): number {
  const price = row.apiItemPriceMin3Yen ?? row.apiItemPriceYen ?? Number.MAX_SAFE_INTEGER / 2;
  const shipping = row.apiPostageFlag === 0 ? 0 : defaultShippingYen;
  return price + shipping;
}

/** 조회 순서(앵커 일치 행만, 순수 함수) */
export function orderRowsForFetch(
  rows: readonly PageFetchRow[],
  defaultShippingYen: number,
): PageFetchRow[] {
  return rows
    .filter((row) => row.anchorMatch === 'MATCH')
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const diff =
        fetchPriority(a.row, defaultShippingYen) - fetchPriority(b.row, defaultShippingYen);
      if (diff !== 0) return diff;
      const rank =
        (a.row.searchRank ?? Number.MAX_SAFE_INTEGER) -
        (b.row.searchRank ?? Number.MAX_SAFE_INTEGER);
      return rank !== 0 ? rank : a.i - b.i;
    })
    .map(({ row }) => row);
}

export async function runPageFetchLoop<S>(
  options: PageFetchLoopOptions<S>,
): Promise<PageFetchLoopResult> {
  const queue = orderRowsForFetch(options.rows, options.defaultShippingYen);
  const fetched: PageFetchLoopResult['fetched'] = [];
  let passedCount = 0;
  const done = (stopReason: PageFetchStopReason): PageFetchLoopResult => ({
    fetchedCount: fetched.length,
    passedCount,
    stopReason,
    fetched,
  });
  for (const row of queue) {
    if (passedCount >= options.targetPassed) return done('ENOUGH_CANDIDATES');
    if (fetched.length >= options.maxPages) return done('PAGE_CAP');
    const order = fetched.length + 1;
    let outcome: PageFetchOutcome<S>;
    try {
      outcome = await options.fetchPage(row, order);
    } catch (error) {
      if (error instanceof ApiException && error.code === 'DAILY_LIMIT_REACHED') {
        return done('DAILY_LIMIT');
      }
      if (error instanceof ApiException && error.code === 'EXTERNAL_CALL_COOLDOWN') {
        // 403·418·429로 막혔거나 이미 쉼 중: 곧바로 멈춘다(다시 보내지 않는다). 막힌 요청은 읽은 수에 넣지 않는다
        // (하루 상한 집계에는 call_log 행으로 이미 들어갔다)
        return done('BLOCKED');
      }
      throw error;
    }
    if (outcome.kind === 'UNUSABLE') {
      fetched.push({ rowId: row.rowId, order, passed: null, unusable: outcome.reason });
      continue;
    }
    const passed = await options.judgeStock(row, outcome.snapshot);
    if (passed) passedCount += 1;
    fetched.push({ rowId: row.rowId, order, passed, unusable: null });
  }
  if (passedCount >= options.targetPassed) return done('ENOUGH_CANDIDATES');
  if (fetched.length >= options.maxPages) return done('PAGE_CAP');
  return done('NO_MORE_ROWS');
}
