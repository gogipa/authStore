import { sizeLabelToMm } from './size-label.js';
import {
  isDefaultWidth,
  judgeStock,
  skusOfColor,
  type StockRules,
  type StockSku,
} from './stock-judgement.js';

const RULES: StockRules = {
  targetSizeMm: { MALE: { min: 250, max: 290 }, FEMALE: { min: 220, max: 260 } },
  minSizeCount: 3,
  defaultWidth: '2E (標準)',
  excludeBackOrder: true,
};
const CREAM = 'クリーム×ブラック(108)';
const COLOR = { anchorColorCode: '108', anchorColorLabel: CREAM };

let nextId = 1;
function sku(sizeLabel: string, patch: Partial<StockSku> = {}): StockSku {
  return {
    id: nextId++,
    colorLabel: CREAM,
    colorCode: '108',
    sizeLabel,
    sizeMm: sizeLabelToMm(sizeLabel),
    widthLabel: '2E (標準)',
    taxIncludedPriceYen: 12_000,
    quantity: 2,
    hidden: false,
    backOrder: false,
    postageIncluded: true,
    ...patch,
  };
}

/** 시안 사이즈 표(Sourcing 보드 샵 A): 250·255·260·265·275 재고, 270·285 품절, 280 取り寄せ, 290 없음 */
function boardSkus(): StockSku[] {
  return [
    sku('25.0cm'),
    sku('25.5cm'),
    sku('26.0cm', { taxIncludedPriceYen: 12_400 }),
    sku('26.5cm'),
    sku('27.0cm', { quantity: 0 }),
    sku('27.5cm'),
    sku('28.0cm', { quantity: 0, backOrder: true }),
    sku('28.5cm', { hidden: true, quantity: 2 }),
    sku('L'),
  ];
}

describe('stock-judgement(RK-05, F-SO-20·21)', () => {
  it('남성·시안 사이즈 표 → 5/9, stock_pass true, 대표 SKU = 재고 사이즈 중 최고가', () => {
    const result = judgeStock({
      skus: boardSkus(),
      itemBackOrderFlag: false,
      color: COLOR,
      gender: 'MALE',
      rules: RULES,
    })!;
    expect(result.inStockSizeCount).toBe(5);
    expect(result.targetSizeCount).toBe(9);
    expect(result.stockPass).toBe(true);
    expect(result.representative?.sizeMm).toBe(260);
    expect(result.representative?.taxIncludedPriceYen).toBe(12_400);
    expect(result.sizes.map((s) => [s.sizeMm, s.status])).toEqual([
      [250, 'IN_STOCK'],
      [255, 'IN_STOCK'],
      [260, 'IN_STOCK'],
      [265, 'IN_STOCK'],
      [270, 'SOLD_OUT'],
      [275, 'IN_STOCK'],
      [280, 'BACK_ORDER'],
      [285, 'SOLD_OUT'],
      [290, 'NONE'],
    ]);
    // cm가 아닌 라벨(L)은 수동 확인
    expect(result.manualCheckReason).toContain('L');
  });

  it('재고 사이즈 2개 → stock_pass false(재고 부족)', () => {
    const result = judgeStock({
      skus: [sku('25.0cm'), sku('25.5cm'), sku('26.0cm', { quantity: 0 })],
      itemBackOrderFlag: false,
      color: COLOR,
      gender: 'MALE',
      rules: RULES,
    })!;
    expect(result.inStockSizeCount).toBe(2);
    expect(result.stockPass).toBe(false);
  });

  it('hidden·다른 색상·4E·取り寄せ(SKU·상품 플래그)는 뺀다', () => {
    const result = judgeStock({
      skus: [
        sku('25.0cm', { hidden: true }),
        sku('25.5cm', { colorLabel: 'ホワイト(100)', colorCode: '100' }),
        sku('26.0cm', { widthLabel: '4E' }),
        sku('26.5cm', { backOrder: true, quantity: 3 }),
        sku('27.0cm', { backOrder: null }),
        sku('27.5cm'),
      ],
      itemBackOrderFlag: true,
      color: COLOR,
      gender: 'MALE',
      rules: RULES,
    })!;
    // 27.0cm은 SKU 값이 없어 상품 取り寄せ 플래그(true)를 따른다 → 빠짐. 남는 것은 27.5cm 하나
    expect(result.inStockSizeCount).toBe(1);
    expect(result.representative?.sizeMm).toBe(275);
    // 取り寄せ를 빼지 않는 설정이면 取り寄せ SKU도 재고로 본다
    const loose = judgeStock({
      skus: [sku('26.5cm', { backOrder: true, quantity: 0 })],
      itemBackOrderFlag: false,
      color: COLOR,
      gender: 'MALE',
      rules: { ...RULES, excludeBackOrder: false },
    })!;
    expect(loose.inStockSizeCount).toBe(1);
  });

  it("'24.5cm' → 245(여성 범위 안), 남성 범위 밖은 세지 않는다", () => {
    expect(sizeLabelToMm('24.5cm')).toBe(245);
    const skus = [sku('22.0cm'), sku('24.5cm'), sku('26.0cm'), sku('27.0cm')];
    const female = judgeStock({
      skus,
      itemBackOrderFlag: false,
      color: COLOR,
      gender: 'FEMALE',
      rules: RULES,
    })!;
    expect(female.inStockSizeCount).toBe(3);
    expect(female.sizes.find((s) => s.sizeMm === 245)?.status).toBe('IN_STOCK');
    const male = judgeStock({
      skus,
      itemBackOrderFlag: false,
      color: COLOR,
      gender: 'MALE',
      rules: RULES,
    })!;
    expect(male.inStockSizeCount).toBe(2);
  });

  it('성별을 모르면 판정하지 않는다(null — 성별 입력 대기)', () => {
    expect(
      judgeStock({
        skus: boardSkus(),
        itemBackOrderFlag: false,
        color: COLOR,
        gender: null,
        rules: RULES,
      }),
    ).toBeNull();
  });

  it('폭 축이 없는 SKU는 기본 폭, 2E·標準 표기 차이는 같은 폭으로 본다(Proposed)', () => {
    expect(isDefaultWidth(null, '2E (標準)')).toBe(true);
    expect(isDefaultWidth('２Ｅ（標準）', '2E (標準)')).toBe(true);
    expect(isDefaultWidth('標準', '2E (標準)')).toBe(true);
    expect(isDefaultWidth('2E', '2E (標準)')).toBe(true);
    expect(isDefaultWidth('4E', '2E (標準)')).toBe(false);
  });

  it('색상: 코드가 있으면 코드로, 없으면 라벨로, 색상이 하나뿐이면 모두', () => {
    const skus = [
      sku('25.0cm'),
      sku('25.5cm', { colorCode: null }),
      sku('26.0cm', { colorLabel: 'ホワイト(100)', colorCode: null }),
    ];
    expect(skusOfColor(skus, COLOR).map((s) => s.sizeLabel)).toEqual(['25.0cm', '25.5cm']);
    const single = [sku('25.0cm', { colorCode: null, colorLabel: null })];
    expect(skusOfColor(single, COLOR)).toHaveLength(1);
    expect(skusOfColor(skus, { anchorColorCode: null, anchorColorLabel: null })).toHaveLength(3);
  });
});
