import {
  CATEGORY_BLOCK_WORDS,
  type CategoryBlockReason,
  CHILD_CERTIFICATION,
  GENDER_PATH_PREFIX,
  type ShoeGender,
} from './commerce-meta.constants.js';

/** 카테고리 거르기에 필요한 칸 */
export interface CategoryForRules {
  name: string;
  wholeCategoryName: string;
  exceptionalCategories: readonly string[];
}

/** 성별 신발 경로 리프인지(`패션잡화>남성신발>`·`패션잡화>여성신발>`로 시작) */
export function isGenderShoeLeaf(wholeCategoryName: string, gender?: ShoeGender): boolean {
  const prefixes = gender ? [GENDER_PATH_PREFIX[gender]] : Object.values(GENDER_PATH_PREFIX);
  return prefixes.some((prefix) => wholeCategoryName.startsWith(prefix));
}

/**
 * 고를 수 없는 카테고리인지와 그 이유(F-CA-04·F-CA-07, PRD §8.7 RG-04). 없으면 null.
 * 1. 카테고리 상세의 예외 유형에 CHILD_CERTIFICATION → 'CHILD_CERTIFICATION'
 * 2. 이름·전체 경로에 아동 말(아동·키즈…) → 'CHILD_CATEGORY'
 * 3. 이름·전체 경로에 CON-08 제외 품목 말(바퀴·실버…) → 'CON08_EXCLUDED' (말 목록은 Proposed)
 */
export function categoryBlockReason(category: CategoryForRules): CategoryBlockReason | null {
  if (category.exceptionalCategories.includes(CHILD_CERTIFICATION)) return 'CHILD_CERTIFICATION';
  const text = `${category.wholeCategoryName} ${category.name}`;
  for (const reason of ['CHILD_CATEGORY', 'CON08_EXCLUDED'] as const) {
    if (CATEGORY_BLOCK_WORDS[reason].some((word) => text.includes(word))) return reason;
  }
  return null;
}

/** 목록 정렬(전체 경로, 한국어 순서, 같으면 id) */
export function compareWholeCategoryName(
  a: { wholeCategoryName: string; id: number },
  b: { wholeCategoryName: string; id: number },
): number {
  return a.wholeCategoryName.localeCompare(b.wholeCategoryName, 'ko') || a.id - b.id;
}
