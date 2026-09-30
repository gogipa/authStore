import {
  effectivePriceOf,
  floorDiv,
  itemMultiplierScaled,
  type PointSettings,
  pointsOf,
  shippingOf,
  toScaled,
} from './effective-price.js';

/** 숫자는 PRD §8.2 RK-06 테스트 기대값·P2-03 §6 표로 고정한다 */
const PER_PROGRAM: PointSettings = {
  pointRateIncludesBase: true,
  rounding: 'PER_PROGRAM',
  spuMultiplier: 0,
};
const SIMPLE: PointSettings = { ...PER_PROGRAM, rounding: 'SIMPLE' };

function points(
  price: number,
  pointRate: number | null,
  extra: {
    coupon?: number;
    shopEvent?: number | string;
    settings?: Partial<PointSettings>;
  } = {},
) {
  return pointsOf({
    representativePriceYen: price,
    couponYen: extra.coupon ?? 0,
    pointRate,
    shopEventMultiplier: extra.shopEvent ?? 0,
    settings: { ...PER_PROGRAM, ...extra.settings },
  });
}

describe('effective-price 포인트(RK-06, F-SO-22·23)', () => {
  it('¥12,000·pointRate 10·쿠폰 0·프로그램별 → base 10,909, 109 + 981 = 1,090pt', () => {
    const p = points(12_000, 10);
    expect(p).toMatchObject({
      pointBaseAmountYen: 10_909,
      pointsBasePt: 109,
      pointsItemPt: 981,
      pointsShopEventPt: 0,
      pointsSpuPt: 0,
      pointsTotalPt: 1_090,
      totalMultiplierScaled: 100_000,
    });
  });

  it('단순식 → 1,090(¥12,000), ¥12,099 → base 10,999, 프로그램별 1,098 / 단순식 1,099', () => {
    expect(points(12_000, 10, { settings: SIMPLE }).pointsTotalPt).toBe(1_090);
    const perProgram = points(12_099, 10);
    expect(perProgram.pointBaseAmountYen).toBe(10_999);
    expect(perProgram.pointsBasePt + perProgram.pointsItemPt).toBe(109 + 989);
    expect(perProgram.pointsTotalPt).toBe(1_098);
    expect(points(12_099, 10, { settings: SIMPLE }).pointsTotalPt).toBe(1_099);
  });

  it('쿠폰 ¥1,000 → base 10,000(부동소수 오차 없음), 100 + 900 = 1,000pt', () => {
    // 1.1로 나누면 부동소수 오차로 1이 모자라는 값이 생긴다(예: 3,300 / 1.1 = 2,999.9999…). 정수식은 틀리지 않는다
    expect(Math.floor(3_300 / 1.1)).toBe(2_999);
    expect(points(4_300, 1, { coupon: 1_000 }).pointBaseAmountYen).toBe(3_000);
    const p = points(12_000, 10, { coupon: 1_000 });
    expect(p.pointBaseAmountYen).toBe(10_000);
    expect([p.pointsBasePt, p.pointsItemPt, p.pointsTotalPt]).toEqual([100, 900, 1_000]);
  });

  it('pointRateIncludesBase=false·pointRate 10 → 11배 = 109 + 1,090 = 1,199', () => {
    const p = points(12_000, 10, { settings: { pointRateIncludesBase: false } });
    expect([p.pointsBasePt, p.pointsItemPt, p.pointsTotalPt]).toEqual([109, 1_090, 1_199]);
  });

  it('SPU 2 → +218, 샵·이벤트 1.5 → +163', () => {
    expect(points(12_000, 10, { settings: { spuMultiplier: 2 } }).pointsSpuPt).toBe(218);
    const shop = points(12_000, 10, { shopEvent: 1.5 });
    expect(shop.pointsShopEventPt).toBe(163);
    expect(shop.pointsTotalPt).toBe(1_090 + 163);
    // DB numeric(7,4)을 글자로 받아도 같다
    expect(points(12_000, 10, { shopEvent: '1.5000' }).pointsShopEventPt).toBe(163);
  });

  it('pointRate를 모르면(수동 행) 상품 추가분 0 — 기본 1배만', () => {
    expect(itemMultiplierScaled(null, true)).toBe(0);
    expect(points(12_000, null).pointsTotalPt).toBe(109);
    expect(itemMultiplierScaled(1, true)).toBe(0);
  });

  it('쿠폰이 가격보다 크면 base 0(포인트 0)', () => {
    expect(points(1_000, 10, { coupon: 2_000 }).pointsTotalPt).toBe(0);
  });
});

