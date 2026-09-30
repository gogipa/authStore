import { rakutenPageBytes } from '../../../test/support/rakuten-fixture.adapters.js';
import { type ParsedItemPage, parseItemPage } from './page-json.parser.js';
import { anchorJansOf, calculateRow, pricingOf, type RowCalcContext } from './row-calculation.js';
import type { ComparisonParams } from './sourcing-output.js';
import type { StockSku } from './stock-judgement.js';

/** 비교표 fixture 페이지(P2-03 §5 fixtures)를 실제 파서로 읽어 행 값을 계산한다 */
type Fixture = Parameters<typeof rakutenPageBytes>[0];

function snapshotOf(name: Fixture) {
  const result = parseItemPage(rakutenPageBytes(name));
  if (result.kind !== 'PARSED') throw new Error(`파싱 실패: ${name}`);
  const page: ParsedItemPage = result.page;
  const skus: StockSku[] = page.skus.map((s, i) => ({ id: i + 1, ...s }));
  return { backOrderFlag: page.backOrderFlag, modelCodeNorm: page.modelCodeNorm, skus };
}

const PARAMS: ComparisonParams = {
  targetSizeMm: { MALE: { min: 250, max: 290 }, FEMALE: { min: 220, max: 260 } },
  minSizeCount: 3,
  defaultWidth: '2E (標準)',
  excludeBackOrder: true,
  defaultShippingYen: 800,
  pageFetchTargetCandidates: 3,
  pageFetchMaxPages: 10,
  kRank: 0.5,
  spuMultiplier: 0,
  pointRounding: 'PER_PROGRAM',
  pointRateIncludesBase: true,
};
const ANCHOR = {
  modelCodeNorm: '1201A019',
  colorCode: '108',
  itemCode: 'shop-a:10000123',
  colorLabel: 'クリーム×ブラック(108)',
};
const SHOP_A = snapshotOf('shop-a');
const CTX: RowCalcContext = {
  anchor: ANCHOR,
  anchorJans: anchorJansOf(SHOP_A.skus, ANCHOR),
  gender: 'MALE',
  params: PARAMS,
};
const row = (apiPostageFlag: number | null, apiPointRate: number | null, couponYen = 0) => ({
  apiPostageFlag,
  apiPointRate,
  couponYen,
  shopEventMultiplier: 0,
});

