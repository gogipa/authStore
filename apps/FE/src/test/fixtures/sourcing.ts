import type {
  RakutenItemEntryChecks,
  RakutenItemFetchResult,
  RakutenItemSnapshot,
  RakutenQueryValidation,
  RakutenSkuVariant,
  SourcingComparisonDetail,
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
