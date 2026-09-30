import { toMetaDocument, type MetaDocument } from './meta-document.js';
import { isObject, MetaMappingError } from './mapper-utils.js';

/**
 * 표준옵션(`GET /v1/options/standard-options?categoryId=`, R04 C4) → 문서(scope = categoryId).
 * 응답은 `{ useStandardOption, standardOptionCategoryGroups: [...] }` 객체로 본다. 원문을 통째로 둔다
 * (⑧⑨ P4-02·P4-03이 표준형 옵션 전환에 읽는다).
 */
export function mapStandardOptions(categoryId: string, data: unknown): MetaDocument {
  if (!isObject(data)) throw new MetaMappingError('표준옵션 응답이 객체가 아닙니다.');
  return toMetaDocument('STANDARD_OPTIONS', categoryId, data);
}
