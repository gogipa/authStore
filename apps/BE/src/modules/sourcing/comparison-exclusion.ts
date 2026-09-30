import type { PageFetchStopReason } from './page-fetch-loop.js';

/**
 * 재고 부족·앵커 불일치로 후보를 제외할지(F-SO-21, P2-03 규칙 7, ERD `ck_candidate_excluded_reason`). 순수 함수.
 * 판단 시점(Proposed): 앵커 뒤 페이지 조회 반복이 끝까지 본 때만 — `PAGE_CAP`(M페이지)·`NO_MORE_ROWS`(읽을 일치 행 없음).
 * `ENOUGH_CANDIDATES`는 통과 행이 있고, `DAILY_LIMIT`·`BLOCKED`는 끝까지 보지 못해 판단하지 않는다.
 * - `ANCHOR_NO_MATCH`: 같은 상품일 수 있는 행이 하나도 없다 — 규칙 일치(MATCH)·확인 필요(NEEDS_REVIEW)·오너 '같은 상품' 모두 0
 *   (Proposed: '확인 필요' 행이 있으면 오너가 '재고 확인'·'같은 상품'으로 이어 갈 수 있어 제외하지 않는다. 오너가 '다른
 *   상품'으로 판단한 행은 뺀다)
 * - `INSUFFICIENT_STOCK`: 재고 통과 행이 하나도 없고, 페이지를 읽어 재고 부족으로 판정한 행이 하나 이상 있다
 * 제외 상태 전환 자체는 step-engine 상태 재평가(F-CW-05)가 한다. ②는 입력 대기 그대로다.
 */

export type ComparisonExclusion = 'ANCHOR_NO_MATCH' | 'INSUFFICIENT_STOCK';

export interface ExclusionRow {
  anchorMatch: string | null;
  ownerMatchDecision: string | null;
  isVerified: boolean;
  stockPass: boolean | null;
}

/** 판단하는 멈춤 사유 */
export const EXCLUSION_STOP_REASONS: readonly PageFetchStopReason[] = ['PAGE_CAP', 'NO_MORE_ROWS'];

export function exclusionAfterFetch(
  stopReason: PageFetchStopReason,
  rows: readonly ExclusionRow[],
): ComparisonExclusion | null {
  if (!EXCLUSION_STOP_REASONS.includes(stopReason)) return null;
  const maybeSame = rows.some(
    (r) =>
      r.ownerMatchDecision === 'MATCH' ||
      (r.ownerMatchDecision !== 'NO_MATCH' &&
        (r.anchorMatch === 'MATCH' || r.anchorMatch === 'NEEDS_REVIEW')),
  );
  if (!maybeSame) return 'ANCHOR_NO_MATCH';
  const anyPass = rows.some((r) => r.stockPass === true);
  const anyFail = rows.some((r) => r.isVerified && r.stockPass === false);
  return !anyPass && anyFail ? 'INSUFFICIENT_STOCK' : null;
}
