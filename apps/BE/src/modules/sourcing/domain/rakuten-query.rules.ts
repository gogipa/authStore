import type { FieldError } from '../../../common/errors/error-response.js';

/**
 * 라쿠텐 검색어 형식 규칙(F-SO-02, PRD §8.2 RK-01): 전체 반각 128자 이내, 단어마다 반각 2자 또는 전각 1자 이상
 * (히라가나·가타카나·기호는 2자 이상). 후보 만들기(P1-04)·② 시작(P2-02 실행기 `beforeStart`)·`validateRakutenQuery`
 * (P2-02)가 이 파일의 함수를 같이 쓴다(순수 함수 — step-engine이 import해도 단계 모듈 서비스를 부르지 않는다).
 *
 * 반각 환산(Proposed, P2-02 — 문서에 없음, PRD §8.2·05-1 §7.3): 전각(East Asian Wide·Fullwidth) 1자 = 반각 2자.
 * 반각 가타카나(ｱｼｯｸｽ)는 반각 1자. 단어는 공백(반각·전각 U+3000)으로 나눈다.
 */
export const RAKUTEN_QUERY_MAX_HALF_WIDTH = 128;

/** 검사 규칙 코드(05-2 RakutenQueryViolation.rule) */
export type RakutenQueryRule = 'TOO_LONG' | 'WORD_TOO_SHORT';

export interface RakutenQueryViolation {
  rule: RakutenQueryRule;
  /** 걸린 단어(WORD_TOO_SHORT). TOO_LONG은 null */
  word: string | null;
  /** 화면 문구(한국어) */
  message: string;
}

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

/** 히라가나·가타카나(전각·반각)·장음 기호 */
function isKana(cp: number): boolean {
  return (
    (cp >= 0x3040 && cp <= 0x30ff) || // 히라가나·가타카나(ー 포함)
    (cp >= 0x31f0 && cp <= 0x31ff) || // 가타카나 확장
    (cp >= 0xff65 && cp <= 0xff9f) // 반각 가타카나
  );
}

const SYMBOL_RE = /^[\p{P}\p{S}]$/u;

/** 기호(구두점·기호 문자) */
function isSymbol(char: string): boolean {
  return SYMBOL_RE.test(char);
}

/** 검색어를 단어로 나눈다(반각·전각 공백). 빈 단어는 뺀다 */
export function splitQueryWords(query: string): string[] {
  return query.split(/[\s\u3000]+/u).filter((word) => word !== '');
}

/**
 * 단어 하나가 최소 길이를 채우는가(PRD §8.2 RK-01).
 * - 히라가나·가타카나·기호로만 된 단어: 2자 이상
 * - 그 밖 전각 글자(한자·한글·전각 영숫자 등)가 하나라도 있으면: 1자 이상(= 전각 1자)
 * - 반각만 있는 단어: 반각 2자 이상
 */
export function isWordLongEnough(word: string): boolean {
  const chars = [...word];
  if (chars.length === 0) return false;
  const kanaOrSymbol = chars.every((c) => isKana(c.codePointAt(0) ?? 0) || isSymbol(c));
  if (kanaOrSymbol) return chars.length >= 2;
  const hasOtherWide = chars.some((c) => {
    const cp = c.codePointAt(0) ?? 0;
    return isWide(cp) && !isKana(cp) && !isSymbol(c);
  });
  if (hasOtherWide) return true;
  return halfWidthLength(word) >= 2;
}

/** 규칙 위반 목록(순서: 전체 길이 → 단어 순서). 없으면 빈 배열 */
export function rakutenQueryViolations(query: string): RakutenQueryViolation[] {
  const violations: RakutenQueryViolation[] = [];
  const length = halfWidthLength(query);
  if (length > RAKUTEN_QUERY_MAX_HALF_WIDTH) {
    violations.push({
      rule: 'TOO_LONG',
      word: null,
      message: `검색어는 반각 ${RAKUTEN_QUERY_MAX_HALF_WIDTH}자(전각은 2자로 셉니다) 이내여야 합니다. 지금 ${length}자입니다.`,
    });
  }
  for (const word of splitQueryWords(query)) {
    if (!isWordLongEnough(word)) {
      violations.push({
        rule: 'WORD_TOO_SHORT',
        word,
        message: `'${word}'이(가) 너무 짧습니다. 단어마다 반각 2자 또는 전각 1자 이상(히라가나·가타카나·기호는 2자 이상)이어야 합니다.`,
      });
    }
  }
  return violations;
}

/** 규칙 위반 목록(field = rakutenQuery). 없으면 빈 배열 → 422 RAKUTEN_QUERY_INVALID의 fieldErrors */
export function checkRakutenQuery(query: string, field = 'rakutenQuery'): FieldError[] {
  return rakutenQueryViolations(query).map((v) => ({ field, message: v.message }));
}
