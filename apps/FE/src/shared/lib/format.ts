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

/**
 * 비율: 10 → `10%`. 값은 **퍼센트 수**다(0.1이 아니라 10). 소수는 한 자리까지.
 * (Proposed, 06-3 §9 — API의 비율 표기가 정해지면(P1-03, 05-1 §7.1-4) 호출하는 쪽이 맞춰 넘긴다.)
 */
export function formatPct(value: number): string {
  return withSign(value, (abs) => `${oneDecimalFormat.format(abs)}%`);
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
