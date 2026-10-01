import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import { resultOf, type CheckProblem } from './check-helpers.js';

/** 판매가 + 옵션가의 최솟값(원, F-AP-13·RG-06 — 커머스API 옵션 가격 규칙) */
export const MIN_OPTION_SALE_PRICE_KRW = 10;

function sizeSet(sizes: readonly number[]): string {
  return [...new Set(sizes)].sort((a, b) => a - b).join(',');
}

function sizesText(sizes: readonly number[]): string {
  return sizes.length > 0 ? `{${sizeSet(sizes)}}` : '{}';
}

/**
 * `OPTIONS`(F-AP-13, RG-06, US-20 AC2, P4-02 규칙 5): 옵션 사이즈는 모두 재고 > 0이고(② 재고 판정 '재고 있음'), 같은 mm 옵션명이
 * 없고, `stockQuantity` = 옵션 재고 합이며, 모든 옵션에서 salePrice + 옵션가 ≥ 10원이다. ⑥-3 `notice_sizes_mm` 집합 = 사양 블록의
 * 사이즈 집합 = 옵션 사이즈 집합이다.
 */
export function optionsCheck(ctx: PreValidationContext): PreValidationCheck {
  const { draft, inputs } = ctx;
  const problems: CheckProblem[] = [];
  if (draft.options.length === 0) {
    problems.push({ message: '재고 있는 판매 사이즈 옵션이 없습니다', stepCode: 'SOURCING' });
  }
  const stock = new Map((inputs.sourcing?.sizes ?? []).map((size) => [size.sizeMm, size]));
  const outOfStock = draft.options.filter((option) => {
    const sku = stock.get(option.sizeMm);
    return option.stockQuantity <= 0 || !sku || sku.status !== 'IN_STOCK' || sku.quantity === 0;
  });
  if (outOfStock.length > 0) {
    problems.push({
      message: `재고가 없는 사이즈가 옵션에 있습니다(${outOfStock.map((o) => o.sizeMm).join(', ')}mm)`,
      stepCode: 'SOURCING',
    });
  }
  const names = draft.options.map((option) => option.optionName);
  const duplicated = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
  if (duplicated.length > 0) {
    problems.push({
      message: `같은 mm 옵션명이 있습니다(${duplicated.join(', ')})`,
      stepCode: 'PRICING',
    });
  }
  const sum = draft.options.reduce((total, option) => total + option.stockQuantity, 0);
  if (draft.stockQuantity !== sum) {
    problems.push({
      message: `원상품 재고 ${draft.stockQuantity}개가 옵션 재고 합 ${sum}개와 다릅니다`,
      stepCode: 'SOURCING',
    });
  }
  const salePrice = draft.salePriceKrw ?? 0;
  const cheap = draft.options.filter(
    (option) => salePrice + option.optionPriceKrw < MIN_OPTION_SALE_PRICE_KRW,
  );
  if (cheap.length > 0) {
    problems.push({
      message: `판매가 + 옵션가가 ${MIN_OPTION_SALE_PRICE_KRW}원보다 작은 옵션이 있습니다(${cheap
        .map((o) => `${o.sizeMm}mm ${salePrice + o.optionPriceKrw}원`)
        .join(', ')})`,
      stepCode: 'PRICING',
    });
  }
  const optionSizes = draft.options.map((option) => option.sizeMm);
  const assembly = inputs.assembly;
  if (!assembly) {
    problems.push({ message: '⑥-3 고시 사이즈를 읽지 못했습니다', stepCode: 'NOTICE_HTML' });
  } else {
    if (sizeSet(assembly.noticeSizesMm) !== sizeSet(optionSizes)) {
      problems.push({
        message: `고시 사이즈 ${sizesText(assembly.noticeSizesMm)}가 옵션 사이즈 ${sizesText(optionSizes)}와 다릅니다`,
        stepCode: 'NOTICE_HTML',
      });
    }
    if (assembly.specSizesMm === null) {
      problems.push({
        message: '상품 사양 블록의 사이즈를 읽지 못했습니다',
        stepCode: 'NOTICE_HTML',
      });
    } else if (sizeSet(assembly.specSizesMm) !== sizeSet(optionSizes)) {
      problems.push({
        message: `상품 사양 블록 사이즈 ${sizesText(assembly.specSizesMm)}가 옵션 사이즈 ${sizesText(optionSizes)}와 다릅니다`,
        stepCode: 'NOTICE_HTML',
      });
    }
  }
  return resultOf('OPTIONS', problems);
}
