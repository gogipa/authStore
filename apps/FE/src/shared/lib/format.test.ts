import { describe, expect, it } from 'vitest';
import {
  EMPTY_VALUE,
  formatCount,
  formatKrw,
  formatKstMonthDayTime,
  formatKstTime,
  formatMm,
  formatPct,
  formatYen,
} from './format';

describe('숫자·시각 표기(공통부품 §J)', () => {
  it('원: 167300 → 167,300원', () => {
    expect(formatKrw(167300)).toBe('167,300원');
    expect(formatKrw(0)).toBe('0원');
    expect(formatKrw(-3000)).toBe('-3,000원');
  });

  it('엔: 12000 → ¥12,000', () => {
    expect(formatYen(12000)).toBe('¥12,000');
    expect(formatYen(-800)).toBe('-¥800');
  });

  it('mm: 255 → 255mm', () => {
    expect(formatMm(255)).toBe('255mm');
    expect(formatMm(252.5)).toBe('252.5mm');
  });

  it('%: 10 → 10%(값은 퍼센트 수), 소수 한 자리까지', () => {
    expect(formatPct(10)).toBe('10%');
    expect(formatPct(16.44)).toBe('16.4%');
    expect(formatPct(3.63)).toBe('3.6%');
  });

  it('비율 자리 수를 정할 수 있다(설정 요율: 3.0% · 3.63% · 2.5%)', () => {
    const rate = { minFractionDigits: 1, maxFractionDigits: 2 };
    expect(formatPct(3, rate)).toBe('3.0%');
    expect(formatPct(3.63, rate)).toBe('3.63%');
    expect(formatPct(2.5, rate)).toBe('2.5%');
    expect(formatPct(1.947, rate)).toBe('1.95%');
    expect(formatPct(10, { maxFractionDigits: 0 })).toBe('10%');
  });

  it('시각: Asia/Seoul 기준 HH:mm', () => {
    expect(formatKstTime('2026-09-27T05:02:00Z')).toBe('14:02');
    expect(formatKstTime('2026-09-27T14:02:11+09:00')).toBe('14:02');
    // KST 0시 넘김: UTC 15:30 → 다음 날 00:30
    expect(formatKstTime(new Date('2026-09-27T15:30:00Z'))).toBe('00:30');
  });

  it('날짜·시각: Asia/Seoul 기준 MM-DD HH:mm(P1-11 점검 이력)', () => {
    expect(formatKstMonthDayTime('2026-09-27T05:00:00Z')).toBe('09-27 14:00');
    // KST 0시 넘김: 날짜도 바뀐다
    expect(formatKstMonthDayTime('2026-09-27T15:30:00Z')).toBe('09-28 00:30');
    expect(formatKstMonthDayTime('nope')).toBe(EMPTY_VALUE);
  });

  it('개수: 천 단위 쉼표만', () => {
    expect(formatCount(1358)).toBe('1,358');
  });

  it('값이 없거나 읽을 수 없으면 빈 값 표시(—)', () => {
    expect(formatKstTime('not-a-date')).toBe(EMPTY_VALUE);
    expect(formatKrw(Number.NaN)).toBe(EMPTY_VALUE);
    expect(EMPTY_VALUE).toBe('—');
  });
});
