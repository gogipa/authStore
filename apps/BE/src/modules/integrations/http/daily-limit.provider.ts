import { type CallLogTarget, type DailyLimitKey, EXTERNAL_TARGETS } from './external-targets.js';

/**
 * 대상별 하루 상한(주입 토큰). 상한이 없으면 null.
 * 원본은 설정 파일이다(P1-03): RAKUTEN_PAGE = `sourcing.pageFetchDailyLimit`, DATALAB = `keywords.datalabDailyLimit`.
 * 쓸 수 있는 설정이 없을 때만 아래 기본값 표를 쓴다.
 */
export type DailyLimitProvider = (target: CallLogTarget) => number | null;

export const DAILY_LIMIT_PROVIDER = Symbol('DAILY_LIMIT_PROVIDER');

/**
 * 설정이 없을 때의 하루 상한(설정 기본 템플릿과 같은 값. daily-limit.provider.spec.ts가 맞는지 본다).
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

/** 하루 상한을 읽는 설정(SettingsService의 필요한 부분만) */
export interface DailyLimitSettingsSource {
  currentOrNull(): {
    sourcing: { pageFetchDailyLimit: number };
    keywords: { datalabDailyLimit: number };
  } | null;
}

/**
 * 설정 파일의 하루 상한을 요청마다 읽는다(다시 읽기로 바뀐 값이 바로 적용된다).
 * 쓸 수 있는 설정 스냅샷이 없으면 fallback(기본값 표)을 쓴다.
 */
export function createSettingsDailyLimitProvider(
  settings: DailyLimitSettingsSource,
  fallback: Readonly<Record<DailyLimitKey, number>> = DEFAULT_DAILY_LIMITS,
): DailyLimitProvider {
  return (target) => {
    const key = EXTERNAL_TARGETS[target].dailyLimitKey;
    if (!key) return null;
    const current = settings.currentOrNull();
    if (!current) return fallback[key];
    return key === 'RAKUTEN_PAGE_PER_DAY'
      ? current.sourcing.pageFetchDailyLimit
      : current.keywords.datalabDailyLimit;
  };
}
