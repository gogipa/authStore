/**
 * 사이즈별 재고 판정(PRD §8.2 RK-05, F-SO-20·21, P2-03 규칙 6·7·8). 순수 함수.
 * - 대상 SKU: 앵커 색상(색상 코드가 같거나, 코드가 없으면 라벨이 같은 SKU. 둘 다 못 가리면 — 색상이 하나뿐인 상품이면 — 모두)
 *   중 기본 폭(설정, 예 `2E (標準)`)인 SKU. 폭 축이 없는 SKU(`width_label` NULL)는 기본 폭으로 본다(Proposed)
 * - 목표 범위(성별, 기본 남 250~290mm·여 220~260mm) 안에서 `quantity > 0` AND `hidden = false`인 사이즈 = '재고 있음'.
 *   取り寄せ(SKU `back_order`, 없으면 상품 `back_order_flag`)는 설정 `excludeBackOrder`(기본 true)면 뺀다
 * - cm가 아닌 라벨(`size_mm` NULL)은 '수동 확인'으로 넘긴다(재고 수에 넣지 않는다)
 * - 재고 있는 사이즈 수 < 최소 기준(기본 3) → `stockPass=false`('재고 부족')
 * - 대표 SKU = 재고 있는 목표 사이즈 SKU 중 가장 비싼 `taxIncludedPrice`(보수적, RK-06). 같으면 작은 사이즈·앞 SKU
 */

export type StockGender = 'MALE' | 'FEMALE';

export interface StockSku {
  id: number;
  colorLabel: string | null;
  colorCode: string | null;
  sizeLabel: string | null;
  sizeMm: number | null;
  widthLabel: string | null;
  taxIncludedPriceYen: number | null;
  quantity: number | null;
  hidden: boolean;
  backOrder: boolean | null;
  postageIncluded: boolean | null;
  articleNumber?: string | null;
}

export interface StockRules {
  /** 성별 목표 범위(mm) */
  targetSizeMm: Record<StockGender, { min: number; max: number }>;
  minSizeCount: number;
  defaultWidth: string;
  excludeBackOrder: boolean;
}

export interface StockColor {
  anchorColorCode: string | null;
  anchorColorLabel: string | null;
}

/** 목표 사이즈 한 칸의 상태(화면 '있음·품절·取り寄せ·없음') */
export type SizeStockStatus = 'IN_STOCK' | 'SOLD_OUT' | 'BACK_ORDER' | 'NONE';

export interface SizeStock {
  sizeMm: number;
  status: SizeStockStatus;
  /** 그 사이즈에서 고른 SKU(있음이면 재고 SKU) */
  skuId: number | null;
}

export interface StockJudgement {
  /** 목표 범위의 5mm 칸 수(화면 '5/9'의 9) */
  targetSizeCount: number;
  sizes: SizeStock[];
  inStockSizeCount: number;
  stockPass: boolean;
  /** 대표 SKU(재고 있는 목표 사이즈 중 최고가). 없으면 null */
  representative: StockSku | null;
  /** 앵커 색상·기본 폭으로 고른 SKU(송료·JAN 대조에 쓴다) */
  colorSkus: StockSku[];
  /** 수동 확인 사유(cm가 아닌 라벨 등). 없으면 null */
  manualCheckReason: string | null;
}

/** 라벨 비교용 정규화(NFKC·대문자·공백 제거) */
export function normalizeLabel(label: string | null | undefined): string {
  return (label ?? '').normalize('NFKC').toUpperCase().replace(/\s+/g, '');
}

