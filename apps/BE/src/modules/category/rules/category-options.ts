import { genderPathMatches, type CategoryGender } from '../../../common/rules/category-gender.js';
import type { CategoryLeafMapping } from '../../settings/schema/settings.types.js';
import { childCategoryReason } from './category-exception.js';

/**
 * ④ 리프 카테고리 후보 뽑기(F-CA-02·04, PRD §8.7 카테고리 확정 1, P2-06 규칙 3~5). 순수 함수만 둔다.
 * 매핑표 + 리프 캐시 + 후보 성별 → `{ candidateSource, options[] }`.
 *
 * 1. 매핑표(설정 `category.leafMapping`)에서 ② 장르 경로의 **가장 깊은** 장르에 맞는 줄을 찾는다. 그 장르에 상품유형이 같은
 *    줄이 있으면 그 줄만, 없으면 상품유형 없는 줄을 쓴다(Proposed).
 * 2. 뽑은 리프 id를 캐시에서 찾아 `removed_at`이 없고 `whole_category_name`이 성별 경로(패션잡화>남성신발>… /
 *    …여성신발>…)로 시작하는 것만 남긴다(매핑표 순서). → `MAPPING`
 * 3. 장르가 없거나 매핑표에 없는 장르거나, 2에서 남은 리프가 없으면(캐시가 바뀜 — Proposed) 성별 경로의 신발 리프 전체
 *    (`removed_at` 없음, 전체 경로 순) → `GENDER_PATH_ALL`
 * 4. 어느 쪽이든 아동 카테고리(어린이 인증 예외 유형·아동 카테고리 말)는 넣기 전에 뺀다. 판매 제외 품목(CON-08)은 목록에
 *    남기고 조회 때 `blocked`로 보인다(F-CA-04는 아동만 뺀다고 적었다).
 * `category_options` jsonb에는 `{ leafCategoryId, wholeCategoryName }`만 넣는다(ERD — 예외 표시는 조회 때 계산).
 */

export type CategoryCandidateSource = 'MAPPING' | 'GENDER_PATH_ALL';

/** 캐시 리프 한 개(`commerce_category`) */
export interface CategoryLeaf {
  categoryId: string;
  name: string;
  wholeCategoryName: string;
  exceptionalCategories: readonly string[];
  removedAt: Date | null;
}

/** `category_options` 한 항목 */
export interface CategoryOptionEntry {
  leafCategoryId: string;
  wholeCategoryName: string;
}

export interface CategoryOptionsInput {
  gender: CategoryGender;
  /** ② 장르 경로(루트 → 리프). 장르가 없으면 빈 배열 */
  genreIdPath: readonly number[];
  productType: string | null;
  mapping: readonly CategoryLeafMapping[];
  /** 리프 캐시(성별 경로 전체 + 매핑 리프를 넣는다 — 다른 성별·사라진 행이 섞여도 여기서 거른다) */
  leaves: readonly CategoryLeaf[];
  /** 아동 카테고리 말(설정 `safety.childCategoryWords`) */
  childCategoryWords: readonly string[];
}

export interface CategoryOptionsResult {
  candidateSource: CategoryCandidateSource;
  options: CategoryOptionEntry[];
  /** 매핑표에서 맞은 장르 id(없으면 null) */
  mappedGenreId: number | null;
}

/** 매핑표에서 ② 장르에 맞는 리프 id(가장 깊은 장르 우선, 상품유형이 같은 줄 우선). 맞는 줄이 없으면 null */
export function mappedLeafIds(
  mapping: readonly CategoryLeafMapping[],
  genreIdPath: readonly number[],
  productType: string | null,
): { genreId: number; leafCategoryIds: string[] } | null {
  for (let i = genreIdPath.length - 1; i >= 0; i -= 1) {
    const genreId = genreIdPath[i]!;
    const rows = mapping.filter((row) => row.genreId === genreId);
    if (rows.length === 0) continue;
    const typed =
      productType !== null ? rows.filter((row) => (row.productType ?? null) === productType) : [];
    const chosen =
      typed.length > 0 ? typed : rows.filter((row) => (row.productType ?? null) === null);
    if (chosen.length === 0) continue;
    const ids = [...new Set(chosen.flatMap((row) => row.leafCategoryIds))];
    return { genreId, leafCategoryIds: ids };
  }
  return null;
}

function compareLeaf(a: CategoryLeaf, b: CategoryLeaf): number {
  return (
    a.wholeCategoryName.localeCompare(b.wholeCategoryName, 'ko') ||
    a.categoryId.localeCompare(b.categoryId)
  );
}

function toEntry(leaf: CategoryLeaf): CategoryOptionEntry {
  return { leafCategoryId: leaf.categoryId, wholeCategoryName: leaf.wholeCategoryName };
}

/** 리프 후보(규칙 3·4·5) */
export function categoryOptionsOf(input: CategoryOptionsInput): CategoryOptionsResult {
  const usable = new Map<string, CategoryLeaf>();
  for (const leaf of input.leaves) {
    if (leaf.removedAt !== null) continue;
    if (!genderPathMatches(input.gender, leaf.wholeCategoryName)) continue;
    if (childCategoryReason(leaf, input.childCategoryWords)) continue;
    if (!usable.has(leaf.categoryId)) usable.set(leaf.categoryId, leaf);
  }
  const mapped = mappedLeafIds(input.mapping, input.genreIdPath, input.productType);
  if (mapped) {
    const options = mapped.leafCategoryIds
      .map((id) => usable.get(id))
      .filter((leaf): leaf is CategoryLeaf => leaf !== undefined)
      .map(toEntry);
    if (options.length > 0) {
      return { candidateSource: 'MAPPING', options, mappedGenreId: mapped.genreId };
    }
  }
  return {
    candidateSource: 'GENDER_PATH_ALL',
    options: [...usable.values()].sort(compareLeaf).map(toEntry),
    mappedGenreId: null,
  };
}

/** jsonb `category_options` → 항목 목록(모양이 어긋난 항목은 버린다) */
export function parseCategoryOptions(value: unknown): CategoryOptionEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (v): v is CategoryOptionEntry =>
        !!v &&
        typeof v === 'object' &&
        typeof (v as { leafCategoryId?: unknown }).leafCategoryId === 'string' &&
        typeof (v as { wholeCategoryName?: unknown }).wholeCategoryName === 'string',
    )
    .map((v) => ({ leafCategoryId: v.leafCategoryId, wholeCategoryName: v.wholeCategoryName }));
}
