import { toMetaDocument, type MetaDocument } from './meta-document.js';
import { isObject, MetaMappingError, uniqueBy } from './mapper-utils.js';

/** 예외 유형 한 값의 최대 길이(commerce_category.exceptional_categories varchar(40)[]) */
const EXCEPTIONAL_MAX = 40;

/** 카테고리 상세(`GET /v1/categories/{id}`, R04 C2) → 예외 유형 + 원문 문서 */
export interface CategoryDetail {
  categoryId: string;
  /** CHILD_CERTIFICATION·KC_CERTIFICATION 등 외부 값(CHECK 없음) */
  exceptionalCategories: string[];
  document: MetaDocument;
}

/**
 * 상세 응답은 객체 `{ id, name, wholeCategoryName, exceptionalCategories: [...], certificationInfos: [...] }`로 본다.
 * `exceptionalCategories` 항목은 글자이거나 `{ code | name | type }` 객체(둘 다 받는다). 없으면 빈 배열.
 */
export function mapCategoryDetail(categoryId: string, data: unknown): CategoryDetail {
  if (!isObject(data)) throw new MetaMappingError('카테고리 상세 응답이 객체가 아닙니다.');
  const raw = data.exceptionalCategories;
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
    throw new MetaMappingError('카테고리 상세의 exceptionalCategories가 목록이 아닙니다.');
  }
  const values: string[] = [];
  for (const entry of (raw as unknown[] | null | undefined) ?? []) {
    const value =
      typeof entry === 'string'
        ? entry
        : isObject(entry)
          ? [entry.code, entry.name, entry.type].find((v): v is string => typeof v === 'string')
          : undefined;
    if (!value || value.trim() === '') continue;
    const trimmed = value.trim();
    if (trimmed.length > EXCEPTIONAL_MAX) {
      throw new MetaMappingError(`카테고리 상세의 예외 유형이 ${EXCEPTIONAL_MAX}자를 넘습니다.`);
    }
    values.push(trimmed);
  }
  return {
    categoryId,
    exceptionalCategories: uniqueBy(values, (v) => v),
    document: toMetaDocument('CATEGORY_DETAIL', categoryId, data),
  };
}
