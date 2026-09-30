import {
  customsReferenceAt,
  customsWeekEnd,
  customsWeekStart,
  type FxCollectionState,
  isKstWeekday,
  keximReferenceAt,
  planFxCollection,
} from './fx-schedule.js';

/** KST 시각 → Date */
const kst = (text: string) => new Date(`${text}+09:00`);
const HOUR = 3_600_000;

function state(now: Date, over: Partial<FxCollectionState> = {}): FxCollectionState {
  return {
    now,
    hasTodayCost: false,
    hasThisWeekCustoms: true,
    lastCostCallAt: null,
    lastCustomsCallAt: null,
    ...over,
  };
}

describe('수집 계획(planFxCollection, 규칙 1·2)', () => {
  // 2026-09-28은 월요일
  it('평일 10:59 KST → 원가 환율을 부르지 않는다', () => {
    expect(planFxCollection(state(kst('2026-09-28T10:59:59'))).cost).toBe(false);
  });

  it('평일 11:00 KST, 오늘 행 없음 → 부른다', () => {
    expect(planFxCollection(state(kst('2026-09-28T11:00:00'))).cost).toBe(true);
  });

  it('같은 날 두 번째 검사(오늘 행 있음) → 부르지 않는다', () => {
    expect(planFxCollection(state(kst('2026-09-28T15:00:00'), { hasTodayCost: true })).cost).toBe(
      false,
    );
  });

  it('토·일은 영업일이 아니라 부르지 않는다', () => {
    expect(planFxCollection(state(kst('2026-10-03T12:00:00'))).cost).toBe(false);
    expect(planFxCollection(state(kst('2026-10-04T12:00:00'))).cost).toBe(false);
    expect(isKstWeekday(kst('2026-10-02T23:59:00'))).toBe(true);
    // 서버가 UTC여도 KST로 본다: UTC 금요일 16시 = KST 토요일 01시
    expect(isKstWeekday(new Date('2026-10-02T16:00:00Z'))).toBe(false);
  });

  it('실패·빈 응답 뒤 1시간 안에는 다시 부르지 않고, 1시간이 지나면 부른다', () => {
    const now = kst('2026-09-28T12:30:00');
    expect(
      planFxCollection(state(now, { lastCostCallAt: new Date(now.getTime() - 30 * 60_000) })).cost,
    ).toBe(false);
    expect(
      planFxCollection(state(now, { lastCostCallAt: new Date(now.getTime() - HOUR) })).cost,
    ).toBe(true);
    // 어제 마지막 호출은 오늘과 상관없다
    expect(planFxCollection(state(now, { lastCostCallAt: kst('2026-09-27T23:50:00') })).cost).toBe(
      true,
    );
  });

  it('과세환율: 이번 주 행이 없으면 요일·시각과 상관없이 부르고, 있으면 부르지 않는다', () => {
    expect(
      planFxCollection(state(kst('2026-10-04T01:00:00'), { hasThisWeekCustoms: false })).customs,
    ).toBe(true);
    expect(planFxCollection(state(kst('2026-10-04T01:00:00'))).customs).toBe(false);
    const now = kst('2026-09-29T09:00:00');
    expect(
      planFxCollection(
        state(now, {
          hasThisWeekCustoms: false,
          lastCustomsCallAt: new Date(now.getTime() - 10 * 60_000),
        }),
      ).customs,
    ).toBe(false);
  });
});

describe('기준 시각(reference_at)', () => {
  it('원가 환율 = 고시일 11:00 KST', () => {
    expect(keximReferenceAt('2026-09-28').toISOString()).toBe('2026-09-28T02:00:00.000Z');
  });

  it('과세환율 적용 주 = 일요일 00:00 KST 시작 7일(끝은 저장하지 않고 계산)', () => {
    const start = customsWeekStart(kst('2026-09-30T15:00:00'));
    expect(start.toISOString()).toBe('2026-09-26T15:00:00.000Z'); // 9/27(일) 00:00 KST
    expect(customsWeekEnd(start).toISOString()).toBe('2026-10-03T15:00:00.000Z');
    expect(customsWeekStart(kst('2026-09-27T00:00:00')).toISOString()).toBe(start.toISOString());
  });

  it('과세환율 reference_at = 응답 적용 시작일 00:00 KST, 없으면 조회일이 속한 주의 일요일', () => {
    expect(customsReferenceAt('20260927', kst('2026-09-28T09:00:00')).toISOString()).toBe(
      '2026-09-26T15:00:00.000Z',
    );
    expect(customsReferenceAt(null, kst('2026-09-28T09:00:00')).toISOString()).toBe(
      '2026-09-26T15:00:00.000Z',
    );
    expect(customsReferenceAt('2026-09', kst('2026-09-28T09:00:00')).toISOString()).toBe(
      '2026-09-26T15:00:00.000Z',
    );
  });
});
