import { forwarderCost, type ForwarderCost, type RateTableInput } from './chargeable-weight.js';
import {
  ceilUnit,
  dec,
  Decimal,
  floorUnit,
  pctRate,
  roundTo,
  roundWon,
  type Money,
} from './money.js';
import type { PricingParams, PricingRuleCode } from './pricing-params.js';

/**
 * ③ 가격·마진 판정 순수 함수(PRD §8.3 1)~11), P2-05 규칙 3~11). DB·Nest를 모른다. 사이즈 i마다(재고 있는 목표 사이즈):
 * 1) 상품원가 C_goods_i = (Y_item_i + Y_ship − Coupon) × FX_base × (1 + k_card)  — 쿠폰은 여기만
 * 2) 면세 V_usd_i = (Y_item_i + Y_ship) × FX_cJPY / FX_cUSD(쿠폰 전, 국제운임 빼고) ≤ 150 − 5 → 면세.
 *    2 × V_usd > 145 → '2켤레 주문 시 과세 전환', 150 ±5% → '경계'. 면세 경계 엔화 = floor(145 × FX_cUSD / FX_cJPY)
 * 3) 과세면 CV = (Y_item + Y_ship) × FX_cJPY + C_ship_intl, C_tax = CV × t + (CV + CV × t) × 10%(간이세율이면 CV × 18%)
 * 4)~6) C_mkt = P × r_sale + P × r_order, 부가세 A·B·C, Π(P) = P − C_goods − C_fwd − C_tax − C_mkt − VAT − C_misc
 * 7) P_min = Π(P) ≥ max(m × P, Π_min)인 가장 작은 P(이분 탐색) → 100원 올림
 * 8) 판매 가능 ⇔ P_min ≤ P_ref × (1 − δ). 과세 사이즈는 과세 판매 설정이 꺼져 있으면(M1 기본) TAXABLE로 뺀다
 * 9) 판매가(가격 책정 규칙) 10) 모드 B 게이트(Π_B(사이즈별 판매가) < 0 → MODE_B_NEGATIVE, 빠지면 9부터 다시)
 * 11) 판매 가능 사이즈 수 ≥ 최소 기준 → 판매 후보, 아니면 제외 사유
 * 원 단위 반올림은 항목마다(half-up, money.ts `roundWon`) 한다(Proposed — PRD 예시와 1원까지 맞는다).
 */

export interface JudgeSizeInput {
  sizeMm: number;
  rakutenSkuId: number | null;
  /** Y_item_i(SKU taxIncludedPrice, 쿠폰 전) */
  skuPriceYen: number;
}

export interface PriceJudgementInput {
  sizes: readonly JudgeSizeInput[];
  /** Y_ship(엔) */
  shippingYen: number;
  /** Coupon(엔, 0 이상) */
  couponYen: number;
  /** 계산용 환율(원/엔·원/달러, P2-04 `perUnit`) */
  fx: { costPerUnit: Money; customsJpyPerUnit: Money; customsUsdPerUnit: Money };
  /** 활성 요금표(없으면 null → 기본 배대지비 가정값) */
  forwarder: RateTableInput | null;
  /** 적용할 셀러라이프 배대지 쿠폰(원, 부르는 쪽이 월 한도를 보고 정한다). 없으면 0 */
  fwdCouponKrw?: number;
  /** 국내 기준가 P_ref(판매가 + 고객 배송비 총액, 원) */
  pRefKrw: number;
  /** 포인트 참고치(pt, ② 고른 행). 없으면 null */
  pointsPt?: number | null;
  params: PricingParams;
}

export type UnsellableReason = 'TAXABLE' | 'P_MIN_OVER_REF' | 'MODE_B_NEGATIVE';

/** 판매가 P에서의 수수료·부가세·순이익 */
export interface ProfitBreakdown {
  priceKrw: number;
  /** 판매수수료 P × r_sale */
  saleFeeKrw: number;
  /** Npay 수수료 P × r_order */
  npayFeeKrw: number;
  /** C_mkt = 판매수수료 + Npay 수수료 */
  cMktKrw: number;
  vatAKrw: number;
  vatBKrw: number;
  /** 순이익(모드 A) */
  profitAKrw: number;
  /** 순이익(모드 B, 안전 게이트) */
  profitBKrw: number;
  /** 설정 부가세 모드의 순이익(최소 판매가 기준) */
  profitKrw: number;
  /** 마진율(모드 A, 소수 넷째 자리) */
  marginRateA: Decimal;
}

