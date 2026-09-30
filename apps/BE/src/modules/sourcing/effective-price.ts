import type { PointRounding } from '../settings/schema/settings.types.js';

/**
 * 송료·포인트·실질가(PRD §8.2 RK-06, F-SO-22·23·24, P2-03 규칙 8~10). 순수 함수 — **정수식으로만** 계산한다.
 * JS에서 1.1로 나누면 부동소수 오차로 base가 1 모자랄 수 있다(`3300 / 1.1` = 2,999.9999…). 그래서 base = floor((가격 − 쿠폰) × 10 / 11), 배율(numeric(7,4),
 * 예 1.5배)은 ×10000 정수(`toScaled`)로 다루고 나눗셈은 BigInt 몫(`floorDiv`)으로 한다.
 *
 * - 송료: API `postageFlag=0` 또는 대표 SKU `postageIncluded=true`면 0(FREE), 그 밖에는 기본 송료(DEFAULT_ESTIMATE,
 *   '송료 추정' — 0으로 두지 않는다, DB ck_scr_shipping_default). 기본 송료 설정이 0이면 FREE로 본다
 * - 포인트: 배율 = 기본 1 + 상품 추가분(`pointRateIncludesBase`면 pointRate − 1) + 샵·이벤트(행별 오너 입력) + SPU(설정).
 *   프로그램별 내림 Σ floor(base × r / 100)(기본) 또는 단순식 floor((가격 − 쿠폰) × Σr / 110)
 * - 실질가 = SKU가_대표 + 송료 − 쿠폰 − floor(포인트 × k_rank). 0.5엔은 **내림**(포인트 가치를 적게 쳐 실질가를 보수적으로
 *   높게 둔다, Proposed — ERD §7.1-7)
 */

/** 배율 정수 스케일(numeric(7,4)) */
export const MULTIPLIER_SCALE = 10_000;

/** 정수 a ÷ 정수 b의 내림(음수 없음 가정 — 음수면 0). BigInt라 2^53을 넘어도 정확하다 */
export function floorDiv(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b) || b <= 0) {
    throw new Error(`floorDiv: 정수가 아닙니다(${a} / ${b})`);
  }
  if (a <= 0) return 0;
  return Number(BigInt(a) / BigInt(b));
}

/**
 * 소수 배율(1.5, '1.5', Decimal.toString())을 ×10000 정수로. 넷째 자리 밑은 반올림한다(numeric(7,4)과 같다).
 * 음수·숫자가 아닌 값은 0
 */
export function toScaled(
  value: number | string | { toString(): string } | null | undefined,
): number {
  if (value === null || value === undefined) return 0;
  const text = typeof value === 'number' ? value.toFixed(6) : value.toString();
  const m = /^\s*(\d+)(?:\.(\d*))?\s*$/.exec(text);
  if (!m) return 0;
  const whole = Number(m[1]);
  const frac = (m[2] ?? '').padEnd(5, '0');
  const four = Number(frac.slice(0, 4));
  const roundUp = Number(frac[4]) >= 5 ? 1 : 0;
  return whole * MULTIPLIER_SCALE + four + roundUp;
}

export type ShippingSource = 'FREE' | 'DEFAULT_ESTIMATE';

/** 송료(F-SO-24, US-05 AC2) */
export function shippingOf(input: {
  apiPostageFlag: number | null;
  /** 대표 SKU(없으면 선택 색상 SKU 모두)의 postageIncluded */
  postageIncluded: boolean | null;
  defaultShippingYen: number;
}): { shippingYen: number; shippingSource: ShippingSource } {
  const free = input.apiPostageFlag === 0 || input.postageIncluded === true;
  if (free || input.defaultShippingYen <= 0) return { shippingYen: 0, shippingSource: 'FREE' };
  return { shippingYen: input.defaultShippingYen, shippingSource: 'DEFAULT_ESTIMATE' };
}

