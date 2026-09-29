import { type CallLogTarget, type DailyLimitKey, EXTERNAL_TARGETS } from './external-targets.js';

/**
 * 대상별 하루 상한(주입 토큰). 상한이 없으면 null.
 * 지금은 기본값 표만 본다. P1-03이 설정 파일의 하루 조회 상한을 읽게 바꾼다(RAKUTEN_PAGE 원본은 설정 파일).
 */
export type DailyLimitProvider = (target: CallLogTarget) => number | null;

export const DAILY_LIMIT_PROVIDER = Symbol('DAILY_LIMIT_PROVIDER');

/**
 * 기본 하루 상한. 숫자는 여기에만 적는다.
 * - RAKUTEN_PAGE_PER_DAY 110: PRD §8.8 M1 기본 110페이지(①-6 답으로 조정)
 * - DATALAB_PER_DAY 100: Proposed(문서에 없음, 06-2 §9). 버튼 수집 1회가 상위 100위 10요청·500위 50요청이라
 *   하루에 500위 수집 2번(상위 100위는 10번)까지
 */
export const DEFAULT_DAILY_LIMITS: Readonly<Record<DailyLimitKey, number>> = {
  RAKUTEN_PAGE_PER_DAY: 110,
  DATALAB_PER_DAY: 100,
};

export function createDailyLimitProvider(
  limits: Readonly<Record<DailyLimitKey, number>> = DEFAULT_DAILY_LIMITS,
): DailyLimitProvider {
  return (target) => {
    const key = EXTERNAL_TARGETS[target].dailyLimitKey;
    return key ? limits[key] : null;
  };
}
