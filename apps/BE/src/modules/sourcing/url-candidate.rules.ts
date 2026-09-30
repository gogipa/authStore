import { ApiException } from '../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../common/errors/error-codes.js';
import type { AnchorPreset } from './sourcing-output.js';

/** 송료(RK-06, F-SO-24): 고른 색상의 SKU가 모두 송료 포함이면 0(FREE), 아니면 기본 송료(DEFAULT_ESTIMATE, 0으로 두지 않는다) */
export function shippingForColor(
  skus: readonly { colorLabel: string | null; postageIncluded: boolean | null }[],
  colorLabel: string | null,
  defaultShippingYen: number,
): { shippingYen: number; shippingSource: 'FREE' | 'DEFAULT_ESTIMATE' } {
  const ofColor = skus.filter((s) => colorLabel !== null && s.colorLabel === colorLabel);
  const pool = ofColor.length > 0 ? ofColor : skus;
  const free = pool.length > 0 && pool.every((s) => s.postageIncluded === true);
  // ck_sc_shipping_default: DEFAULT_ESTIMATE면 송료 > 0. 설정 0은 FREE로 본다
  return free || defaultShippingYen <= 0
    ? { shippingYen: 0, shippingSource: 'FREE' }
    : { shippingYen: defaultShippingYen, shippingSource: 'DEFAULT_ESTIMATE' };
}

/** 422 RAKUTEN_ITEM_EXCLUDED_WORD('상품명에 제외어(中古·キッズ)가 있어 쓸 수 없습니다.', details.excludedWords) */
export function excludedWordException(words: readonly string[]): ApiException {
  return new ApiException('RAKUTEN_ITEM_EXCLUDED_WORD', {
    message: formatErrorMessage('RAKUTEN_ITEM_EXCLUDED_WORD', { 단어: words.join('·') }),
    details: { excludedWords: [...words] },
  });
}

/**
 * URL 상품 앵커(F-SO-35, PRD §5.3 '이 상품이 앵커가 된다'): 머리 행에는 itemCode·型番·색상 코드·라벨을 모두 둔다.
 * 색상 코드는 고른 색상 라벨의 SKU에서 얻는다(출처 M0 S2 — 없으면 null, 앵커를 확정하지 못한다).
 */
export function urlItemAnchor(
  item: {
    itemCode: string;
    modelCode: string | null;
    modelCodeNorm: string | null;
    skus: readonly { colorLabel: string | null; colorCode: string | null }[];
  },
  selectedColor: string,
): AnchorPreset {
  const sku = item.skus.find((s) => s.colorLabel === selectedColor && s.colorCode);
  return {
    anchorInputMethod: 'URL_ITEM',
    anchorItemCode: item.itemCode,
    anchorModelCode: item.modelCode,
    anchorModelCodeNorm: item.modelCodeNorm,
    anchorColorCode: sku?.colorCode ?? null,
    anchorColorLabel: selectedColor.slice(0, 128),
  };
}
