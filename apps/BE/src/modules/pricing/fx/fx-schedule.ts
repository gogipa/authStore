import { startOfKstDay, toKstDate } from '../../../common/time/kst.js';

/**
 * 자동 수집 시각 계산(순수 함수, P2-04 규칙 1·2, §8 '시간대'). 서버 시간대와 상관없이 Asia/Seoul(UTC+9, 서머타임 없음)로 본다.
 * Proposed(ERD §7.1-9, 05-1 §7.3 'P2-04 구현 결정'):
 * - 원가 환율: KST 월~금(영업일)이고 11:00 이후, 오늘 고시(`reference_at` = 오늘 11:00 KST, 출처 KEXIM) 행이 없을 때만 부른다.
 *   공휴일은 알 수 없어 부르고, 빈 응답이면 행 없이 넘어간다. 앱이 11시에 꺼져 있었으면 켤 때 오늘 몫을 받는다.
 * - 과세환율: 이번 적용 주(일요일 00:00 KST 시작, 7일) 행이 JPY·USD 둘 다 있으면 부르지 않는다. 요일·시각 제한 없음.
 * - 실패·빈 응답 뒤에는 `retryAfterMs`(기본 1시간) 동안 같은 출처를 다시 부르지 않는다(마지막 호출 시각 = call_log).
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;

/** 수출입은행 고시 시각(KST 11:00, F-BS-40) */
export const KEXIM_NOTICE_HOUR_KST = 11;

/** 그 시각의 KST 요일(0 일요일 ~ 6 토요일) */
export function kstWeekday(date: Date): number {
  return new Date(date.getTime() + KST_OFFSET_MS).getUTCDay();
}

/** 그 시각의 KST 시(0~23) */
export function kstHour(date: Date): number {
  return new Date(date.getTime() + KST_OFFSET_MS).getUTCHours();
}

/** KST 영업일(월~금). 공휴일은 모른다(빈 응답으로 처리) */
export function isKstWeekday(date: Date): boolean {
  const day = kstWeekday(date);
  return day >= 1 && day <= 5;
}

/** 'YYYY-MM-DD'(KST 날짜)의 KST 11:00 = 원가 환율 `reference_at`(규칙 1) */
export function keximReferenceAt(kstDate: string): Date {
  return new Date(`${kstDate}T${String(KEXIM_NOTICE_HOUR_KST).padStart(2, '0')}:00:00+09:00`);
}

/** 그 시각이 속한 과세환율 적용 주의 시작(일요일 00:00 KST, Proposed — 관세청 주간 과세환율은 일~토 적용) */
export function customsWeekStart(date: Date): Date {
  const dayStart = startOfKstDay(date);
  return new Date(dayStart.getTime() - kstWeekday(date) * DAY_MS);
}

/** 적용 주의 끝(다음 일요일 00:00 KST, 배타) — 저장하지 않고 계산한다(ERD §7.1-9 Proposed) */
export function customsWeekEnd(weekStart: Date): Date {
  return new Date(weekStart.getTime() + 7 * DAY_MS);
}

/**
 * 과세환율 `reference_at`(규칙 2 '적용 주의 시작 시각'): 응답의 적용 시작일(YYYYMMDD)이 있으면 그날 00:00 KST,
 * 없거나 모양이 틀리면 조회일이 속한 주의 일요일 00:00 KST.
 */
export function customsReferenceAt(applyStartDate: string | null, queriedAt: Date): Date {
  const m = applyStartDate ? /^(\d{4})(\d{2})(\d{2})$/.exec(applyStartDate.trim()) : null;
  if (m) {
    const at = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`);
    if (!Number.isNaN(at.getTime())) return at;
  }
  return customsWeekStart(queriedAt);
}

export interface FxCollectionState {
  now: Date;
  /** 오늘(KST) 원가 환율 자동 행(KEXIM, reference_at = 오늘 11:00 KST)이 있다 */
  hasTodayCost: boolean;
  /** 이번 적용 주의 과세환율 자동 행(CUSTOMS_SERVICE) JPY·USD가 모두 있다 */
  hasThisWeekCustoms: boolean;
  /** 마지막 FX_KOREAEXIM 호출 시각(call_log, 결과와 상관없이). 없으면 null */
  lastCostCallAt: Date | null;
  /** 마지막 FX_CUSTOMS 호출 시각 */
  lastCustomsCallAt: Date | null;
}

export interface FxCollectionPlan {
  cost: boolean;
  customs: boolean;
}

/** 기본: 실패·빈 응답 뒤 1시간 동안 다시 부르지 않는다(Proposed) */
export const FX_RETRY_AFTER_MS = HOUR_MS;

/** 이번 검사에서 부를 출처(규칙 1·2, 테스트 '10:59 호출 안 함'·'11:00 1회'·'같은 날 두 번째 검사') */
export function planFxCollection(
  state: FxCollectionState,
  retryAfterMs: number = FX_RETRY_AFTER_MS,
): FxCollectionPlan {
  const { now } = state;
  const todayNotice = keximReferenceAt(toKstDate(now));
  const recentlyCalled = (last: Date | null, windowStart: Date): boolean =>
    last !== null &&
    last.getTime() >= windowStart.getTime() &&
    now.getTime() - last.getTime() < retryAfterMs;

  const cost =
    isKstWeekday(now) &&
    now.getTime() >= todayNotice.getTime() &&
    !state.hasTodayCost &&
    !recentlyCalled(state.lastCostCallAt, todayNotice);

  const weekStart = customsWeekStart(now);
  const customs = !state.hasThisWeekCustoms && !recentlyCalled(state.lastCustomsCallAt, weekStart);

  return { cost, customs };
}