export interface JudgedSize {
  sizeMm: number;
  rakutenSkuId: number | null;
  skuPriceYen: number;
  /** 물품가(원) = (Y_item + Y_ship − Coupon) × FX_base — 화면 '물품가' 줄 */
  goodsBaseKrw: number;
  /** 카드 가산(원) = C_goods − 물품가 */
  cardSurchargeKrw: number;
  cGoodsKrw: number;
  /** V_usd(소수 둘째 자리) */
  vUsd: Decimal;
  isDutyFree: boolean;
  twoPairTaxable: boolean;
  isBoundary: boolean;
  /** 과세가격 CV(과세일 때만) */
  customsValueKrw: number | null;
  /** 관세·수입 부가세(과세일 때만, 간이세율이면 관세 칸에 합계) */
  dutyKrw: number;
  importVatKrw: number;
  cTaxKrw: number;
  pMinKrw: number | null;
  optionPriceKrw: number;
  /** 사이즈별 판매가 = salePrice + 옵션가(판매 가능이면 필수. 모드 B로 빠진 사이즈는 빠질 때 본 가격) */
  sizeSalePriceKrw: number | null;
  /** 사이즈별 판매가에서의 비용 분해(판매가가 없으면 null) */
  breakdown: ProfitBreakdown | null;
  pointsReferencePt: number | null;
  isSellable: boolean;
  unsellableReason: UnsellableReason | null;
}

export interface PriceJudgementResult {
  forwarder: ForwarderCost;
  /** 면세 판정 기준(달러) = 한도 − 버퍼(145) */
  dutyFreeThresholdUsd: number;
  /** 면세가 끝나는 엔화 경계값 floor(145 × FX_cUSD / FX_cJPY)(내림은 Proposed) */
  dutyFreeLimitYen: number;
  sizes: JudgedSize[];
  salePriceKrw: number | null;
  sellableSizeCount: number;
  isSaleCandidate: boolean;
  exclusionReason: string | null;
  pricingRule: PricingRuleCode;
  /** 9)~10) 반복 횟수(모드 B 게이트로 빠진 사이즈가 있으면 2 이상) */
  gateRounds: number;
}

/** 이분 탐색 상한(원). 이 값에서도 조건을 못 맞추면 P_min 없음(판매 불가) */
export const P_SEARCH_MAX_KRW = 1_000_000_000;

/** 사이즈 한 칸의 고정 비용(판매가와 무관) */
export interface SizeCosts {
  cGoodsKrw: number;
  cFwdKrw: number;
  cTaxKrw: number;
}

/** 판매가에 곱하는 율·기준값 */
export interface Rates {
  saleFee: Decimal;
  npayFee: Decimal;
  margin: Decimal;
  minProfit: number;
  misc: number;
  pointsValueKrw: number;
  vatMode: PricingParams['vatMode'];
}

/** 4)~6): 판매가 P에서의 수수료·부가세·순이익(고객 배송비 0 — 무료배송 전제 RG-07) */
export function profitAt(priceKrw: number, costs: SizeCosts, rates: Rates): ProfitBreakdown {
  const saleFeeKrw = roundWon(dec(priceKrw).mul(rates.saleFee));
  const npayFeeKrw = roundWon(dec(priceKrw).mul(rates.npayFee));
  const cMktKrw = saleFeeKrw + npayFeeKrw;
  const base = priceKrw - costs.cGoodsKrw - costs.cFwdKrw - costs.cTaxKrw;
  // 모드 A: (P − C_goods − C_fwd − C_tax)/11 − C_mkt/11, 모드 B: P/11 − C_mkt/11(공제 가능 매입세액 = 수수료분)
  const vatAKrw = roundWon(dec(base - cMktKrw).div(11));
  const vatBKrw = roundWon(dec(priceKrw - cMktKrw).div(11));
  const profitAKrw = base - cMktKrw - vatAKrw - rates.misc + rates.pointsValueKrw;
  const profitBKrw = base - cMktKrw - vatBKrw - rates.misc;
  const profitCKrw = base - cMktKrw - rates.misc + rates.pointsValueKrw;
  const profitKrw =
    rates.vatMode === 'A' ? profitAKrw : rates.vatMode === 'B' ? profitBKrw : profitCKrw;
  return {
    priceKrw,
    saleFeeKrw,
    npayFeeKrw,
    cMktKrw,
    vatAKrw,
    vatBKrw,
    profitAKrw,
    profitBKrw,
    profitKrw,
    marginRateA: priceKrw > 0 ? roundTo(dec(profitAKrw).div(priceKrw), 4) : new Decimal(0),
  };
}