describe('row-calculation(재고·송료·포인트·실질가·재대조, fixture 페이지)', () => {
  it('shop-a(¥12,000·pointRate 10·postageFlag 0) → 5/9 통과, 송료 0, 1,090pt, 실질가 11,455, JAN·メーカー型番 일치', () => {
    const result = calculateRow(row(0, 10), SHOP_A, CTX);
    expect(result.data).toMatchObject({
      inStockSizeCount: 5,
      stockPass: true,
      representativePriceYen: 12_000,
      shippingYen: 0,
      shippingSource: 'FREE',
      pointsTotalPt: 1_090,
      effectivePriceYen: 11_455,
    });
    expect(result.stock?.targetSizeCount).toBe(9);
    expect(result.janMatch).toBe(true);
    expect(result.makerModelMatch).toBe(true);
    expect(result.stockManualCheckReason).toBeNull();
  });

  it('shop-b(¥11,800·송료 별도·5배) → 3/9 통과, 송료 추정 800, 536pt, 실질가 12,332', () => {
    const result = calculateRow(row(1, 5), snapshotOf('shop-b'), CTX);
    expect(result.data).toMatchObject({
      inStockSizeCount: 3,
      stockPass: true,
      shippingYen: 800,
      shippingSource: 'DEFAULT_ESTIMATE',
      pointsTotalPt: 536,
      effectivePriceYen: 12_332,
    });
  });

  it('shop-low-stock → 2/9 재고 부족(stock_pass false)', () => {
    const result = calculateRow(row(0, 1), snapshotOf('shop-low-stock'), CTX);
    expect(result.data.inStockSizeCount).toBe(2);
    expect(result.data.stockPass).toBe(false);
  });

  it('width-variants → 4E는 빼고 2E만(3개 통과), hidden-sku → hidden 250·265를 빼고 3개', () => {
    expect(calculateRow(row(0, 1), snapshotOf('width-variants'), CTX).data.inStockSizeCount).toBe(
      3,
    );
    const hidden = calculateRow(row(0, 1), snapshotOf('hidden-sku'), CTX);
    expect(hidden.data.inStockSizeCount).toBe(3);
    expect(hidden.stock?.sizes.find((s) => s.sizeMm === 250)?.status).toBe('SOLD_OUT');
  });

  it('jan-mismatch → 재고는 통과지만 JAN이 앵커(샵 A)와 달라 jan_match false', () => {
    const result = calculateRow(row(0, 1), snapshotOf('jan-mismatch'), CTX);
    expect(result.data.stockPass).toBe(true);
    expect(result.janMatch).toBe(false);
    expect(result.makerModelMatch).toBe(true);
  });

  it('women-sizes → 여성 범위에서 24.5cm(245) 포함, 색상은 그 상품의 앵커 색상', () => {
    const women = snapshotOf('women-sizes');
    const result = calculateRow(row(0, 1), women, {
      ...CTX,
      anchor: { ...ANCHOR, modelCodeNorm: '1202A056', colorCode: '104', colorLabel: null },
      anchorJans: null,
      gender: 'FEMALE',
    });
    expect(result.stock?.sizes.find((s) => s.sizeMm === 245)?.status).toBe('IN_STOCK');
    // 220·230·235·245·250·260
    expect(result.data.inStockSizeCount).toBe(6);
  });

  it('shop-c(색상 코드 없음) → 색상이 하나뿐이라 그 색상으로 재고를 센다(분류는 NEEDS_REVIEW로 남는다), JAN은 확인 안 함', () => {
    const result = calculateRow(row(1, 1), snapshotOf('shop-c'), CTX);
    expect(result.data.inStockSizeCount).toBe(5);
    expect(result.janMatch).toBeNull();
    // 색상이 여럿인데 코드·라벨로 앵커 색상을 못 가리면 재고 0 + 수동 확인 사유
    const twoColors = snapshotOf('shop-c');
    twoColors.skus = [
      ...twoColors.skus,
      { ...twoColors.skus[0]!, id: 99, colorLabel: 'ホワイト', sizeMm: 255 },
    ];
    const unknown = calculateRow(row(1, 1), twoColors, CTX);
    expect(unknown.data.inStockSizeCount).toBe(0);
    expect(unknown.stockManualCheckReason).toContain('앵커 색상');
  });

  it('성별을 모르면 재고·실질가는 NULL(검증은 한다 — 성별 입력 대기)', () => {
    const result = calculateRow(row(0, 10), SHOP_A, { ...CTX, gender: null });
    expect(result.data.inStockSizeCount).toBeNull();
    expect(result.data.effectivePriceYen).toBeNull();
    expect(result.data.shippingSource).toBe('FREE');
  });

  it('쿠폰·배율만 바뀌면 대표 SKU가·송료는 그대로 두고 포인트·실질가만(PATCH)', () => {
    const repriced = pricingOf(
      { ...row(0, 10, 500), representativePriceYen: 12_000, shippingYen: 0 },
      PARAMS,
    );
    // base = floor(11,500 × 10 / 11) = 10,454 → 104 + 940 = 1,044pt → 12,000 − 500 − 522 = 10,978
    expect(repriced).toMatchObject({
      pointBaseAmountYen: 10_454,
      pointsTotalPt: 1_044,
      effectivePriceYen: 10_978,
    });
    expect(
      pricingOf({ ...row(0, 10), representativePriceYen: null, shippingYen: null }, PARAMS)
        .effectivePriceYen,
    ).toBeNull();
  });
});
