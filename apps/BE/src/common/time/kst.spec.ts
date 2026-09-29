import {
  formatKstDateTime,
  nextKstMidnight,
  secondsUntilNextKstMidnight,
  startOfKstDay,
  toKstDate,
  toKstDateValue,
} from './kst.js';

describe('kst', () => {
  it.each([
    ['2026-09-27T14:59:59Z', '2026-09-27'],
    ['2026-09-27T15:00:00Z', '2026-09-28'],
    ['2026-09-27T00:00:00Z', '2026-09-27'],
    ['2026-12-31T15:00:00Z', '2027-01-01'],
  ])('toKstDate(%s) = %s', (iso, expected) => {
    expect(toKstDate(new Date(iso))).toBe(expected);
  });

  it('toKstDateValue는 그 한국 날짜의 UTC 0시 Date(Prisma @db.Date)', () => {
    expect(toKstDateValue(new Date('2026-09-27T15:00:00Z')).toISOString()).toBe(
      '2026-09-28T00:00:00.000Z',
    );
  });

  it('2026-09-27T14:00:00Z의 다음 KST 0시까지 3600초', () => {
    expect(secondsUntilNextKstMidnight(new Date('2026-09-27T14:00:00Z'))).toBe(3600);
  });

  it('정확히 KST 0시면 다음 날 0시까지(86400초)', () => {
    expect(secondsUntilNextKstMidnight(new Date('2026-09-27T15:00:00Z'))).toBe(86400);
  });

  it('남은 초는 올림한다(0.5초 → 1초)', () => {
    expect(secondsUntilNextKstMidnight(new Date('2026-09-27T14:59:59.500Z'))).toBe(1);
  });

  it('startOfKstDay·nextKstMidnight', () => {
    const now = new Date('2026-09-28T03:00:00Z'); // KST 12:00
    expect(startOfKstDay(now).toISOString()).toBe('2026-09-27T15:00:00.000Z');
    expect(nextKstMidnight(now).toISOString()).toBe('2026-09-28T15:00:00.000Z');
  });

  it('formatKstDateTime은 한국 시각 YYYY-MM-DD HH:mm', () => {
    expect(formatKstDateTime(new Date('2026-09-28T05:07:30Z'))).toBe('2026-09-28 14:07');
  });
});