export interface PointSettings {
  pointRateIncludesBase: boolean;
  rounding: PointRounding;
  /** SPU 배율(배) */
  spuMultiplier: number;
}

export interface PointBreakdown {
  /** 세전 기준액 base = floor((SKU가_대표 − 쿠폰) / 1.1) */
  pointBaseAmountYen: number;
  pointsBasePt: number;
  pointsItemPt: number;
  pointsShopEventPt: number;
  pointsSpuPt: number;
  pointsTotalPt: number;
  /** 합계 배율(×10000) — 화면 '10배' */
  totalMultiplierScaled: number;
}

/** 상품 추가분 배율(×10000). pointRate가 없으면(수동 행 등) 0 */
export function itemMultiplierScaled(pointRate: number | null, includesBase: boolean): number {
  if (pointRate === null || !Number.isFinite(pointRate) || pointRate <= 0) return 0;
  const rate = toScaled(pointRate);
  return includesBase ? Math.max(rate - MULTIPLIER_SCALE, 0) : rate;
}

/** 포인트 분해(F-SO-22·23). 기대값: ¥12,000·10배·쿠폰 0 → base 10,909 → 109 + 981 = 1,090pt */
export function pointsOf(input: {
  representativePriceYen: number;
  couponYen: number;
  /** API pointRate(배, 정수). null = 모름 → 상품 추가분 0 */
  pointRate: number | null;
  /** 샵·이벤트 배율(배, 행별 오너 입력) */
  shopEventMultiplier: number | string | { toString(): string };
  settings: PointSettings;
}): PointBreakdown {
  const net = Math.max(input.representativePriceYen - input.couponYen, 0);
  const base = floorDiv(net * 10, 11);
  const rates = {
    base: MULTIPLIER_SCALE,
    item: itemMultiplierScaled(input.pointRate, input.settings.pointRateIncludesBase),
    shopEvent: toScaled(input.shopEventMultiplier),
    spu: toScaled(input.settings.spuMultiplier),
  };
  const sum = rates.base + rates.item + rates.shopEvent + rates.spu;
  // 프로그램별: floor(base × r / 100), r = scaled / 10000
  const perProgram = (scaled: number) => floorDiv(base * scaled, 100 * MULTIPLIER_SCALE);
  // 단순식(분해 표시용 조각): floor((가격 − 쿠폰) × r / 110)
  const simplePart = (scaled: number) => floorDiv(net * scaled, 110 * MULTIPLIER_SCALE);
  const part = input.settings.rounding === 'SIMPLE' ? simplePart : perProgram;
  const pieces = {
    pointsBasePt: part(rates.base),
    pointsItemPt: part(rates.item),
    pointsShopEventPt: part(rates.shopEvent),
    pointsSpuPt: part(rates.spu),
  };
  const total =
    input.settings.rounding === 'SIMPLE'
      ? simplePart(sum)
      : pieces.pointsBasePt + pieces.pointsItemPt + pieces.pointsShopEventPt + pieces.pointsSpuPt;
  return {
    pointBaseAmountYen: base,
    ...pieces,
    pointsTotalPt: total,
    totalMultiplierScaled: sum,
  };
}

/**
 * 실질가(F-SO-22, 순위용). = SKU가_대표 + 송료 − 쿠폰 − floor(포인트 × k_rank). k_rank는 0~1(×10000 정수로 계산).
 * 샵 A: 12,000 + 0 − 0 − floor(1,090 × 0.5) = 11,455. 샵 B: 11,800 + 800 − 0 − floor(536 × 0.5) = 12,332
 */
export function effectivePriceOf(input: {
  representativePriceYen: number;
  shippingYen: number;
  couponYen: number;
  pointsTotalPt: number;
  kRank: number;
}): number {
  const pointValue = floorDiv(input.pointsTotalPt * toScaled(input.kRank), MULTIPLIER_SCALE);
  return input.representativePriceYen + input.shippingYen - input.couponYen - pointValue;
}
