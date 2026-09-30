import { type AnchorKey, recheckWithPage } from './anchor-match.js';
import { effectivePriceOf, pointsOf, shippingOf } from './effective-price.js';
import type { ComparisonParams } from './sourcing-output.js';
import { judgeStock, skusOfColor, type StockJudgement, type StockSku } from './stock-judgement.js';

/**
 * 비교표 행 하나의 재고·송료·포인트·실질가·재대조(P2-03 규칙 4·6·8~10). 순수 함수 — 페이지 스냅샷(SKU)과 행의 오너 입력(쿠폰·
 * 배율), 버전의 설정 사본(params)으로 DB에 쓸 값을 만든다. 성별을 모르면 재고·실질가는 NULL(성별 입력 대기).
 */

export interface RowCalcRow {
  apiPostageFlag: number | null;
  apiPointRate: number | null;
  couponYen: number;
  shopEventMultiplier: number | string | { toString(): string };
}

export interface RowCalcSnapshot {
  backOrderFlag: boolean | null;
  modelCodeNorm: string | null;
  skus: readonly StockSku[];
}

export interface RowCalcContext {
  anchor: AnchorKey & { colorLabel: string | null };
  /** 앵커 상품 페이지의 앵커 색상 JAN(모르면 null) */
  anchorJans: readonly string[] | null;
  gender: 'MALE' | 'FEMALE' | null;
  params: ComparisonParams;
}

/** 행에 쓰는 계산 값(sourcing_comparison_row 열 이름 그대로) */
export interface RowCalcData {
  inStockSizeCount: number | null;
  stockPass: boolean | null;
  representativeRakutenSkuId: number | null;
  representativePriceYen: number | null;
  shippingYen: number | null;
  shippingSource: 'FREE' | 'DEFAULT_ESTIMATE' | null;
  pointBaseAmountYen: number | null;
  pointsBasePt: number | null;
  pointsItemPt: number | null;
  pointsShopEventPt: number | null;
  pointsSpuPt: number | null;
  pointsTotalPt: number | null;
  effectivePriceYen: number | null;
}

export const EMPTY_CALC: RowCalcData = {
  inStockSizeCount: null,
  stockPass: null,
  representativeRakutenSkuId: null,
  representativePriceYen: null,
  shippingYen: null,
  shippingSource: null,
  pointBaseAmountYen: null,
  pointsBasePt: null,
  pointsItemPt: null,
  pointsShopEventPt: null,
  pointsSpuPt: null,
  pointsTotalPt: null,
  effectivePriceYen: null,
};

/** 포인트·실질가만(PATCH 쿠폰·배율 — 대표 SKU가·송료는 그대로) */
export function pricingOf(
  row: RowCalcRow & {
    representativePriceYen: number | null;
    shippingYen: number | null;
  },
  params: ComparisonParams,
): Pick<
  RowCalcData,
  | 'pointBaseAmountYen'
  | 'pointsBasePt'
  | 'pointsItemPt'
  | 'pointsShopEventPt'
  | 'pointsSpuPt'
  | 'pointsTotalPt'
  | 'effectivePriceYen'
> {
  if (row.representativePriceYen === null || row.shippingYen === null) {
    return {
      pointBaseAmountYen: null,
      pointsBasePt: null,
      pointsItemPt: null,
      pointsShopEventPt: null,
      pointsSpuPt: null,
      pointsTotalPt: null,
      effectivePriceYen: null,
    };
  }
  const points = pointsOf({
    representativePriceYen: row.representativePriceYen,
    couponYen: row.couponYen,
    pointRate: row.apiPointRate,
    shopEventMultiplier: row.shopEventMultiplier,
    settings: {
      pointRateIncludesBase: params.pointRateIncludesBase,
      rounding: params.pointRounding,
      spuMultiplier: params.spuMultiplier,
    },
  });
  return {
    pointBaseAmountYen: points.pointBaseAmountYen,
    pointsBasePt: points.pointsBasePt,
    pointsItemPt: points.pointsItemPt,
    pointsShopEventPt: points.pointsShopEventPt,
    pointsSpuPt: points.pointsSpuPt,
    pointsTotalPt: points.pointsTotalPt,
    effectivePriceYen: effectivePriceOf({
      representativePriceYen: row.representativePriceYen,
      shippingYen: row.shippingYen,
      couponYen: row.couponYen,
      pointsTotalPt: points.pointsTotalPt,
      kRank: params.kRank,
    }),
  };
}

export interface RowCalcResult {
  data: RowCalcData;
  stock: StockJudgement | null;
  janMatch: boolean | null;
  makerModelMatch: boolean | null;
  /** 재고 판정의 수동 확인 사유(cm가 아닌 라벨·앵커 색상 SKU 없음) */
  stockManualCheckReason: string | null;
}

/** 페이지를 읽은 행의 값 전체 */
export function calculateRow(
  row: RowCalcRow,
  snapshot: RowCalcSnapshot,
  ctx: RowCalcContext,
): RowCalcResult {
  const color = { anchorColorCode: ctx.anchor.colorCode, anchorColorLabel: ctx.anchor.colorLabel };
  const stock = judgeStock({
    skus: snapshot.skus,
    itemBackOrderFlag: snapshot.backOrderFlag,
    color,
    gender: ctx.gender,
    rules: {
      targetSizeMm: ctx.params.targetSizeMm,
      minSizeCount: ctx.params.minSizeCount,
      defaultWidth: ctx.params.defaultWidth,
      excludeBackOrder: ctx.params.excludeBackOrder,
    },
  });
  const colorSkus = stock?.colorSkus ?? skusOfColor(snapshot.skus, color);
  const recheck = recheckWithPage({
    anchor: ctx.anchor,
    anchorJans: ctx.anchorJans,
    rowJans: colorSkus.map((s) => s.articleNumber ?? '').filter((j) => j !== ''),
    pageModelCodeNorm: snapshot.modelCodeNorm,
  });
  const rep = stock?.representative ?? null;
  const allColorFree = colorSkus.length > 0 && colorSkus.every((s) => s.postageIncluded === true);
  const shipping = shippingOf({
    apiPostageFlag: row.apiPostageFlag,
    postageIncluded: rep ? rep.postageIncluded : allColorFree,
    defaultShippingYen: ctx.params.defaultShippingYen,
  });
  const representativePriceYen = rep?.taxIncludedPriceYen ?? null;
  const pricing = pricingOf(
    { ...row, representativePriceYen, shippingYen: shipping.shippingYen },
    ctx.params,
  );
  return {
    data: {
      inStockSizeCount: stock?.inStockSizeCount ?? null,
      stockPass: stock?.stockPass ?? null,
      representativeRakutenSkuId: rep?.id ?? null,
      representativePriceYen,
      shippingYen: shipping.shippingYen,
      shippingSource: shipping.shippingSource,
      ...pricing,
    },
    stock,
    janMatch: recheck.janMatch,
    makerModelMatch: recheck.makerModelMatch,
    stockManualCheckReason: stock?.manualCheckReason ?? null,
  };
}

/** 앵커 상품 페이지에서 앵커 색상 SKU의 JAN(JAN 재대조 기준) */
export function anchorJansOf(
  skus: readonly StockSku[],
  anchor: { colorCode: string | null; colorLabel: string | null },
): string[] {
  return skusOfColor(skus, {
    anchorColorCode: anchor.colorCode,
    anchorColorLabel: anchor.colorLabel,
  })
    .map((s) => (s.articleNumber ?? '').trim())
    .filter((j) => j !== '');
}
