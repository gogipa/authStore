import { formatKstDateTime } from '../../../../common/time/kst.js';
import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import { resultOf } from './check-helpers.js';

const HOUR_MS = 3_600_000;

/** 판정 유효 끝 = 판정에 쓴 라쿠텐 페이지 수집 시각 + 설정 유효 시간(05-2 ApprovalPreview.judgementExpiresAt) */
export function judgementExpiresAt(collectedAt: Date, validityHours: number): Date {
  return new Date(collectedAt.getTime() + validityHours * HOUR_MS);
}

function hhmm(date: Date): string {
  return formatKstDateTime(date).slice(11);
}

/**
 * `JUDGEMENT_FRESHNESS`(F-AP-21, US-20 AC2·US-25 AC2, PRD §5.3 '판정 유효 시간', P4-02 규칙 11): 지금 − 판정에 쓴 라쿠텐 페이지
 * 수집 시각(`price_judgement.rakuten_page_collected_at`) ≤ 설정 유효 시간(`safety.judgementValidityHours`, 기본 6 — 6보다 긴 설정은
 * 앱 시작 때 거부). 경계(정확히 6시간)는 통과다. ③만 다시 실행해도 이 시각은 바뀌지 않는다(③은 ② 스냅샷 시각을 옮겨 적는다).
 * 실패면 `stepCode=SOURCING` — 화면은 '재조회'(`POST /candidates/{id}/refetch`, P2-02)를 보인다.
 */
export function judgementFreshnessCheck(ctx: PreValidationContext): PreValidationCheck {
  const judgement = ctx.inputs.judgement;
  const collected = judgement?.rakutenPageCollectedAt ?? null;
  if (!collected) {
    return resultOf('JUDGEMENT_FRESHNESS', [
      { message: '판정에 쓴 라쿠텐 페이지 수집 시각이 없습니다', stepCode: 'SOURCING' },
    ]);
  }
  const hours = ctx.inputs.settings.judgementValidityHours;
  const collectedAt = new Date(collected);
  const expiresAt = judgementExpiresAt(collectedAt, hours);
  if (ctx.now.getTime() <= expiresAt.getTime()) return resultOf('JUDGEMENT_FRESHNESS', []);
  return resultOf('JUDGEMENT_FRESHNESS', [
    {
      message: `라쿠텐 페이지를 받은 지 ${hours}시간이 넘었습니다(${hhmm(collectedAt)} 받음 · ${hhmm(expiresAt)}까지 유효). '재조회'로 다시 판정해 주세요`,
      stepCode: 'SOURCING',
    },
  ]);
}
