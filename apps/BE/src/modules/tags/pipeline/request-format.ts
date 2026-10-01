/**
 * ⑦ 태그 전송 형식(F-TG-12, PRD §8.6 6, R04 2.7, P3-05 규칙 12). 순수 함수 — P4-03 등록 본문
 * `originProduct.detailAttribute.seoInfo.sellerTags[]`와 승인 미리보기가 같은 모양을 쓴다.
 * - 추천(사전) 태그와 정확히(정규화 키) 같으면 `{ code, text }` — `code`는 추천 응답의 숫자 글자, `text`는 추천의 글자 그대로
 *   (짝이 다르면 등록이 실패한다)
 * - 아니면 `{ text }`만(직접 입력 태그 — '사전 미등록'일 수 있다)
 */

export type SellerTag = { code: string; text: string } | { text: string };

export interface FinalTagSource {
  text: string;
  code: string | null;
  finalOrder: number | null;
}

export function toSellerTag(tag: { text: string; code: string | null }): SellerTag {
  return tag.code !== null && /^[0-9]+$/.test(tag.code)
    ? { code: tag.code, text: tag.text }
    : { text: tag.text };
}

/** 최종 태그(SELECTED)를 `final_order` 순으로 전송 형식으로 */
export function sellerTagsOf(tags: readonly FinalTagSource[]): SellerTag[] {
  return tags
    .filter((tag): tag is FinalTagSource & { finalOrder: number } => tag.finalOrder !== null)
    .sort((a, b) => a.finalOrder - b.finalOrder)
    .map(toSellerTag);
}

/** '사전 미등록' 경고(F-TG-14): 오너가 더했고 추천(사전) 코드가 없다 */
export function isDictionaryUnregistered(tag: {
  ownerAdded: boolean;
  code: string | null;
}): boolean {
  return tag.ownerAdded && tag.code === null;
}
