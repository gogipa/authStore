import {
  EMPTY_VALUE,
  formatCount,
  formatKrw,
  formatKstTime,
  formatMm,
  formatPct,
  formatYen,
} from '@/shared/lib/format';

/**
 * krw `167,300원` · yen `¥12,000` · mm `255mm` · pct `10%`(값은 퍼센트 수) · time `14:02`(Asia/Seoul)
 * · count `1,358`(단위 없음, Proposed).
 */
export type NumUnit = 'krw' | 'yen' | 'mm' | 'pct' | 'time' | 'count';

export type NumValue = number | string | Date | null | undefined;

/** 값 하나를 단위 표기로 바꾼다. 값이 없거나 읽을 수 없으면 '—'. */
export function formatNum(value: NumValue, unit: NumUnit): string {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE;
  if (unit === 'time') return formatKstTime(value instanceof Date ? value : String(value));
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return EMPTY_VALUE;
  switch (unit) {
    case 'krw':
      return formatKrw(n);
    case 'yen':
      return formatYen(n);
    case 'mm':
      return formatMm(n);
    case 'pct':
      return formatPct(n);
    case 'count':
      return formatCount(n);
  }
}
