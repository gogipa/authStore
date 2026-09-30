/**
 * 카테고리 이름·경로로 아동 카테고리와 CON-08 판매 제외 품목을 가르는 내장 말(Proposed — 열린질문 P2-06 '가르는 기준이
 * 문서에 없다', 오너 검토). P1-08 메타 캐시 목록(`listCommerceCategories`)이 먼저 정한 말을 그대로 옮겼다.
 *
 * - 설정 `safety.childCategoryWords`·`safety.excludedCategoryWords`(P2-06)는 이 목록에 **더할 수만** 있다(F-BS-05와 같은 방식 —
 *   빼면 settings 안전 기준 하한이 파일을 거부한다).
 * - ④ 카테고리(P2-06)는 설정 목록으로, 메타 캐시 목록(P1-08)은 이 내장 목록으로 거른다.
 * - 이름이 아니라 말이라 카테고리 개편(id 변경)에도 버틴다. 카테고리 id는 코드에 박지 않는다(RG-03).
 */

/** 아동 카테고리(아동화 — 만 13세 이하, CON-08·어린이제품법). 경로·이름에 들어 있으면 고를 수 없다 */
export const BUILTIN_CHILD_CATEGORY_WORDS: readonly string[] = [
  '아동',
  '키즈',
  '주니어',
  '유아',
  '베이비',
];

/** CON-08 판매 제외 품목(바퀴 달린 운동화·고령자용 신발, PRD §8 CON-08 표 — 보수적 기본 제외) */
export const BUILTIN_EXCLUDED_CATEGORY_WORDS: readonly string[] = [
  '바퀴',
  '롤러',
  '힐리스',
  '실버',
  '효도',
];

/** 비교용 정리: NFKC → 소문자 → 앞뒤 공백 제거(아동 단어 공통 규칙과 같다) */
function normalizeWord(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim();
}

/** 글자들 가운데 처음 걸린 말(목록 순서). 없으면 null. 빈 말은 건너뛴다 */
export function findCategoryWord(
  texts: readonly (string | null | undefined)[],
  words: readonly string[],
): string | null {
  const haystack = texts
    .filter((t): t is string => typeof t === 'string')
    .map(normalizeWord)
    .join('\n');
  for (const word of words) {
    const needle = normalizeWord(word);
    if (needle !== '' && haystack.includes(needle)) return word;
  }
  return null;
}