/** 7)의 조건: Π(P) ≥ max(m × P, Π_min) */
function meetsTarget(priceKrw: number, costs: SizeCosts, rates: Rates): boolean {
  const profit = profitAt(priceKrw, costs, rates).profitKrw;
  const target = Decimal.max(dec(priceKrw).mul(rates.margin), rates.minProfit);
  return dec(profit).gte(target);
}

/** 7) 최소 판매가: 조건을 만족하는 가장 작은 P(이분 탐색) → 반올림 단위로 올림. 못 찾으면 null */
export function minimumPriceOf(costs: SizeCosts, rates: Rates, unit: number): number | null {
  if (!meetsTarget(P_SEARCH_MAX_KRW, costs, rates)) return null;
  let lo = 1;
  let hi = P_SEARCH_MAX_KRW;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (meetsTarget(mid, costs, rates)) hi = mid;
    else lo = mid + 1;
  }
  // 원 단위 반올림 때문에 조건이 완전한 단조가 아닐 수 있어 올린 값을 다시 확인한다
  let price = ceilUnit(lo, unit);
  while (!meetsTarget(price, costs, rates)) {
    price += unit;
    if (price > P_SEARCH_MAX_KRW) return null;
  }
  return price;
}

interface Pricing {
  salePriceKrw: number;
  optionOf(sizeMm: number): number;
}

/** 9) 가격 책정 규칙(판매 가능 사이즈 집합으로) */
export function applyPriceRule(
  sellable: readonly { sizeMm: number; pMinKrw: number }[],
  pRefKrw: number,
  params: PricingParams,
): Pricing {
  const unit = params.roundingUnitKrw;
  const pMins = sellable.map((s) => s.pMinKrw);
  const maxPMin = Math.max(...pMins);
  const minPMin = Math.min(...pMins);
  const single = (salePriceKrw: number): Pricing => ({ salePriceKrw, optionOf: () => 0 });
  switch (params.pricingRule) {
    case 'REF_MINUS_1PCT':
      return single(
        Math.max(
          floorUnit(dec(pRefKrw).mul(new Decimal(1).minus(pctRate(params.refDiscountPct))), unit),
          maxPMin,
        ),
      );
    case 'REF_MINUS_100':
      return single(Math.max(pRefKrw - 100, maxPMin));
    case 'MAX_SKU_SINGLE':
      // '가장 비싼 사이즈 기준 단일가' = 판매 가능 사이즈 P_min 중 가장 큰 값(Proposed 해석)
      return single(maxPMin);
    case 'OPTION_PRICE': {
      const options = new Map(
        sellable.map((s) => [s.sizeMm, ceilUnit(Math.max(0, s.pMinKrw - minPMin), unit)]),
      );
      return { salePriceKrw: minPMin, optionOf: (mm) => options.get(mm) ?? 0 };
    }
  }
}

const REASON_LABEL: Record<UnsellableReason, string> = {
  TAXABLE: '과세',
  P_MIN_OVER_REF: '최소 판매가가 국내 기준가를 넘음',
  MODE_B_NEGATIVE: '모드 B 순이익 음수',
};

