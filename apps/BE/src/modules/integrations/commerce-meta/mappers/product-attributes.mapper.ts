import { toMetaDocument, type MetaDocument } from './meta-document.js';
import { isObject, MetaMappingError } from './mapper-utils.js';

/** PRODUCT_ATTRIBUTES 문서 payload: 두 응답을 한 문서로 묶는다(Proposed) */
export interface ProductAttributesPayload {
  /** `GET /v1/product-attributes/attributes?categoryId=` 원문 */
  attributes: unknown;
  /** `GET /v1/product-attributes/attribute-values?categoryId=` 원문 */
  attributeValues: unknown;
}

function assertListOrObject(value: unknown, what: string): void {
  if (!Array.isArray(value) && !isObject(value)) {
    throw new MetaMappingError(`${what} 응답이 목록이나 객체가 아닙니다.`);
  }
}

/** 카테고리 속성·속성값(R04 C5) → 문서(scope = categoryId) */
export function mapProductAttributes(
  categoryId: string,
  attributes: unknown,
  attributeValues: unknown,
): MetaDocument {
  assertListOrObject(attributes, '상품 속성');
  assertListOrObject(attributeValues, '상품 속성값');
  const payload: ProductAttributesPayload = { attributes, attributeValues };
  return toMetaDocument('PRODUCT_ATTRIBUTES', categoryId, payload);
}
