/**
 * 예시 가게 정보(구매대행 프로필 — 설정·⑥-3 고시·고지·승인 미리보기에 같은 값이 보인다). FE fixture는 `[내 상호]`처럼 자리표시자를
 * 쓰는데, 체험에서는 채운 모습을 보이려고 응답을 보내기 전에 예시 값으로 바꾼다(`fillShop` — demoApi·⑥-3 미리보기 문서).
 */
export const DEMO_SHOP = {
  businessName: '정복상회(예시)',
  afterServicePhone: '010-0000-0000(예시)',
  afterServiceGuide: '평일 10:00~18:00 톡톡으로 문의해 주세요.',
  importer: '정복상회(예시)',
} as const;

const PLACEHOLDERS: readonly (readonly [string, string])[] = [
  ['[내 상호]', DEMO_SHOP.businessName],
  ['[수입자]', DEMO_SHOP.importer],
  ['[A/S 연락처]', DEMO_SHOP.afterServicePhone],
  ['[A/S 안내]', DEMO_SHOP.afterServiceGuide],
];

/** fixture 글의 자리표시자를 예시 가게 값으로 바꾼다(JSON 글에 그대로 써도 된다 — 바꾸는 값에 따옴표·역슬래시가 없다) */
export function fillShop(text: string): string {
  return PLACEHOLDERS.reduce((out, [from, to]) => out.split(from).join(to), text);
}
