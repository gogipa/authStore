import {
  clip,
  isObject,
  listOf,
  MetaMappingError,
  requiredText,
  uniqueBy,
} from './mapper-utils.js';

/** commerce_category에 쓰는 리프 한 줄(`GET /v1/categories?last=true`, R04 C1) */
export interface CategoryRow {
  /** 네이버 리프 카테고리 ID(varchar(20)) */
  categoryId: string;
  name: string;
  /** 전체 경로(예 '패션잡화>남성신발>운동화>러닝화') */
  wholeCategoryName: string;
}

/**
 * 리프 카테고리 목록 → 행. 응답은 최상위 배열 `[{ id, name, wholeCategoryName, last }]`로 본다(R04 C1).
 * `last: false`(리프 아님)는 뺀다. 같은 id는 처음 것만. 목록이 비면 오류(다 사라진 것으로 보고 캐시를 지우지 않게).
 */
export function mapCategories(data: unknown): CategoryRow[] {
  const items = listOf(data, ['categories', 'contents', 'content'], '카테고리 목록');
  const rows: CategoryRow[] = [];
  for (const item of items) {
    if (!isObject(item)) throw new MetaMappingError('카테고리 목록 항목이 객체가 아닙니다.');
    if (item.last === false) continue;
    rows.push({
      categoryId: requiredText(item, ['id', 'categoryId'], '카테고리 목록 항목', 20),
      name: clip(requiredText(item, ['name'], '카테고리 목록 항목', 10_000), 100),
      wholeCategoryName: requiredText(item, ['wholeCategoryName'], '카테고리 목록 항목', 500),
    });
  }
  if (rows.length === 0) throw new MetaMappingError('카테고리 목록 응답이 비어 있습니다.');
  return uniqueBy(rows, (r) => r.categoryId);
}
