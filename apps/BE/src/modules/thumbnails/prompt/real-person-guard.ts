import { REAL_PERSON_BUILTIN_TERMS } from './real-person-builtin.js';

/**
 * 실존 인물 이름 차단(F-TH-10, US-13 AC1, P3-01 규칙 13·14) — 순수 함수. 미리보기(P3-01)와 생성 요청의 서버 재검사(P3-02,
 * 422 REAL_PERSON_NAME_BLOCKED)가 같은 함수를 쓴다.
 *
 * 비교 방식(Proposed — 문서에 없음, 오너 검토):
 * 1. 프롬프트와 차단어를 모두 **NFKC**(전각 → 반각, 호환 문자 합치기) → **소문자**로 맞춘다
 * 2. 차단어 안의 **공백은 무시**한다: 차단어에서 공백을 모두 빼고, 프롬프트 쪽은 글자 사이 공백(0개 이상)을 허용해 찾는다
 *    ('Stray Kids' = 'straykids' = 'STRAY  KIDS', '스트레이 키즈' = '스트레이키즈')
 * 3. 차단어 앞뒤 글자가 영문·숫자면 **단어 경계**를 본다(영문자·숫자가 붙어 있으면 다른 낱말): 'BTS'는 'BTS-style'·'(bts)'에
 *    걸리고 'debts'·'btsx'에는 걸리지 않는다. 한글·가나 등은 붙여 써도 걸린다('뉴진스스타일' → 뉴진스)
 * 4. 걸린 차단어는 사전에 적힌 표기 그대로, 사전 순서대로, 겹침 없이 돌려준다
 */

/** 비교용 정규화: NFKC + 소문자 */
export function normalizeForGuard(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

const ASCII_ALNUM = /[a-z0-9]/;

function escapeRegExp(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 차단어 하나 → 찾기 정규식(정규화한 프롬프트에 쓴다). 공백만인 차단어는 null */
export function blockTermPattern(term: string): RegExp | null {
  const chars = [...normalizeForGuard(term).replace(/\s+/gu, '')];
  if (chars.length === 0) return null;
  const body = chars.map(escapeRegExp).join('\\s*');
  const head = ASCII_ALNUM.test(chars[0]!) ? '(?<![a-z0-9])' : '';
  const tail = ASCII_ALNUM.test(chars[chars.length - 1]!) ? '(?![a-z0-9])' : '';
  return new RegExp(`${head}${body}${tail}`, 'u');
}

/** 사전 = 앱 내장 ∪ 설정 추가분(정규화해 같은 단어는 한 번, 내장 먼저) */
export function personBlockDictionary(settingsTerms: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of [...REAL_PERSON_BUILTIN_TERMS, ...settingsTerms]) {
    const key = normalizeForGuard(term).replace(/\s+/gu, '');
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

/**
 * 프롬프트(골격·해상도·얼굴 옵션·조정 문구를 모두 채운 **전체**)에서 차단어를 찾는다. `terms`는 보통
 * `personBlockDictionary(settings.safety.personBlockWords)`(내장 ∪ 설정)다.
 */
export function findBlockedTerms(prompt: string, terms: readonly string[]): string[] {
  const text = normalizeForGuard(prompt);
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    const pattern = blockTermPattern(term);
    if (!pattern || !pattern.test(text)) continue;
    const key = normalizeForGuard(term).replace(/\s+/gu, '');
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(term);
  }
  return hits;
}
