import {
  collectionPeriod,
  minusOneCalendarMonth,
  parseDatalabRange,
  rangeMatches,
} from './collection-period.js';

describe('수집 기간(F-KW-03, P2-01 규칙 5)', () => {
  it('지금 2026-09-24T00:30+09:00(UTC로는 9/23) → 종료 2026-09-23, 시작 2026-08-23(서버 시간대가 아니라 KST)', () => {
    const now = new Date('2026-09-24T00:30:00+09:00');
    expect(now.toISOString().slice(0, 10)).toBe('2026-09-23');
    expect(collectionPeriod(now)).toEqual({ startDate: '2026-08-23', endDate: '2026-09-23' });
  });

  it('KST 날짜 경계: 23:59 KST면 어제는 그날 − 1일', () => {
    expect(collectionPeriod(new Date('2026-09-23T23:59:00+09:00'))).toEqual({
      startDate: '2026-08-22',
      endDate: '2026-09-22',
    });
  });

  it('월말(Proposed): 그 달에 같은 날이 없으면 그 달 마지막 날', () => {
    expect(minusOneCalendarMonth('2026-03-31')).toBe('2026-02-28');
    expect(minusOneCalendarMonth('2028-03-31')).toBe('2028-02-29');
    expect(minusOneCalendarMonth('2026-05-31')).toBe('2026-04-30');
    expect(minusOneCalendarMonth('2026-01-15')).toBe('2025-12-15');
    expect(collectionPeriod(new Date('2026-04-01T09:00:00+09:00'))).toEqual({
      startDate: '2026-02-28',
      endDate: '2026-03-31',
    });
  });

  it("range '2026.08.23. ~ 2026.09.23.' → matched true, '2026.08.22. ~ …' → false", () => {
    const period = { startDate: '2026-08-23', endDate: '2026-09-23' };
    expect(parseDatalabRange('2026.08.23. ~ 2026.09.23.')).toEqual(period);
    expect(rangeMatches('2026.08.23. ~ 2026.09.23.', period)).toBe(true);
    expect(rangeMatches('2026.08.22. ~ 2026.09.23.', period)).toBe(false);
    expect(rangeMatches('2026.8.23 ~ 2026.9.23', period)).toBe(true);
  });

  it('읽을 수 없는 range는 null(대조 결과 false)', () => {
    expect(parseDatalabRange('어제까지')).toBeNull();
    expect(rangeMatches('', { startDate: '2026-08-23', endDate: '2026-09-23' })).toBe(false);
  });
});
