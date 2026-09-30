import { PROVIDED_NOTICE_SCOPE } from '../commerce-meta.constants.js';
import { toMetaDocument, type MetaDocument } from './meta-document.js';
import { isObject, MetaMappingError } from './mapper-utils.js';

/**
 * 상품정보제공고시 `SHOES` 항목(`GET /v1/products-for-provided-notice/SHOES`, R04·F-CT-22) → 문서(scope 'SHOES').
 * 응답은 항목 정의 객체(또는 목록)로 본다. ⑥-3(P3-04)이 고시 매핑·길이 검사에 읽는다.
 */
export function mapProvidedNotice(data: unknown): MetaDocument {
  if (!isObject(data) && !Array.isArray(data)) {
    throw new MetaMappingError('상품정보제공고시 응답이 객체나 목록이 아닙니다.');
  }
  return toMetaDocument('PROVIDED_NOTICE', PROVIDED_NOTICE_SCOPE, data);
}
