import type {
  RakutenItem,
  SourcingComparison,
  SourcingComparisonRow,
  StepRun,
} from '../../generated/prisma/client.js';

/** 라쿠텐 크레딧 문구(F-SO-30, 05-2 SourcingComparisonDetail.creditText) */
export const RAKUTEN_CREDIT_TEXT = 'Supported by Rakuten Developers';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const num = (d: { toNumber(): number } | null): number | null => (d === null ? null : d.toNumber());

type RowWithItem = SourcingComparisonRow & {
  rakutenItem: Pick<RakutenItem, 'collectedAt' | 'saleStartsAt' | 'saleEndsAt'> | null;
};

/** 비교표 한 행 → 05-2 SourcingComparisonRow(M2 칸 coupon*·riskFlags는 null·빈 배열) */
export function toComparisonRow(row: RowWithItem) {
  return {
    id: row.id,
    sourcingComparisonId: row.sourcingComparisonId,
    rowSource: row.rowSource,
    searchRank: row.searchRank,
    itemCode: row.itemCode,
    shopCode: row.shopCode,
    shopName: row.shopName,
    itemName: row.itemName,
    itemUrl: row.itemUrl,
    imageUrl: row.imageUrl,
    apiItemPriceYen: row.apiItemPriceYen,
    apiItemPriceMin3Yen: row.apiItemPriceMin3Yen,
    apiPointRate: row.apiPointRate,
    apiPostageFlag: row.apiPostageFlag,
    reviewCount: row.reviewCount,
    reviewAverage: num(row.reviewAverage),
    shipOverseas: row.shipOverseas,
    apiCollectedAt: iso(row.apiCollectedAt),
    rakutenPageCollectedAt: iso(row.rakutenItem?.collectedAt),
    modelCodeNorm: row.modelCodeNorm,
    colorCode: row.colorCode,
    anchorMatch: row.anchorMatch,
    janMatch: row.janMatch,
    makerModelMatch: row.makerModelMatch,
    aiMatch: row.aiMatch ?? null,
    ownerMatchDecision: row.ownerMatchDecision,
    fetchOrder: row.fetchOrder,
    isVerified: row.isVerified,
    rakutenItemId: row.rakutenItemId,
    manualCheckRequired: row.manualCheckRequired,
    manualCheckReason: row.manualCheckReason,
    inStockSizeCount: row.inStockSizeCount,
    stockPass: row.stockPass,
    representativeRakutenSkuId: row.representativeRakutenSkuId,
    representativePriceYen: row.representativePriceYen,
    shippingYen: row.shippingYen,
    shippingSource: row.shippingSource,
    couponYen: row.couponYen,
    shopEventMultiplier: row.shopEventMultiplier.toNumber(),
    pointBaseAmountYen: row.pointBaseAmountYen,
    pointsBasePt: row.pointsBasePt,
    pointsItemPt: row.pointsItemPt,
    pointsShopEventPt: row.pointsShopEventPt,
    pointsSpuPt: row.pointsSpuPt,
    pointsTotalPt: row.pointsTotalPt,
    effectivePriceYen: row.effectivePriceYen,
    isSelected: row.isSelected,
    saleStartsAt: iso(row.rakutenItem?.saleStartsAt),
    saleEndsAt: iso(row.rakutenItem?.saleEndsAt),
    couponPercent: null,
    couponMinAmountYen: null,
    couponCombinable: null,
    couponPageUrl: null,
    riskFlags: [] as string[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type ComparisonSortField = 'effectivePriceYen' | 'searchRank' | 'fetchOrder';
export interface ComparisonSort {
  field: ComparisonSortField;
  direction: 'asc' | 'desc';
}

/**
 * 행 정렬(05-2 getSourcingComparison): 미검증 행은 늘 뒤, 실질가 순이면 재고 통과 행 먼저, 값이 없는 행은 그 안에서 뒤,
 * 같으면 검색 순위(수동 행은 뒤) → id(P2-03 Proposed — ranking.ts `compareByEffectivePrice`와 같은 규칙)
 */
export function sortRows<
  R extends { id: number; isVerified: boolean; stockPass: boolean | null } & Record<
    ComparisonSortField,
    number | null
  >,
>(rows: readonly R[], sort: readonly ComparisonSort[]): R[] {
  const keys = sort.length > 0 ? sort : [{ field: 'effectivePriceYen', direction: 'asc' } as const];
  const byPrice = keys[0]?.field === 'effectivePriceYen';
  return [...rows].sort((a, b) => {
    if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
    // 실질가 순이면 재고 통과 행이 먼저(재고 부족 샵은 순위에서 뺀다 — ranking.ts와 같다)
    if (byPrice && (a.stockPass === true) !== (b.stockPass === true)) {
      return a.stockPass === true ? -1 : 1;
    }
    for (const key of keys) {
      const av = a[key.field];
      const bv = b[key.field];
      if (av === bv) continue;
      if (av === null) return 1;
      if (bv === null) return -1;
      return key.direction === 'asc' ? av - bv : bv - av;
    }
    if (a.searchRank !== b.searchRank) {
      if (a.searchRank === null) return 1;
      if (b.searchRank === null) return -1;
      return a.searchRank - b.searchRank;
    }
    return a.id - b.id;
  });
}

/** 머리 행 + 행 → 05-2 SourcingComparisonDetail */
export function toComparisonDetail(input: {
  head: SourcingComparison;
  run: StepRun;
  isCurrent: boolean;
  rows: RowWithItem[];
}) {
  const { head, run } = input;
  return {
    id: head.id,
    stepRunId: head.stepRunId,
    candidateId: run.candidateId,
    version: run.version,
    stepStatus: run.status,
    isCurrent: input.isCurrent,
    baseSourcingComparisonId: head.baseSourcingComparisonId,
    action: head.action,
    searchKeyword: head.searchKeyword,
    sourceUrl: head.sourceUrl,
    anchorInputMethod: head.anchorInputMethod,
    anchorItemCode: head.anchorItemCode,
    anchorModelCode: head.anchorModelCode,
    anchorModelCodeNorm: head.anchorModelCodeNorm,
    anchorColorCode: head.anchorColorCode,
    anchorColorLabel: head.anchorColorLabel,
    exploreMode: head.anchorInputMethod === null,
    comparisonPerformed: head.comparisonPerformed,
    selectedRakutenItemId: head.selectedRakutenItemId,
    shippingYen: head.shippingYen,
    shippingSource: head.shippingSource,
    detectedGender: head.detectedGender,
    genderBasis: head.genderBasis,
    ownerGender: head.ownerGender,
    childSizeSuspect: head.childSizeSuspect,
    genreScope: head.genreScope,
    adultProductConfirmedAt: iso(head.adultProductConfirmedAt),
    params: (head.params ?? {}) as Record<string, unknown>,
    creditText: RAKUTEN_CREDIT_TEXT,
    rows: input.rows.map(toComparisonRow),
    createdAt: head.createdAt.toISOString(),
    updatedAt: head.updatedAt.toISOString(),
  };
}
