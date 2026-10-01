import type {
  PricingJudgementView,
  PricingOutputReader,
  PricingSaleSizesView,
} from '../step-engine/ports/step-output-readers.port.js';
import type { Db } from '../step-engine/candidates/step-engine-tx.js';

/**
 * ③ 판정 읽기(P3-04 Proposed — step-engine 창구 `StepEngineApi.readPricingSaleSizes`, C4 §3.1). ⑥-3이 판매 사이즈(시작 조건
 * '③ 판매 사이즈 집합')를 읽는다. 판매 사이즈 = 그 판정의 `price_judgement_size.is_sellable` 사이즈(mm 오름차순). 판정가는
 * PR-07(모드 A 판매가 구성)을 켤 때만 읽는데 M1은 켜는 설정이 없어 넣지 않는다.
 */
export async function readPricingSaleSizes(
  db: Db,
  pricingStepRunId: number,
): Promise<PricingSaleSizesView | null> {
  const row = await db.priceJudgement.findUnique({
    where: { stepRunId: pricingStepRunId },
    select: {
      sizes: { where: { isSellable: true }, select: { sizeMm: true }, orderBy: { sizeMm: 'asc' } },
    },
  });
  if (!row) return null;
  return { pricingStepRunId, saleSizesMm: row.sizes.map((size) => size.sizeMm) };
}

function decimalNumber(value: { toString(): string } | null): number | null {
  return value === null ? null : Number(value.toString());
}

/**
 * ③ 판정 스냅샷 전체(P4-02 — step-engine 창구 `StepEngineApi.readPricingJudgement`). 최종 승인 미리보기의 마진 분해·요청 초안의
 * 판매가·옵션가와 사전 검증 `NEGATIVE_MARGIN`(모드 A·B 이익)·`JUDGEMENT_FRESHNESS`(판정에 쓴 페이지 수집 시각)가 읽는다. 열 뜻은
 * 바꾸지 않는다(ERD `price_judgement`·`price_judgement_size`). 목표 마진은 numeric 원문 글자로 준다(정확한 비교 — 부르는 쪽이
 * 정수 비율로 바꾼다). 판정이 없으면 null.
 */
export async function readPricingJudgement(
  db: Db,
  pricingStepRunId: number,
): Promise<PricingJudgementView | null> {
  const row = await db.priceJudgement.findUnique({
    where: { stepRunId: pricingStepRunId },
    include: { sizes: { orderBy: { sizeMm: 'asc' } } },
  });
  if (!row) return null;
  return {
    priceJudgementId: row.id,
    pricingStepRunId,
    rakutenItemId: row.rakutenItemId,
    rakutenPageCollectedAt: row.rakutenPageCollectedAt,
    judgedAt: row.judgedAt,
    isSaleCandidate: row.isSaleCandidate,
    salePriceKrw: row.salePriceKrw,
    couponYen: row.couponYen,
    shippingYen: row.shippingYen,
    shippingEstimated: row.shippingEstimated,
    cShipIntlKrw: row.cShipIntlKrw,
    cFwdKrw: row.cFwdKrw,
    fwdCouponKrw: row.fwdCouponKrw,
    fwdAssumed: row.fwdAssumed,
    vatMode: row.vatMode,
    pricingRule: row.pricingRule,
    targetMarginRate: row.targetMarginRate.toString(),
    minProfitKrw: row.minProfitKrw,
    sizes: row.sizes.map((size) => ({
      sizeMm: size.sizeMm,
      rakutenSkuId: size.rakutenSkuId,
      skuPriceYen: size.skuPriceYen,
      cGoodsKrw: size.cGoodsKrw,
      vUsd: Number(size.vUsd.toString()),
      isDutyFree: size.isDutyFree,
      isBoundary: size.isBoundary,
      cTaxKrw: size.cTaxKrw,
      pMinKrw: size.pMinKrw,
      optionPriceKrw: size.optionPriceKrw,
      sizeSalePriceKrw: size.sizeSalePriceKrw,
      cMktKrw: size.cMktKrw,
      vatAKrw: size.vatAKrw,
      vatBKrw: size.vatBKrw,
      profitAKrw: size.profitAKrw,
      profitBKrw: size.profitBKrw,
      marginRateA: decimalNumber(size.marginRateA),
      isSellable: size.isSellable,
      unsellableReason: size.unsellableReason,
    })),
  };
}

export const pricingOutputReader: PricingOutputReader = {
  readSaleSizes: readPricingSaleSizes,
  readJudgement: readPricingJudgement,
};
