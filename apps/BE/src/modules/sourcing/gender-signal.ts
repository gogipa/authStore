/**
 * ② 성별 신호(PRD §8.2 RK-05: 키워드 cid, 라쿠텐 장르 경로 メンズ靴 110983 / レディース靴 100480, 상품명). 순수 함수.
 * P2-02는 URL로 만들기에서 장르 경로·상품명만 본다(키워드 cid와 신호끼리 다를 때의 우선순위·성별 입력 대기는 P2-03 F-SO-18·19).
 * 신호가 서로 다르거나(남·여 둘 다) 없으면 null(판단 불가).
 */
export const GENDER_GENRE_IDS = { MALE: 110983, FEMALE: 100480 } as const;

// 'ウィメンズ'(women's)에 'メンズ'가 들어 있어 앞 글자가 ィ·イ면 남성으로 보지 않는다
const MALE_PATTERNS = [/(?<![ィイ])メンズ/, /男性/, /紳士/, /\bmen'?s\b/];
const FEMALE_PATTERNS = [
  /ウ[ィイ]メンズ/,
  /レディース/,
  /女性/,
  /婦人/,
  /\bwomen'?s\b/,
  /\bladies\b/,
];

export type DetectedGender = { gender: 'MALE' | 'FEMALE'; basis: 'GENRE_PATH' | 'ITEM_NAME' };

export function genderFromGenrePath(idPath: readonly number[] | null): 'MALE' | 'FEMALE' | null {
  if (!idPath) return null;
  const male = idPath.includes(GENDER_GENRE_IDS.MALE);
  const female = idPath.includes(GENDER_GENRE_IDS.FEMALE);
  return male === female ? null : male ? 'MALE' : 'FEMALE';
}

export function genderFromItemName(name: string): 'MALE' | 'FEMALE' | null {
  const text = name.normalize('NFKC').toLowerCase();
  const male = MALE_PATTERNS.some((re) => re.test(text));
  const female = FEMALE_PATTERNS.some((re) => re.test(text));
  return male === female ? null : male ? 'MALE' : 'FEMALE';
}

/** 장르 경로 먼저, 없으면 상품명(Proposed). 판단할 수 없으면 null */
export function detectGender(input: {
  genreIdPath: readonly number[] | null;
  itemName: string;
}): DetectedGender | null {
  const byGenre = genderFromGenrePath(input.genreIdPath);
  if (byGenre) return { gender: byGenre, basis: 'GENRE_PATH' };
  const byName = genderFromItemName(input.itemName);
  return byName ? { gender: byName, basis: 'ITEM_NAME' } : null;
}
