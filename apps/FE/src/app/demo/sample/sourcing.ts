import {
  comparisonRow,
  queryValidation,
  rakutenItemSnapshot,
  unverifiedRow,
} from '@/test/fixtures/sourcing';
import { DEMO_IDS, MINUTES_AGO as M, STORY, type DemoClock } from './story';
import type { Ok, Schema } from './types';

type Row = Schema<'SourcingComparisonRow'>;
type Sku = Schema<'RakutenSkuVariant'>;

/** 검증 행이 읽은 페이지 스냅샷 id(ショップA는 고른 상품 55) */
export const ITEM_ID = { A: DEMO_IDS.rakutenItem, C: 56, B: 57, L: 58 } as const;

/** 목표 사이즈(남성 250~290mm, 5mm 간격) */
const TARGET_SIZES = [250, 255, 260, 265, 270, 275, 280, 285, 290];

/** ショップA 색상 108의 재고: 판매 사이즈 5개(③ 판정과 같다), 270·285 품절, 280 取り寄せ, 290 없음 */
const SHOP_A_STOCK: Readonly<Record<number, number | 'BACK_ORDER'>> = {
  250: 3,
  255: 3,
  260: 3,
  265: 3,
  270: 0,
  275: 3,
  280: 'BACK_ORDER',
  285: 0,
};

/** 상품 설명(⑥-2 원산지·소재가 근거 문장으로 읽은 글) */
const SHOP_A_DESCRIPTION = [
  'アシックス ゲルカヤノ 14 1201A019-108 クリーム×ブラック',
  '2008年発売モデルを復刻。かかとにGEL搭載、衝撃緩衝性に優れる。',
  'アッパー:合成繊維・合成皮革 / ライニング:合成繊維 / ソール:ゴム底',
  'ヒール高: 3cm',
  '原産国: ベトナム',
].join('\n');

function sku(
  id: number,
  sizeMm: number,
  stock: number | 'BACK_ORDER',
  priceYen: number,
  colorLabel: string = STORY.colorLabelJa,
  colorCode: string = STORY.colorCode,
): Sku {
  const label = `${(sizeMm / 10).toFixed(sizeMm % 10 === 0 ? 0 : 1)}cm`;
  return {
    id,
    variantId: `${colorCode}-${sizeMm}`,
    colorLabel,
    colorCode,
    sizeLabel: label,
    sizeMm,
    widthLabel: '2E (標準)',
    taxIncludedPriceYen: priceYen,
    quantity: stock === 'BACK_ORDER' ? 0 : stock,
    hidden: false,
    backOrder: stock === 'BACK_ORDER',
    stockCondition: stock === 'BACK_ORDER' ? '取り寄せ' : null,
    articleNumber: null,
    postageIncluded: priceYen === 12_000,
    singleItemShipping: null,
    selectorValues: [colorLabel, label, '2E (標準)'],
    attributes: null,
  };
}

/** 페이지 스냅샷(`GET /rakuten-items/{id}`): 고른 ショップA와 비교표의 다른 검증 행 */
export function rakutenItem(
  clock: DemoClock,
  rakutenItemId: number,
): Ok<'/rakuten-items/{rakutenItemId}'> | null {
  const common = {
    entrySource: 'API' as const,
    fetchReason: 'SOURCING' as const,
    collectedAt: clock.ago(M.pageCollected),
    modelCode: '1201A019-108',
    modelCodeNorm: '1201A019108',
  };
  switch (rakutenItemId) {
    case ITEM_ID.A: {
      const sizes = Object.entries(SHOP_A_STOCK).map(([size, stock], i) =>
        sku(i + 1, Number(size), stock, 12_000),
      );
      const white = [250, 260, 270].map((size, i) =>
        sku(20 + i, size, 2, 12_000, 'ホワイト(100)', '100'),
      );
      return rakutenItemSnapshot({
        ...common,
        id: ITEM_ID.A,
        itemCode: STORY.itemCode,
        shopCode: STORY.shopCode,
        shopName: STORY.shopName,
        itemName: STORY.itemName,
        itemUrl: STORY.itemUrl,
        descriptionText: SHOP_A_DESCRIPTION,
        skus: [...sizes, ...white],
      });
    }
    case ITEM_ID.C:
      return rakutenItemSnapshot({
        ...common,
        id: ITEM_ID.C,
        itemCode: 'shop-c:30003',
        shopCode: 'shop-c',
        shopName: 'ショップC',
        itemName: 'アシックス ゲルカヤノ 14 1201A019 クリーム×ブラック メンズ',
        itemUrl: 'item.rakuten.co.jp/shop-c/30003/',
        modelCode: '1201A019',
        modelCodeNorm: '1201A019',
        skus: [250, 260, 265, 275].map((size, i) => sku(40 + i, size, 1, 11_500)),
      });
    case ITEM_ID.B:
      return rakutenItemSnapshot({
        ...common,
        id: ITEM_ID.B,
        itemCode: 'shop-b:20000456',
        shopCode: 'shop-b',
        shopName: 'ショップB',
        itemName: 'asics ゲルカヤノ14 1201A019-108 クリーム/ブラック メンズ 靴',
        itemUrl: 'item.rakuten.co.jp/shop-b/20000456/',
        skus: [250, 255, 260, 265, 270, 275].map((size, i) => sku(50 + i, size, 2, 11_800)),
      });
    case ITEM_ID.L:
      return rakutenItemSnapshot({
        ...common,
        id: ITEM_ID.L,
        itemCode: 'shop-l:20101',
        shopCode: 'shop-l',
        shopName: 'ショップL',
        itemName: 'アシックス ゲルカヤノ 14 1201A019-108 メンズ',
        itemUrl: 'item.rakuten.co.jp/shop-l/20101/',
        skus: TARGET_SIZES.map((size, i) =>
          sku(60 + i, size, size === 265 || size === 270 ? 1 : 0, 11_000),
        ),
      });
    default:
      return null;
  }
}

