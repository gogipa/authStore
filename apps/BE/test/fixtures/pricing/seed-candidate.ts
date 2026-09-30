import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Candidate, RakutenItem } from '../../../src/generated/prisma/client.js';
import type { PrismaService } from '../../../src/prisma/prisma.service.js';
import { truncate } from '../../helpers/test-app.js';
import { createCandidate, SAMPLE } from '../step-engine/candidate.factory.js';
import { createKeyword } from '../step-engine/keyword.factory.js';
import { STEP_ENGINE_TABLES, SOURCING_SNAPSHOT_TABLES } from '../step-engine/truncate.js';

/**
 * ③ 판정 e2e fixture(P2-05 §5): 후보 + ② 완료 버전(`rakuten_item`·`rakuten_sku`·`sourcing_comparison`[+ 고른 행])을 DB에
 * 직접 만든다. 라쿠텐을 부르지 않는다(합성 값 — 화면시안_명세 §4 예시: ¥12,000 · 250~290 중 5개 재고).
 * - `COMPARED`: 검색·비교 버전(comparison_performed=true) + 고른 행(쿠폰·포인트 1,090pt)
 * - `URL`: 'URL로 만들기' 버전(comparison_performed=false, 후보 creation_path RAKUTEN_URL)
 * 환율·요금표는 `seedFxRates`(PRD 예시 값)와 P2-04 fixture(test/fixtures/forwarder)를 쓴다.
 */

/** 화면시안_명세 §4 사이즈 재고: 250·255·260·265·275 있음 · 270·285 품절 · 280 取り寄せ · 290 없음 */
export const BOARD_SIZES: readonly SeedSize[] = [
  { sizeMm: 250, priceYen: 12000, quantity: 3 },
  { sizeMm: 255, priceYen: 12000, quantity: 2 },
  { sizeMm: 260, priceYen: 12000, quantity: 5 },
  { sizeMm: 265, priceYen: 12000, quantity: 1 },
  { sizeMm: 270, priceYen: 12000, quantity: 0 },
  { sizeMm: 275, priceYen: 12000, quantity: 4 },
  { sizeMm: 280, priceYen: 12000, quantity: 0, backOrder: true },
  { sizeMm: 285, priceYen: 12000, quantity: 0 },
];

export interface SeedSize {
  sizeMm: number;
  priceYen: number;
  quantity: number;
  backOrder?: boolean;
}

export interface PricingSeedInput {
  kind: 'COMPARED' | 'URL';
  /** 키워드 경로 후보(출처 키워드 있음). 기본: COMPARED → KEYWORD, URL → RAKUTEN_URL */
  keyword?: string | null;
  sizes?: readonly SeedSize[];
  shippingYen?: number;
  /** 비교를 한 버전의 고른 행 쿠폰(엔) */
  rowCouponYen?: number;
  collectedAt?: Date;
  /** 앵커 型番 원문(없으면 null — 네이버쇼핑 MODEL_CODE 링크 없음) */
  anchorModelCode?: string | null;
}

export interface PricingSeed {
  candidate: Candidate;
  sourcingStepRunId: number;
  rakutenItem: RakutenItem;
  sourcingComparisonId: number;
}

/** 페이지 수집 시각 기본값(2026-09-28 05:02 UTC = 14:02 KST, 6시간 → 20:02 KST) */
export const SEED_COLLECTED_AT = new Date('2026-09-28T05:02:00Z');

let seq = 0;

