/**
 * 구매대행 고지 조건부 블록의 판정 규칙(P3-04 규칙 4 — P4-02에서 content → common/rules로 옮김). ⑥-3 렌더러(content)와 최종 승인
 * 사전 검증 `NOTICE_BLOCK`(F-AP-15 '조건부 고지(가죽 등)가 들었는가', registration)이 같은 함수를 쓴다 — 단계 모듈끼리 import하지
 * 않으므로(03-ADR-003) 공용 위치에 한 곳으로 둔다. content `disclosure/conditional-blocks.ts`는 같은 이름을 다시 내보낸다.
 * - LEATHER_OR_UNKNOWN_MATERIAL: ⑥-2 소재(겉감·안감·밑창)에 천연·인조 가죽이 있거나 겉감이 '정보 없음'이면 안전관리대상 문장.
 *   가죽 판정 = 설정 `notice.leatherTerms`의 말이 소재 글에 들어 있음(NFKC·대문자·공백 무시)
 */

/** ⑥-2 소재 세 칸(정보 없음 = null) */
export interface DisclosureMaterials {
  upper: string | null;
  lining: string | null;
  sole: string | null;
}

function compare(text: string): string {
  return text.normalize('NFKC').toUpperCase().replace(/\s+/gu, '');
}

/** 소재 글에 가죽 말이 있는가 */
export function hasLeather(materials: DisclosureMaterials, terms: readonly string[]): boolean {
  const texts = [materials.upper, materials.lining, materials.sole]
    .filter((t): t is string => t !== null)
    .map(compare);
  return terms.some((term) => {
    const key = compare(term);
    return key !== '' && texts.some((text) => text.includes(key));
  });
}

/** 안전관리대상 문장을 붙이는가(가죽 또는 겉감 정보 없음) */
export function needsLeatherNotice(
  materials: DisclosureMaterials,
  terms: readonly string[],
): boolean {
  return materials.upper === null || hasLeather(materials, terms);
}
