import type { FieldError } from '../../../common/errors/error-response.js';

/**
 * 라쿠텐 검색어 형식 규칙(F-SO-02, PRD §8.2 RK-01): 전체 반각 128자 이내, 단어마다 반각 2자 또는 전각 1자 이상
 * (히라가나·가타카나·기호는 2자 이상). 후보 만들기(P1-04)와 ② 검색·`validateRakutenQuery`(P2-02)가 이 함수를 같이 쓴다.
 * P1-04는 전체 길이만 본다. 단어 규칙은 P2-02가 여기에 더한다(같은 함수라 후보 만들기에도 곧바로 적용된다).
 */
export const RAKUTEN_QUERY_MAX_HALF_WIDTH = 128;

/** 전각(East Asian Wide·Fullwidth)이면 2, 그 밖(반각 가타카나 포함)은 1로 센 길이 */
export function halfWidthLength(text: string): number {
  let length = 0;
  for (const char of text) length += isWide(char.codePointAt(0) ?? 0) ? 2 : 1;
  return length;
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // 한글 자모
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK 부수·기호·구두점
    (cp >= 0x3041 && cp <= 0x33ff) || // 히라가나·가타카나·CJK 호환
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 확장 A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 통합 한자
    (cp >= 0xa000 && cp <= 0xa4cf) || // 이 문자
    (cp >= 0xac00 && cp <= 0xd7a3) || // 한글 음절
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 호환 한자
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK 호환 꼴
    (cp >= 0xff00 && cp <= 0xff60) || // 전각 ASCII
    (cp >= 0xffe0 && cp <= 0xffe6) || // 전각 기호
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK 확장 B 이후
  );
}

/** 규칙 위반 목록(field = rakutenQuery). 없으면 빈 배열 → 422 RAKUTEN_QUERY_INVALID의 fieldErrors */
export function checkRakutenQuery(query: string, field = 'rakutenQuery'): FieldError[] {
  const errors: FieldError[] = [];
  const length = halfWidthLength(query);
  if (length > RAKUTEN_QUERY_MAX_HALF_WIDTH) {
    errors.push({
      field,
      message: `검색어는 반각 ${RAKUTEN_QUERY_MAX_HALF_WIDTH}자(전각은 2자로 셉니다) 이내여야 합니다. 지금 ${length}자입니다.`,
    });
  }
  return errors;
}
