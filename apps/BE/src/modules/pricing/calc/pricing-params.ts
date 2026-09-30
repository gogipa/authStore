import type {
  AppSettings,
  DutyHsHeading,
  NpayFeeGrade,
  PriceRuleMethod,
  VatMode,
} from '../../settings/schema/settings.types.js';

/**
 * 설정 스냅샷(P1-03 `AppSettings`) → ③ 판정 계산 파라미터(P2-05 §5 `calc/pricing-params.ts`). 이 값을 그대로
 * `price_judgement.params`(jsonb)에 넣는다 — '적용 기준값 사본'(PR-06·F-PJ-21). 열로 뺀 값(vat_mode·pricing_rule·
 * target_margin_rate·min_profit_krw)도 같은 값이다. 비율은 설정 표기 그대로 퍼센트 수(2.5 = 2.5%)다.
 */

/** DB 가격 책정 규칙 코드(ck_pj_pricing_rule) */
export type PricingRuleCode =
  'REF_MINUS_1PCT' | 'REF_MINUS_100' | 'MAX_SKU_SINGLE' | 'OPTION_PRICE';

/**
 * 설정 `priceRule.method` → DB `pricing_rule`(Proposed): REF_DISCOUNT(국내가 × (1 − refDiscountPct%) 100원 내림)은
 * REF_MINUS_1PCT로 저장하고 할인율은 params.refDiscountPct에 남긴다(기본 1%).
 */
export const PRICING_RULE_OF: Readonly<Record<PriceRuleMethod, PricingRuleCode>> = {
  REF_DISCOUNT: 'REF_MINUS_1PCT',
  REF_MINUS_100: 'REF_MINUS_100',
  MAX_SKU_SINGLE: 'MAX_SKU_SINGLE',
  OPTION_PRICE: 'OPTION_PRICE',
};

/** '경계' 배지 범위: 면세 기준 150달러 ±5%(F-PJ-11) */
export const BOUNDARY_PCT = 5;

export interface PricingParams {
  /** 카드 가산율 k_card(%) */
  cardSurchargePct: number;
  /** 판매수수료 r_sale(%) */
  saleFeePct: number;
  /** 판매수수료가 배송비에도 붙는지(고객 배송비 0이라 M1 계산에는 영향 없음 — 기록용) */
  saleFeeIncludesShipping: boolean;
  /** Npay 수수료 등급과 그 율 r_order(%) */
  npayFeeGrade: NpayFeeGrade;
  npayFeePct: number;
  /** 기타비용 C_misc(원) */
  miscCostKrw: number;
  /** 목표 마진 m(%) */
  targetMarginPct: number;
  /** 최소 이익 Π_min(원) */
  minProfitKrw: number;
  /** 판정 여유 δ_judge(%) */
  judgementMarginPct: number;
  /** 반올림 단위(원, 100) */
  roundingUnitKrw: number;
  /** 판정용 포인트 환산 k_margin(0~1, 기본 0) */
  pointValueFactorForMargin: number;
  /** 셀러 부가세 모드(최소 판매가·순이익). 모드 B 게이트는 모드와 관계없이 적용 */
  vatMode: VatMode;
  /** 면세 기준·안전 버퍼(달러) */
  dutyFreeLimitUsd: number;
  dutyFreeBufferUsd: number;
  /** '경계' 배지 범위(±%) */
  boundaryPct: number;
  /** 요금표가 없을 때 배대지 비용(원) */
  defaultForwarderFeeKrw: number;
  /** 신발 박스 기본값 */
  shoeBox: { lengthCm: number; widthCm: number; heightCm: number; weightKg: number };
  /** 검수·포장비(Proposed) */
  forwarderHandlingFee: { included: boolean; amountKrw: number };
  /** 관세에 쓴 HS 4단위와 세율(%) */
  dutyHsHeading: DutyHsHeading;
  dutyRatePct: number;
  /** FTA·RCEP 협정세율(M1 쓰지 않음 — 기록용) */
  applyFtaRates: boolean;
  simplifiedDuty: { enabled: boolean; ratePct: number };
  /** 설정 가격 책정 규칙과 DB 코드 */
  priceRuleMethod: PriceRuleMethod;
  pricingRule: PricingRuleCode;
  refDiscountPct: number;
  /** 과세 사이즈도 판다(F-ST-02, 기본 false = 면세만) */
  sellTaxableSizes: boolean;
  /** 판매 후보가 되는 최소 판매 가능 사이즈 수(RK-05, 기본 3) */
  minSizeCount: number;
  /** 셀러라이프 배대지 쿠폰(F-ST-05) */
  sellerlifeCoupon: { enabled: boolean; amountKrw: number; monthlyLimit: number };
}

export function pricingParamsOf(settings: Readonly<AppSettings>): PricingParams {
  const c = settings.costs;
  const p = settings.pricing;
  return {
    cardSurchargePct: c.cardSurchargePct,
    saleFeePct: c.saleFeePct,
    saleFeeIncludesShipping: c.saleFeeIncludesShipping,
    npayFeeGrade: c.npayFeeGrade,
    npayFeePct: c.npayFeePctByGrade[c.npayFeeGrade],
    miscCostKrw: c.miscCostKrw,
    targetMarginPct: c.targetMarginPct,
    minProfitKrw: c.minProfitKrw,
    judgementMarginPct: c.judgementMarginPct,
    roundingUnitKrw: c.roundingUnitKrw,
    pointValueFactorForMargin: c.pointValueFactorForMargin,
    vatMode: c.vatMode,
    dutyFreeLimitUsd: p.dutyFreeLimitUsd,
    dutyFreeBufferUsd: p.dutyFreeBufferUsd,
    boundaryPct: BOUNDARY_PCT,
    defaultForwarderFeeKrw: p.defaultForwarderFeeKrw,
    shoeBox: { ...p.shoeBox },
    forwarderHandlingFee: { ...p.forwarderHandlingFee },
    dutyHsHeading: p.dutyHsHeading,
    dutyRatePct: p.dutyRatePctByHsHeading[p.dutyHsHeading],
    applyFtaRates: p.applyFtaRates,
    simplifiedDuty: { ...p.simplifiedDuty },
    priceRuleMethod: p.priceRule.method,
    pricingRule: PRICING_RULE_OF[p.priceRule.method],
    refDiscountPct: p.priceRule.refDiscountPct,
    sellTaxableSizes: p.sellTaxableSizes,
    minSizeCount: settings.sourcing.minSizeCount,
    sellerlifeCoupon: { ...c.sellerlifeCoupon },
  };
}