describe('effective-price 실질가·송료', () => {
  it('샵 A: 12,000 + 0 − 0 − 1,090 × 0.5 = 11,455', () => {
    expect(
      effectivePriceOf({
        representativePriceYen: 12_000,
        shippingYen: 0,
        couponYen: 0,
        pointsTotalPt: 1_090,
        kRank: 0.5,
      }),
    ).toBe(11_455);
  });

  it('샵 B(¥11,800, 송료 추정 800, 5배): base 10,727 → 107 + 429 = 536pt → 12,332(시안 590pt·12,305와 다름)', () => {
    const p = points(11_800, 5);
    expect(p.pointBaseAmountYen).toBe(10_727);
    expect([p.pointsBasePt, p.pointsItemPt, p.pointsTotalPt]).toEqual([107, 429, 536]);
    expect(
      effectivePriceOf({
        representativePriceYen: 11_800,
        shippingYen: 800,
        couponYen: 0,
        pointsTotalPt: p.pointsTotalPt,
        kRank: 0.5,
      }),
    ).toBe(12_332);
  });

  it('포인트 × k_rank의 0.5엔은 내림(실질가를 보수적으로 높게, Proposed)', () => {
    expect(
      effectivePriceOf({
        representativePriceYen: 12_099,
        shippingYen: 0,
        couponYen: 0,
        pointsTotalPt: 1_099,
        kRank: 0.5,
      }),
    ).toBe(12_099 - 549);
  });

  it('송료: postageFlag=0 → 0·FREE, postageIncluded=true → 0·FREE, 그 밖 → 800·DEFAULT_ESTIMATE(0 아님)', () => {
    expect(
      shippingOf({ apiPostageFlag: 0, postageIncluded: false, defaultShippingYen: 800 }),
    ).toEqual({ shippingYen: 0, shippingSource: 'FREE' });
    expect(
      shippingOf({ apiPostageFlag: 1, postageIncluded: true, defaultShippingYen: 800 }),
    ).toEqual({ shippingYen: 0, shippingSource: 'FREE' });
    expect(
      shippingOf({ apiPostageFlag: null, postageIncluded: true, defaultShippingYen: 800 }),
    ).toEqual({ shippingYen: 0, shippingSource: 'FREE' });
    expect(
      shippingOf({ apiPostageFlag: 1, postageIncluded: false, defaultShippingYen: 800 }),
    ).toEqual({ shippingYen: 800, shippingSource: 'DEFAULT_ESTIMATE' });
    expect(
      shippingOf({ apiPostageFlag: null, postageIncluded: null, defaultShippingYen: 800 }),
    ).toEqual({ shippingYen: 800, shippingSource: 'DEFAULT_ESTIMATE' });
  });

  it('정수 도구: toScaled(1.5)=15000, toScaled("0.12345")=1235(넷째 자리 반올림), floorDiv는 BigInt 몫', () => {
    expect(toScaled(1.5)).toBe(15_000);
    expect(toScaled('0.12345')).toBe(1_235);
    expect(toScaled(-1)).toBe(0);
    expect(toScaled(null)).toBe(0);
    expect(floorDiv(120_000, 11)).toBe(10_909);
    expect(floorDiv(-5, 3)).toBe(0);
    expect(() => floorDiv(1.5, 3)).toThrow();
  });
});