/** 11) 판매 후보 아님 사유(한국어, 500자 이내) */
export function exclusionReasonOf(sizes: readonly JudgedSize[], minSizeCount: number): string {
  if (sizes.length === 0) return '재고 있는 목표 사이즈가 없어 판정할 수 없습니다.';
  const sellable = sizes.filter((s) => s.isSellable).length;
  const counts = (['TAXABLE', 'P_MIN_OVER_REF', 'MODE_B_NEGATIVE'] as const)
    .map((reason) => ({
      reason,
      n: sizes.filter((s) => s.unsellableReason === reason).length,
    }))
    .filter((c) => c.n > 0)
    .map((c) => `${REASON_LABEL[c.reason]} ${c.n}개`);
  const detail = counts.length > 0 ? ` 판매 불가: ${counts.join(' · ')}.` : '';
  return `판매 가능 사이즈가 ${sellable}개로 최소 기준 ${minSizeCount}개보다 적습니다.${detail}`.slice(
    0,
    500,
  );
}

export function judgePrice(input: PriceJudgementInput): PriceJudgementResult {
  const p = input.params;
  const unit = p.roundingUnitKrw;
  const fxCost = dec(input.fx.costPerUnit);
  const fxCJpy = dec(input.fx.customsJpyPerUnit);
  const fxCUsd = dec(input.fx.customsUsdPerUnit);
  const forwarder = forwarderCost({
    table: input.forwarder,
    box: p.shoeBox,
    fxCostPerUnit: fxCost,
    defaultFeeKrw: p.defaultForwarderFeeKrw,
    handling: p.forwarderHandlingFee,
    couponKrw: input.fwdCouponKrw ?? 0,
  });
  const threshold = dec(p.dutyFreeLimitUsd).minus(p.dutyFreeBufferUsd);
  const boundaryLo = dec(p.dutyFreeLimitUsd).mul(new Decimal(1).minus(pctRate(p.boundaryPct)));
  const boundaryHi = dec(p.dutyFreeLimitUsd).mul(new Decimal(1).plus(pctRate(p.boundaryPct)));
  const dutyFreeLimitYen = threshold.mul(fxCUsd).div(fxCJpy).floor().toNumber();
  const pointsPt = input.pointsPt ?? null;
  const rates: Rates = {
    saleFee: pctRate(p.saleFeePct),
    npayFee: pctRate(p.npayFeePct),
    margin: pctRate(p.targetMarginPct),
    minProfit: p.minProfitKrw,
    misc: p.miscCostKrw,
    // 판정용 포인트 환산(k_margin, 기본 0): 포인트(1pt = ¥1) × k × FX_base. 모드 B 게이트에는 넣지 않는다(보수적)
    pointsValueKrw:
      pointsPt !== null && p.pointValueFactorForMargin > 0
        ? roundWon(dec(pointsPt).mul(p.pointValueFactorForMargin).mul(fxCost))
        : 0,
    vatMode: p.vatMode,
  };
  const pRefLimit = dec(input.pRefKrw).mul(new Decimal(1).minus(pctRate(p.judgementMarginPct)));

  const sizes: (JudgedSize & { costs: SizeCosts })[] = [...input.sizes]
    .sort((a, b) => a.sizeMm - b.sizeMm)
    .map((size) => {
      const itemYen = size.skuPriceYen + input.shippingYen;
      const goodsYen = Math.max(0, itemYen - input.couponYen);
      // 1) 상품원가: 쿠폰은 여기만(면세 판정·과세가격에는 넣지 않는다)
      const goodsBaseKrw = roundWon(dec(goodsYen).mul(fxCost));
      const cGoodsKrw = roundWon(
        dec(goodsYen)
          .mul(fxCost)
          .mul(new Decimal(1).plus(pctRate(p.cardSurchargePct))),
      );
      // 2) 면세 판정(쿠폰 전, 국제운임 빼고)
      const vUsdExact = dec(itemYen).mul(fxCJpy).div(fxCUsd);
      const isDutyFree = vUsdExact.lte(threshold);
      const twoPairTaxable = vUsdExact.mul(2).gt(threshold);
      const isBoundary = vUsdExact.gte(boundaryLo) && vUsdExact.lte(boundaryHi);
      // 3) 관부가세(과세만). CV = (물품가 + 송료) × FX_cJPY + 국제운임(CIF)
      let customsValueKrw: number | null = null;
      let dutyKrw = 0;
      let importVatKrw = 0;
      if (!isDutyFree) {
        customsValueKrw = roundWon(dec(itemYen).mul(fxCJpy)) + forwarder.cShipIntlKrw;
        if (p.simplifiedDuty.enabled) {
          dutyKrw = roundWon(dec(customsValueKrw).mul(pctRate(p.simplifiedDuty.ratePct)));
        } else {
          dutyKrw = roundWon(dec(customsValueKrw).mul(pctRate(p.dutyRatePct)));
          importVatKrw = roundWon(dec(customsValueKrw + dutyKrw).mul(pctRate(10)));
        }
      }
      const cTaxKrw = dutyKrw + importVatKrw;
      const costs: SizeCosts = { cGoodsKrw, cFwdKrw: forwarder.cFwdKrw, cTaxKrw };
      const pMinKrw = minimumPriceOf(costs, rates, unit);
      // 8) 1차 판정
      let unsellableReason: UnsellableReason | null = null;
      if (!isDutyFree && !p.sellTaxableSizes) unsellableReason = 'TAXABLE';
      else if (pMinKrw === null || dec(pMinKrw).gt(pRefLimit)) unsellableReason = 'P_MIN_OVER_REF';
      return {
        sizeMm: size.sizeMm,
        rakutenSkuId: size.rakutenSkuId,
        skuPriceYen: size.skuPriceYen,
        goodsBaseKrw,
        cardSurchargeKrw: cGoodsKrw - goodsBaseKrw,
        cGoodsKrw,
        vUsd: roundTo(vUsdExact, 2),
        isDutyFree,
        twoPairTaxable,
        isBoundary,
        customsValueKrw,
        dutyKrw,
        importVatKrw,
        cTaxKrw,
        pMinKrw,
        optionPriceKrw: 0,
        sizeSalePriceKrw: null,
        breakdown: null,
        pointsReferencePt: pointsPt,
        isSellable: unsellableReason === null,
        unsellableReason,
        costs,
      };
    });

  // 9)~10) 판매가 → 모드 B 게이트. 빠진 사이즈가 있으면 남은 사이즈로 9)부터 다시(더 빠지는 사이즈가 없을 때까지)
  let active = sizes.filter((s) => s.isSellable);
  let pricing: Pricing | null = null;
  let gateRounds = 0;
  while (active.length > 0) {
    gateRounds += 1;
    pricing = applyPriceRule(
      active.map((s) => ({ sizeMm: s.sizeMm, pMinKrw: s.pMinKrw! })),
      input.pRefKrw,
      p,
    );
    const current = pricing;
    const failing = active.filter((s) => {
      const price = current.salePriceKrw + current.optionOf(s.sizeMm);
      return profitAt(price, s.costs, rates).profitBKrw < 0;
    });
    if (failing.length === 0) break;
    for (const s of failing) {
      const option = current.optionOf(s.sizeMm);
      const price = current.salePriceKrw + option;
      s.isSellable = false;
      s.unsellableReason = 'MODE_B_NEGATIVE';
      s.optionPriceKrw = option;
      s.sizeSalePriceKrw = price;
      s.breakdown = profitAt(price, s.costs, rates);
    }
    active = active.filter((s) => s.isSellable);
    pricing = null;
  }
  if (pricing) {
    for (const s of active) {
      const option = pricing.optionOf(s.sizeMm);
      const price = pricing.salePriceKrw + option;
      s.optionPriceKrw = option;
      s.sizeSalePriceKrw = price;
      s.breakdown = profitAt(price, s.costs, rates);
    }
  }

  const judged: JudgedSize[] = sizes.map(({ costs: _costs, ...rest }) => rest);
  const sellableSizeCount = active.length;
  // 11) 최종 판정(ck_pj_sale_sizes: 판매 후보는 판매 가능 사이즈가 1개 이상)
  const isSaleCandidate = sellableSizeCount >= Math.max(1, p.minSizeCount);
  return {
    forwarder,
    dutyFreeThresholdUsd: threshold.toNumber(),
    dutyFreeLimitYen,
    sizes: judged,
    salePriceKrw: pricing && active.length > 0 ? pricing.salePriceKrw : null,
    sellableSizeCount,
    isSaleCandidate,
    exclusionReason: isSaleCandidate ? null : exclusionReasonOf(judged, p.minSizeCount),
    pricingRule: p.pricingRule,
    gateRounds,
  };
}