export async function seedPricingCandidate(
  prisma: PrismaService,
  input: PricingSeedInput,
): Promise<PricingSeed> {
  seq += 1;
  const itemCode = `shop-a:${10000000 + seq}`;
  const [shopCode, itemId] = itemCode.split(':') as [string, string];
  const itemUrl = `https://item.rakuten.co.jp/${shopCode}/${itemId}/`;
  const url = input.kind === 'URL';
  const keyword = input.keyword === undefined ? (url ? null : '아식스 젤카야노14') : input.keyword;
  const anchorModelCode =
    input.anchorModelCode === undefined ? '1201A019-108' : input.anchorModelCode;
  let sourceKeywordId: number | undefined;
  if (keyword) sourceKeywordId = (await createKeyword(prisma, { keyword })).id;
  const { candidate, stepRunIds } = await createCandidate(prisma, {
    creationPath: url ? 'RAKUTEN_URL' : keyword ? 'KEYWORD' : 'SEARCH_QUERY',
    sourceKeywordId,
    sourceUrl: url ? itemUrl : undefined,
    // 앵커 키는 型番 또는 앵커 itemCode 중 하나(ck_candidate_anchor_one)
    anchor: anchorModelCode
      ? { modelCode: anchorModelCode, colorCode: '108' }
      : { itemCode, colorCode: '108' },
    itemCode,
    selectedColor: SAMPLE.selectedColor,
    gender: 'MALE',
    genderSource: 'STEP2',
    steps: { SOURCING: 'COMPLETED' },
  });
  const sourcingStepRunId = stepRunIds.SOURCING!;
  const rakutenItem = await prisma.rakutenItem.create({
    data: {
      itemCode,
      shopCode,
      shopName: '샵 A',
      itemName: SAMPLE.itemName,
      itemUrl,
      modelCode: anchorModelCode,
      modelCodeNorm: anchorModelCode ? anchorModelCode.replace(/-/g, '') : null,
      entrySource: url ? 'MANUAL' : 'API',
      fetchReason: url ? 'URL_ENTRY' : 'SOURCING',
      collectedAt: input.collectedAt ?? SEED_COLLECTED_AT,
      genreId: 558885,
      genreSource: 'API',
      backOrderFlag: false,
    },
  });
  const sizes = input.sizes ?? BOARD_SIZES;
  const skuIds = new Map<number, number>();
  for (const [i, s] of sizes.entries()) {
    const sku = await prisma.rakutenSku.create({
      data: {
        rakutenItemId: rakutenItem.id,
        variantId: `v${i + 1}`,
        colorLabel: 'クリーム/ブラック',
        colorCode: '108',
        sizeLabel: `${(s.sizeMm / 10).toFixed(1)}cm`,
        sizeMm: s.sizeMm,
        taxIncludedPriceYen: s.priceYen,
        quantity: s.quantity,
        backOrder: s.backOrder ?? false,
        selectorValues: { color: 'クリーム/ブラック', size: `${s.sizeMm / 10}` },
      },
    });
    skuIds.set(s.sizeMm, sku.id);
  }
  const shippingYen = input.shippingYen ?? 0;
  const shippingSource = shippingYen === 0 ? 'FREE' : 'DEFAULT_ESTIMATE';
  const anchor = {
    anchorInputMethod: url ? ('URL_ITEM' as const) : ('SEARCH_PICK' as const),
    anchorItemCode: itemCode,
    anchorModelCode: anchorModelCode,
    anchorModelCodeNorm: anchorModelCode ? anchorModelCode.replace(/-/g, '') : null,
    anchorColorCode: '108',
    anchorColorLabel: 'クリーム/ブラック',
  };
  const head = await prisma.sourcingComparison.create({
    data: url
      ? {
          stepRunId: sourcingStepRunId,
          action: 'URL_CREATE',
          sourceUrl: itemUrl,
          ...anchor,
          comparisonPerformed: false,
          selectedRakutenItemId: rakutenItem.id,
          shippingYen,
          shippingSource,
          genreScope: 'IN_SCOPE',
          params: {},
        }
      : {
          stepRunId: sourcingStepRunId,
          action: 'SEARCH_COMPARE',
          searchKeyword: 'アシックス ゲルカヤノ14',
          ...anchor,
          comparisonPerformed: true,
          genreScope: 'IN_SCOPE',
          params: {},
        },
  });
  if (!url) {
    const stocked = sizes.filter((s) => s.quantity > 0);
    const representative = [...stocked].sort((a, b) => b.priceYen - a.priceYen)[0];
    await prisma.sourcingComparisonRow.create({
      data: {
        sourcingComparisonId: head.id,
        rowSource: 'API',
        searchRank: 1,
        itemCode,
        shopCode,
        shopName: '샵 A',
        itemName: SAMPLE.itemName,
        itemUrl,
        anchorMatch: 'MATCH',
        isVerified: true,
        rakutenItemId: rakutenItem.id,
        inStockSizeCount: stocked.length,
        stockPass: stocked.length >= 3,
        representativeRakutenSkuId: representative ? skuIds.get(representative.sizeMm) : null,
        representativePriceYen: representative?.priceYen ?? null,
        shippingYen,
        shippingSource,
        couponYen: input.rowCouponYen ?? 0,
        pointsTotalPt: 1090,
        isSelected: true,
      },
    });
  }
  const fresh = await prisma.candidate.findUniqueOrThrow({ where: { id: candidate.id } });
  return { candidate: fresh, sourcingStepRunId, rakutenItem, sourcingComparisonId: head.id };
}

/** 환율 3종(PRD §8.3 예시: 원가 100엔 876 · 과세 100엔 876 · 달러 1,358.72) */
export async function seedFxRates(prisma: PrismaService): Promise<number[]> {
  const referenceAt = new Date('2026-09-28T02:00:00Z');
  const rows = await Promise.all([
    prisma.fxRate.create({
      data: {
        rateKind: 'COST',
        currency: 'JPY',
        rateValue: '876',
        unit: 100,
        source: 'KEXIM',
        referenceAt,
      },
    }),
    prisma.fxRate.create({
      data: {
        rateKind: 'CUSTOMS',
        currency: 'JPY',
        rateValue: '876',
        unit: 100,
        source: 'CUSTOMS_SERVICE',
        referenceAt,
      },
    }),
    prisma.fxRate.create({
      data: {
        rateKind: 'CUSTOMS',
        currency: 'USD',
        rateValue: '1358.72',
        unit: 1,
        source: 'CUSTOMS_SERVICE',
        referenceAt,
      },
    }),
  ]);
  return rows.map((r) => r.id);
}

/** 요금표 CSV fixture(P2-04) 원문 */
export function forwarderCsv(name: string): Buffer {
  return readFileSync(join(import.meta.dirname, '..', 'forwarder', name));
}

/** ③ 판정 e2e가 쓰는 표(삭제 금지·추가만 트리거 → TRUNCATE … RESTART IDENTITY CASCADE) */
export const PRICING_TABLES = [
  'domestic_price',
  'pricing_coupon_input',
  'price_judgement',
  'price_judgement_size',
  'fx_rate',
  'forwarder_rate_tier',
  'forwarder_rate_table',
  'sourcing_comparison_row',
] as const;

export async function truncatePricing(prisma: PrismaService): Promise<void> {
  await truncate(prisma, [...STEP_ENGINE_TABLES, ...SOURCING_SNAPSHOT_TABLES, ...PRICING_TABLES]);
}
