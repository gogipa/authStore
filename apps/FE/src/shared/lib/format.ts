/**
 * 화면 숫자·시각 표기(공통부품_마크업.md §J, PRD §9 시간대).
 * 표기: `167,300원` · `¥12,000` · `255mm` · `10%` · `14:02`. 시각은 항상 Asia/Seoul로 쓴다.
 * 글꼴(mono, tabular-nums)과 정렬은 `Num` 부품이 맡는다. 여기는 글자만 만든다.
 */

/** 값이 없을 때 보이는 글자(내비 상태 상자와 같은 빈 값 표시). */
export const EMPTY_VALUE = '—';

export const KST_TIME_ZONE = 'Asia/Seoul';

const integerFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const oneDecimalFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 });
const kstTimeFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: KST_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function withSign(value: number, format: (abs: number) => string): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  return value < 0 ? `-${format(-value)}` : format(value);
}

/** 원: 167300 → `167,300원`(원 단위 정수). */
export function formatKrw(value: number): string {
  return withSign(value, (abs) => `${integerFormat.format(abs)}원`);
}

/** 엔: 12000 → `¥12,000`. */
export function formatYen(value: number): string {
  return withSign(value, (abs) => `¥${integerFormat.format(abs)}`);
}

/** 사이즈(mm): 255 → `255mm`. 반 치수는 소수 한 자리. */
export function formatMm(value: number): string {
  return withSign(value, (abs) => `${oneDecimalFormat.format(abs)}mm`);
}

/** 소수 자리 수(비율 표기). 주지 않으면 0~1자리. */
export interface FractionDigits {
  minFractionDigits?: number;
  maxFractionDigits?: number;
}

/**
 * 비율: 10 → `10%`. 값은 **퍼센트 수**다(0.1이 아니라 10). 소수는 기본 한 자리까지.
 * 설정의 비율도 퍼센트 수다(P1-03, 06-4 §2.2 — `costs.cardSurchargePct` 2.5 = 2.5%).
 * 요율처럼 자리를 맞춰 보일 때는 자리 수를 준다: `formatPct(3, { minFractionDigits: 1, maxFractionDigits: 2 })` → `3.0%`,
 * `formatPct(3.63, …)` → `3.63%`(Settings 보드 '적용 중인 기본값').
 */
export function formatPct(value: number, digits: FractionDigits = {}): string {
  const { minFractionDigits = 0, maxFractionDigits = Math.max(1, minFractionDigits) } = digits;
  const format =
    minFractionDigits === 0 && maxFractionDigits === 1
      ? oneDecimalFormat
      : new Intl.NumberFormat('ko-KR', {
          minimumFractionDigits: minFractionDigits,
          maximumFractionDigits: maxFractionDigits,
        });
  return withSign(value, (abs) => `${format.format(abs)}%`);
}

/** 개수: 1358 → `1,358`. */
export function formatCount(value: number): string {
  return withSign(value, (abs) => integerFormat.format(abs));
}

/** 시각(Asia/Seoul) `HH:mm`: '2026-09-27T05:02:00Z' → `14:02`. */
export function formatKstTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  const parts = kstTimeFormat.formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
  return `${hour}:${minute}`;
}

const kstMonthDayFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: KST_TIME_ZONE,
  month: '2-digit',
  day: '2-digit',
});

/** 날짜·시각(Asia/Seoul) `MM-DD HH:mm`: '2026-09-27T05:00:00Z' → `09-27 14:00`(AiEngine 보드 점검 이력, P1-11). */
export function formatKstMonthDayTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  const parts = kstMonthDayFormat.formatToParts(date);
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${month}-${day} ${formatKstTime(date)}`;
}

const kstDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: KST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * 지난 시각(Asia/Seoul)을 오늘 기준으로: 오늘이면 `HH:mm`, 다른 날이면 `MM-DD HH:mm`.
 * 오래된 기록이 방금 것처럼 보이지 않게 한다(D-29 '시작 준비'의 마지막 연결 테스트 통과 시각). `now`는 테스트용.
 */
export function formatKstTimeOrDate(value: string | Date, now: Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return kstDateFormat.format(date) === kstDateFormat.format(now)
    ? formatKstTime(date)
    : formatKstMonthDayTime(date);
}