function row(id: number, patch: Partial<Row>): Row {
  return comparisonRow(id, {
    sourcingComparisonId: DEMO_IDS.sourcingComparison,
    modelCodeNorm: STORY.modelCodeNorm,
    colorCode: STORY.colorCode,
    anchorMatch: 'MATCH',
    reviewCount: 12,
    reviewAverage: 4.5,
    ...patch,
  });
}

/**
 * 비교표 행(서버 순서: 검증 행 = 재고 통과 → 실질가 낮은 순, 그다음 미검증 행, 불일치 행). 실질가 = SKU가 + 송료 − 포인트 × 0.5
 * (kRank). ショップA: ¥12,000 · 송료 무료 · 10배 1,090pt → ¥11,455(PRD §8.2 예, FE fixture와 같다).
 * ショップK는 상품명에 모델 번호가 없어 앱이 같은 상품인지 가리지 못한 행(확인 필요) — 기준 상품을 정한 뒤 표에서 접혀 보인다(D-47).
 */
export function fullRows(clock: DemoClock): Row[] {
  const api = clock.ago(M.anchorFixed + 1);
  const page = clock.ago(M.pageCollected);
  const verified = { apiCollectedAt: api, rakutenPageCollectedAt: page };
  return [
    row(411, {
      ...verified,
      searchRank: 5,
      itemCode: STORY.itemCode,
      shopCode: STORY.shopCode,
      shopName: STORY.shopName,
      itemName: STORY.itemName,
      itemUrl: STORY.itemUrl,
      reviewCount: 128,
      reviewAverage: 4.7,
      fetchOrder: 1,
      rakutenItemId: ITEM_ID.A,
      inStockSizeCount: 5,
      representativeRakutenSkuId: 1,
      isSelected: true,
    }),
    row(412, {
      ...verified,
      searchRank: 3,
      itemCode: 'shop-c:30003',
      shopCode: 'shop-c',
      shopName: 'ショップC',
      itemName: 'アシックス ゲルカヤノ 14 1201A019 クリーム×ブラック メンズ',
      itemUrl: 'item.rakuten.co.jp/shop-c/30003/',
      modelCodeNorm: '1201A019',
      apiItemPriceYen: 11_500,
      apiItemPriceMin3Yen: 11_500,
      apiPointRate: 1,
      apiPostageFlag: 1,
      fetchOrder: 3,
      janMatch: null,
      makerModelMatch: true,
      rakutenItemId: ITEM_ID.C,
      inStockSizeCount: 4,
      representativeRakutenSkuId: 40,
      representativePriceYen: 11_500,
      shippingYen: 800,
      shippingSource: 'DEFAULT_ESTIMATE',
      pointBaseAmountYen: 10_454,
      pointsBasePt: 104,
      pointsItemPt: 0,
      pointsTotalPt: 104,
      effectivePriceYen: 12_248,
    }),
    row(413, {
      ...verified,
      searchRank: 4,
      itemCode: 'shop-b:20000456',
      shopCode: 'shop-b',
      shopName: 'ショップB',
      itemName: 'asics ゲルカヤノ14 1201A019-108 クリーム/ブラック メンズ 靴',
      itemUrl: 'item.rakuten.co.jp/shop-b/20000456/',
      apiItemPriceYen: 11_800,
      apiItemPriceMin3Yen: 11_800,
      apiPointRate: 5,
      apiPostageFlag: 1,
      reviewCount: 34,
      reviewAverage: 4.2,
      fetchOrder: 4,
      rakutenItemId: ITEM_ID.B,
      inStockSizeCount: 6,
      representativeRakutenSkuId: 50,
      representativePriceYen: 11_800,
      shippingYen: 800,
      shippingSource: 'DEFAULT_ESTIMATE',
      pointBaseAmountYen: 10_727,
      pointsBasePt: 107,
      pointsItemPt: 429,
      pointsTotalPt: 536,
      effectivePriceYen: 12_332,
    }),
    row(414, {
      ...verified,
      searchRank: 1,
      itemCode: 'shop-l:20101',
      shopCode: 'shop-l',
      shopName: 'ショップL',
      itemName: 'アシックス ゲルカヤノ 14 1201A019-108 メンズ',
      itemUrl: 'item.rakuten.co.jp/shop-l/20101/',
      apiItemPriceYen: 11_000,
      apiItemPriceMin3Yen: 11_000,
      apiPointRate: 1,
      fetchOrder: 2,
      rakutenItemId: ITEM_ID.L,
      inStockSizeCount: 2,
      stockPass: false,
      representativeRakutenSkuId: 63,
      representativePriceYen: 11_000,
      pointBaseAmountYen: 10_000,
      pointsBasePt: 100,
      pointsItemPt: 0,
      pointsTotalPt: 100,
      effectivePriceYen: 10_950,
    }),
    unverifiedRow(415, {
      sourcingComparisonId: DEMO_IDS.sourcingComparison,
      apiCollectedAt: api,
      searchRank: 6,
      itemCode: 'shop-w:20103',
      shopCode: 'shop-w',
      shopName: 'ショップW',
      itemName: 'アシックス ゲルカヤノ 14 1201A019-108 メンズ ワイド',
      itemUrl: 'item.rakuten.co.jp/shop-w/20103/',
      modelCodeNorm: STORY.modelCodeNorm,
      apiItemPriceYen: 12_200,
      apiItemPriceMin3Yen: 12_200,
      apiPointRate: 1,
      apiPostageFlag: 0,
      reviewCount: 9,
      reviewAverage: 4.4,
    }),
    unverifiedRow(416, {
      sourcingComparisonId: DEMO_IDS.sourcingComparison,
      apiCollectedAt: api,
      searchRank: 7,
      itemCode: 'shop-h:20104',
      shopCode: 'shop-h',
      shopName: 'ショップH',
      itemName: 'ASICS GEL-KAYANO 14 1201A019-108 CREAM/BLACK',
      itemUrl: 'item.rakuten.co.jp/shop-h/20104/',
      modelCodeNorm: STORY.modelCodeNorm,
      apiItemPriceYen: 12_400,
      apiItemPriceMin3Yen: 12_400,
      apiPointRate: 1,
      apiPostageFlag: 0,
      reviewCount: 21,
      reviewAverage: 4.6,
    }),
    unverifiedRow(418, {
      sourcingComparisonId: DEMO_IDS.sourcingComparison,
      apiCollectedAt: api,
      searchRank: 8,
      itemCode: 'shop-k:20105',
      shopCode: 'shop-k',
      shopName: 'ショップK',
      itemName: 'アシックス ゲルカヤノ14 メンズ ランニングシューズ 人気モデル',
      itemUrl: 'item.rakuten.co.jp/shop-k/20105/',
      modelCodeNorm: null,
      colorCode: null,
      anchorMatch: 'NEEDS_REVIEW',
      apiItemPriceYen: 9_800,
      apiItemPriceMin3Yen: 9_800,
      apiPointRate: 1,
      apiPostageFlag: 0,
      reviewCount: 3,
      reviewAverage: 3.9,
    }),
    unverifiedRow(417, {
      sourcingComparisonId: DEMO_IDS.sourcingComparison,
      apiCollectedAt: api,
      searchRank: 2,
      itemCode: 'shop-j:20102',
      shopCode: 'shop-j',
      shopName: 'ショップJ',
      itemName: 'アシックス ゲルカヤノ 14 1201A019-100 ホワイト メンズ',
      itemUrl: 'item.rakuten.co.jp/shop-j/20102/',
      modelCodeNorm: STORY.modelCodeNorm,
      colorCode: '100',
      anchorMatch: 'NO_MATCH',
      apiItemPriceYen: 11_500,
      apiItemPriceMin3Yen: 11_500,
      apiPointRate: 1,
      apiPostageFlag: 0,
    }),
  ];
}

/** 라쿠텐 검색어 형식 검사(저장 없는 계산 — BE rakuten-query.rules와 같은 반각 환산·최대 128자) */
export function validateRakutenQuery(
  rakutenQuery: string,
): Ok<'/rakuten-query-validations', 'post'> {
  const query = rakutenQuery.trim();
  let length = 0;
  for (const char of query) length += isWide(char.codePointAt(0) ?? 0) ? 2 : 1;
  const tooLong = length > 128;
  return queryValidation(query, {
    valid: !tooLong,
    halfWidthLength: length,
    violations: tooLong
      ? [{ rule: 'TOO_LONG', word: null, message: '검색어가 반각 128자를 넘습니다.' }]
      : [],
  });
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x9fff) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6)
  );
}
