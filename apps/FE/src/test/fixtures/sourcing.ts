import type {
  RakutenItemEntryChecks,
  RakutenItemFetchResult,
  RakutenItemSnapshot,
  RakutenQueryValidation,
  RakutenSkuVariant,
  SourcingComparisonDetail,
  SourcingComparisonRow,
} from '@/features/sourcing';

/** ② 소싱 화면 fixture(P2-02). 예시 값은 Sourcing 보드(아식스 젤카야노 14 · 크림/블랙, shop-a:10000123) */
export const RAKUTEN_ITEM_ID = 55;
export const NGKEYWORDS = [
  '中古',
  'インソール',
  '靴紐',
  'シューレース',
  '箱のみ',
  'キッズ',
  'ジュニア',
  'ベビー',
];

/** 검사 결과(05-2 RakutenQueryValidation). 반각 길이는 테스트가 준다 */
export function queryValidation(
  rakutenQuery: string,
  patch: Partial<RakutenQueryValidation> = {},
): RakutenQueryValidation {
  return {
    rakutenQuery,
    valid: true,
    halfWidthLength: 32,
    maxHalfWidthLength: 128,
    violations: [],
    genreId: 558885,
    ngKeywords: NGKEYWORDS,
    ...patch,
  };
}

function sku(
  id: number,
  sizeMm: number,
  colorLabel = 'クリーム×ブラック(108)',
  patch: Partial<RakutenSkuVariant> = {},
): RakutenSkuVariant {
  return {
    id,
    variantId: `v${sizeMm}`,
    colorLabel,
    colorCode: '108',
    sizeLabel: `${sizeMm / 10}cm`,
    sizeMm,
    widthLabel: '2E (標準)',
    taxIncludedPriceYen: 12000,
    quantity: 2,
    hidden: false,
    backOrder: false,
    stockCondition: null,
    articleNumber: null,
    postageIncluded: true,
    singleItemShipping: null,
    selectorValues: [colorLabel, `${sizeMm / 10}cm`, '2E (標準)'],
    attributes: null,
    ...patch,
  };
}

/** 스냅샷 한 건(05-2 RakutenItemSnapshot). 기본 색상 2개 */
export function rakutenItemSnapshot(patch: Partial<RakutenItemSnapshot> = {}): RakutenItemSnapshot {
  return {
    id: RAKUTEN_ITEM_ID,
    itemCode: 'shop-a:10000123',
    shopCode: 'shop-a',
    shopName: '샵 A',
    itemName: 'アシックス ゲルカヤノ14 1201A019-108',
    itemUrl: 'item.rakuten.co.jp/shop-a/asics-1201a019-108/',
    modelCode: '1201A019-108',
    modelCodeNorm: '1201A019108',
    entrySource: 'MANUAL',
    fetchReason: 'URL_ENTRY',
    collectedAt: '2026-09-28T05:02:00.000Z',
    genreId: 208025,
    genreSource: 'PAGE_JSON',
    genrePath: '558885:靴 > 110983:メンズ靴 > 208025:スニーカー',
    productType: null,
    backOrderFlag: false,
    unlimitedInventory: false,
    allSkuSamePrice: true,
    saleStartsAt: null,
    saleEndsAt: null,
    descriptionText: null,
    attributes: null,
    variantSelectors: null,
    imageUrls: [],
    manualCheckRequired: false,
    manualCheckNote: null,
    skus: [sku(1, 250), sku(2, 260), sku(3, 250, 'ホワイト(100)', { colorCode: '100' })],
    ...patch,
  };
}

export function entryChecks(patch: Partial<RakutenItemEntryChecks> = {}): RakutenItemEntryChecks {
  return {
    excludedWords: [],
    genreScope: 'IN_SCOPE',
    childSizeSuspect: false,
    adultConfirmationRequired: false,
    ...patch,
  };
}

/** POST /rakuten-items 201 본문 */
export function rakutenItemFetchResult(
  checks: Partial<RakutenItemEntryChecks> = {},
  item: Partial<RakutenItemSnapshot> = {},
): RakutenItemFetchResult {
  return { rakutenItem: rakutenItemSnapshot(item), checks: entryChecks(checks) };
}

/** ② 비교표 머리 행(05-2 SourcingComparisonDetail). 기본 = URL로 만들기 버전(행 0개) */
export function sourcingComparison(
  patch: Partial<SourcingComparisonDetail> & { candidateId: number },
): SourcingComparisonDetail {
  return {
    id: 31,
    stepRunId: 100,
    version: 1,
    stepStatus: 'COMPLETED',
    isCurrent: true,
    baseSourcingComparisonId: null,
    action: 'URL_CREATE',
    searchKeyword: null,
    sourceUrl: 'item.rakuten.co.jp/shop-a/asics-1201a019-108/',
    anchorInputMethod: 'URL_ITEM',
    anchorItemCode: 'shop-a:10000123',
    anchorModelCode: '1201A019-108',
    anchorModelCodeNorm: '1201A019108',
    anchorColorCode: '108',
    anchorColorLabel: 'クリーム×ブラック(108)',
    exploreMode: false,
    comparisonPerformed: false,
    selectedRakutenItemId: RAKUTEN_ITEM_ID,
    shippingYen: 0,
    shippingSource: 'FREE',
    detectedGender: 'MALE',
    genderBasis: 'GENRE_PATH',
    ownerGender: null,
    childSizeSuspect: false,
    genreScope: 'IN_SCOPE',
    adultProductConfirmedAt: null,
    params: { childShoeMaxSizeMm: 235 },
    creditText: 'Supported by Rakuten Developers',
    rows: [],
    createdAt: '2026-09-28T05:02:00.000Z',
    updatedAt: '2026-09-28T05:02:00.000Z',
    ...patch,
  };
}

