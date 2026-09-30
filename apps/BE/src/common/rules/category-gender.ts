/**
 * 네이버 카테고리 경로의 성별 판정(F-CA-06, US-22 AC1, PRD §8.7 RG-04). 순수 함수만 둔다.
 *
 * ④ 카테고리(P2-06)가 리프 후보를 거르고 고르기를 막을 때, 최종 승인 검사(P4-02 F-AP-24)가 성별 일치를 다시 볼 때
 * **같은 함수**를 부른다. 단계 모듈끼리는 서로 import할 수 없어(03-ADR-003) 공용 위치 `common/rules`에 둔다
 * (Proposed — 열린질문 P2-06, 03-2 C4 §3). integrations의 메타 캐시(P1-08 `GENDER_PATH_PREFIX`)도 이 표를 쓴다.
 */

export type CategoryGender = 'MALE' | 'FEMALE';

/** 성별 신발 경로(PRD §8.7 카테고리 확정 1): `whole_category_name`이 이 글자로 시작하는 리프만 그 성별이다 */
export const GENDER_SHOE_PATH_PREFIX: Readonly<Record<CategoryGender, string>> = {
  MALE: '패션잡화>남성신발>',
  FEMALE: '패션잡화>여성신발>',
};

/** 경로 비교용 정리: `>` 앞뒤 공백을 지우고 앞뒤 공백을 뗀다(`패션잡화 > 남성신발` = `패션잡화>남성신발`) */
export function normalizeCategoryPath(wholeCategoryName: string): string {
  return wholeCategoryName.replace(/\s*>\s*/g, '>').trim();
}

/** 카테고리 경로가 가리키는 신발 성별. 성별 신발 경로가 아니면 null */
export function categoryPathGender(wholeCategoryName: string): CategoryGender | null {
  const path = normalizeCategoryPath(wholeCategoryName);
  for (const gender of ['MALE', 'FEMALE'] as const) {
    if (path.startsWith(GENDER_SHOE_PATH_PREFIX[gender])) return gender;
  }
  return null;
}

/**
 * 후보 성별과 카테고리 경로가 맞는가(F-CA-06). `MALE` + `패션잡화>남성신발>…`이면 true, `MALE` + `…여성신발…`·성별 신발
 * 경로가 아닌 리프·성별 없음이면 false.
 */
export function genderPathMatches(
  gender: string | null | undefined,
  wholeCategoryName: string | null | undefined,
): boolean {
  if ((gender !== 'MALE' && gender !== 'FEMALE') || !wholeCategoryName) return false;
  return categoryPathGender(wholeCategoryName) === gender;
}
