/**
 * ⑦ 태그 정규화(F-TG-07, US-18 AC3, P3-05 규칙 7). 순수 함수.
 * 순서: NFKC(전각 영숫자·기호를 반각으로 — P3-05 Proposed) → '#' 제거 → 앞뒤 공백 제거 → 연속 공백을 한 칸으로 → 영문 소문자.
 * 정규화한 글자가 정규화 키(`tag_candidate.text_key`·`tag_owner_edit.text_key`)이고, 키가 같으면 한 후보다.
 * 추천(사전) 태그와 키가 같은 태그는 추천의 `text`(API 글자 그대로)를 보내고, 그 밖의 태그는 정규화한 글자를 그대로 보낸다.
 */

/** 태그 글자 상한(tag_candidate.text·text_key varchar(100)) */
export const TAG_TEXT_MAX = 100;

export function normalizeTagText(raw: string): string {
  return raw.normalize('NFKC').replace(/#/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 정규화 키(= 정규화한 글자) */
export function tagKeyOf(raw: string): string {
  return normalizeTagText(raw);
}

/** 정규화 키로 중복을 없앤다(처음 나온 것을 남기고 순서는 그대로). 빈 키는 뺀다 */
export function dedupeTags(raws: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of raws) {
    const key = tagKeyOf(raw);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * 비교용 글자(규칙 사전과 태그를 맞춰 볼 때): 정규화 뒤 공백까지 없앤다(Proposed — '아식스 운동화'와 '아식스운동화'를 같은 말로 본다)
 */
export function compactOf(raw: string): string {
  return normalizeTagText(raw).replace(/ /g, '');
}