// ── P2-03 비교표 ────────────────────────────────────────────────────────────

/** 비교표 한 행(05-2 SourcingComparisonRow). 기본 = 검증된 샵 A(¥12,000 · 10배 · 1,090pt · 실질가 ¥11,455) */
export function comparisonRow(
  id: number,
  patch: Partial<SourcingComparisonRow> = {},
): SourcingComparisonRow {
  return {
    id,
    sourcingComparisonId: 41,
    rowSource: 'API',
    searchRank: id,
    itemCode: `shop-${id}:1000${id}`,
    shopCode: `shop-${id}`,
    shopName: `샵 ${id}`,
    itemName: 'アシックス ゲルカヤノ 14 1201A019-108 クリーム×ブラック メンズ',
    itemUrl: `item.rakuten.co.jp/shop-${id}/1000${id}/`,
    imageUrl: null,
    apiItemPriceYen: 12000,
    apiItemPriceMin3Yen: 12000,
    apiPointRate: 10,
    apiPostageFlag: 0,
    reviewCount: 12,
    reviewAverage: 4.5,
    shipOverseas: false,
    apiCollectedAt: '2026-09-28T04:55:00.000Z',
    rakutenPageCollectedAt: '2026-09-28T05:02:00.000Z',
    modelCodeNorm: '1201A019',
    colorCode: '108',
    anchorMatch: 'MATCH',
    janMatch: true,
    makerModelMatch: true,
    aiMatch: null,
    ownerMatchDecision: null,
    fetchOrder: id,
    isVerified: true,
    rakutenItemId: RAKUTEN_ITEM_ID,
    manualCheckRequired: false,
    manualCheckReason: null,
    inStockSizeCount: 5,
    stockPass: true,
    representativeRakutenSkuId: 1,
    representativePriceYen: 12000,
    shippingYen: 0,
    shippingSource: 'FREE',
    couponYen: 0,
    shopEventMultiplier: 0,
    pointBaseAmountYen: 10909,
    pointsBasePt: 109,
    pointsItemPt: 981,
    pointsShopEventPt: 0,
    pointsSpuPt: 0,
    pointsTotalPt: 1090,
    effectivePriceYen: 11455,
    isSelected: false,
    saleStartsAt: null,
    saleEndsAt: null,
    couponPercent: null,
    couponMinAmountYen: null,
    couponCombinable: null,
    couponPageUrl: null,
    riskFlags: [],
    createdAt: '2026-09-28T05:00:00.000Z',
    updatedAt: '2026-09-28T05:02:00.000Z',
    ...patch,
  };
}

/** 미검증 행(API 값만 — 페이지를 읽지 않음) */
export function unverifiedRow(
  id: number,
  patch: Partial<SourcingComparisonRow> = {},
): SourcingComparisonRow {
  return comparisonRow(id, {
    isVerified: false,
    rakutenItemId: null,
    rakutenPageCollectedAt: null,
    fetchOrder: null,
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
    janMatch: null,
    makerModelMatch: null,
    apiItemPriceYen: 11800,
    apiItemPriceMin3Yen: 11800,
    apiPostageFlag: 1,
    apiPointRate: 5,
    ...patch,
  });
}

/** 검색·비교 버전 비교표(입력 대기, 앵커 SEARCH_PICK 1201A019 · 108, 남성) */
export function searchComparison(
  patch: Partial<SourcingComparisonDetail> & { candidateId: number },
): SourcingComparisonDetail {
  return sourcingComparison({
    id: 41,
    stepRunId: 120,
    stepStatus: 'WAITING_INPUT',
    action: 'SEARCH_COMPARE',
    searchKeyword: 'アシックス ゲルカヤノ14 1201A019',
    sourceUrl: null,
    anchorInputMethod: 'SEARCH_PICK',
    anchorItemCode: 'shop-1:10001',
    anchorModelCode: '1201A019',
    anchorModelCodeNorm: '1201A019',
    anchorColorCode: '108',
    anchorColorLabel: 'クリーム×ブラック(108)',
    exploreMode: false,
    comparisonPerformed: true,
    selectedRakutenItemId: null,
    shippingYen: null,
    shippingSource: null,
    detectedGender: 'MALE',
    genderBasis: 'ITEM_NAME',
    params: {
      childShoeMaxSizeMm: 235,
      kRank: 0.5,
      spuMultiplier: 0,
      pointRounding: 'PER_PROGRAM',
      pointRateIncludesBase: true,
      minSizeCount: 3,
      defaultWidth: '2E (標準)',
      excludeBackOrder: true,
      defaultShippingYen: 800,
      targetSizeMm: { MALE: { min: 250, max: 290 }, FEMALE: { min: 220, max: 260 } },
    },
    rows: [],
    ...patch,
  });
}