/** 폭 라벨이 기본 폭인가(같거나, 둘 다 '標準'을 담거나, 폭 축이 없는 SKU) */
export function isDefaultWidth(widthLabel: string | null, defaultWidth: string): boolean {
  if (widthLabel === null || widthLabel.trim() === '') return true;
  const a = normalizeLabel(widthLabel);
  const b = normalizeLabel(defaultWidth);
  if (a === b) return true;
  if (a.includes('標準') && b.includes('標準')) return true;
  // '2E'처럼 괄호 설명 없이 적은 폭: 기본 폭의 첫 토큰과 같으면 기본 폭
  const head = b.replace(/[(（].*$/, '');
  return head !== '' && a === head;
}

/**
 * 앵커 색상의 SKU. 색상 코드가 있는 SKU는 코드로, 없는 SKU는 라벨로 가린다. 앵커 색상을 모르거나(탐색) 상품에 색상이 하나면
 * 모든 SKU
 */
export function skusOfColor<S extends Pick<StockSku, 'colorCode' | 'colorLabel'>>(
  skus: readonly S[],
  color: StockColor,
): S[] {
  const colors = new Set(skus.map((s) => normalizeLabel(s.colorLabel)));
  if (!color.anchorColorCode && !color.anchorColorLabel) return [...skus];
  const code = color.anchorColorCode ? normalizeLabel(color.anchorColorCode) : null;
  const label = color.anchorColorLabel ? normalizeLabel(color.anchorColorLabel) : null;
  const picked = skus.filter((s) => {
    if (code && s.colorCode) return normalizeLabel(s.colorCode) === code;
    if (label && s.colorLabel) return normalizeLabel(s.colorLabel) === label;
    return false;
  });
  if (picked.length > 0) return picked;
  // 색상 코드·라벨 모두 못 가리는데 색상이 하나뿐인 상품(라벨 없음 포함)이면 그 색상이다
  return colors.size <= 1 ? [...skus] : [];
}

function targetSteps(range: { min: number; max: number }): number[] {
  const out: number[] = [];
  for (let mm = range.min; mm <= range.max; mm += 5) out.push(mm);
  return out;
}

function isInStock(sku: StockSku, itemBackOrder: boolean | null, rules: StockRules): boolean {
  if (sku.hidden) return false;
  const backOrder = sku.backOrder ?? itemBackOrder ?? false;
  if (backOrder && rules.excludeBackOrder) return false;
  if (backOrder && !rules.excludeBackOrder) return true;
  return sku.quantity !== null && sku.quantity > 0;
}

/** 재고 판정. gender가 null이면(성별 입력 대기) 판정하지 않는다 → null */
export function judgeStock(input: {
  skus: readonly StockSku[];
  itemBackOrderFlag: boolean | null;
  color: StockColor;
  gender: StockGender | null;
  rules: StockRules;
}): StockJudgement | null {
  if (input.gender === null) return null;
  const range = input.rules.targetSizeMm[input.gender];
  const colorSkus = skusOfColor(input.skus, input.color).filter((s) =>
    isDefaultWidth(s.widthLabel, input.rules.defaultWidth),
  );
  const nonCm = [
    ...new Set(
      colorSkus.filter((s) => s.sizeMm === null && s.sizeLabel).map((s) => s.sizeLabel as string),
    ),
  ];
  const inRange = colorSkus.filter(
    (s) => s.sizeMm !== null && s.sizeMm >= range.min && s.sizeMm <= range.max,
  );
  const sizeSet = new Set([...targetSteps(range), ...inRange.map((s) => s.sizeMm as number)]);
  const sizes: SizeStock[] = [...sizeSet]
    .sort((a, b) => a - b)
    .map((sizeMm) => {
      const here = inRange.filter((s) => s.sizeMm === sizeMm);
      const stock = here.find((s) => isInStock(s, input.itemBackOrderFlag, input.rules));
      if (stock) return { sizeMm, status: 'IN_STOCK', skuId: stock.id };
      if (here.length === 0) return { sizeMm, status: 'NONE', skuId: null };
      const backOrder = here.find(
        (s) => !s.hidden && (s.backOrder ?? input.itemBackOrderFlag ?? false),
      );
      if (backOrder) return { sizeMm, status: 'BACK_ORDER', skuId: backOrder.id };
      return { sizeMm, status: 'SOLD_OUT', skuId: here[0]!.id };
    });
  const inStock = inRange.filter((s) => isInStock(s, input.itemBackOrderFlag, input.rules));
  const inStockSizeCount = sizes.filter((s) => s.status === 'IN_STOCK').length;
  let representative: StockSku | null = null;
  for (const sku of [...inStock].sort((a, b) => (a.sizeMm ?? 0) - (b.sizeMm ?? 0) || a.id - b.id)) {
    if (sku.taxIncludedPriceYen === null) continue;
    if (!representative || sku.taxIncludedPriceYen > (representative.taxIncludedPriceYen ?? -1)) {
      representative = sku;
    }
  }
  const reasons: string[] = [];
  if (nonCm.length > 0) reasons.push(`cm가 아닌 사이즈 라벨: ${nonCm.slice(0, 10).join(', ')}`);
  if (colorSkus.length === 0) reasons.push('앵커 색상·기본 폭 SKU를 찾지 못함');
  return {
    targetSizeCount: targetSteps(range).length,
    sizes,
    inStockSizeCount,
    stockPass: inStockSizeCount >= input.rules.minSizeCount,
    representative,
    colorSkus,
    manualCheckReason: reasons.length > 0 ? reasons.join(' / ').slice(0, 500) : null,
  };
}
