import { PRODUCT_NAME_MAX } from './product-name.builder.js';

/**
 * 상품명 경고(P3-04 규칙 13·14, F-CT-33·34, US-17 AC1·AC2). 막지 않는다 — 조회(`GET …/content-assembly`의 `productNameWarnings`)와
 * 오너 수정 응답(`warnings[]`)에서 계산해 준다(05-1 §7.4-33: M1은 저장하지 않는다. 최종 승인 검사 RG-08이 100자를 막는다).
 * 경고 코드(Proposed — 05-3 §5.2에 더했다):
 * - `PRODUCT_NAME_TOO_LONG`: 100자(코드 포인트) 초과
 * - `PRODUCT_NAME_BANNED_WORD`: 금지 수식어(설정 `content.productNameBannedWords`)가 들어 있음(NFKC·대소문자·공백 무시)
 * - `PRODUCT_NAME_REPEATED_WORD`: 같은 낱말(공백으로 나눈 조각, NFKC·대소문자 무시)이 두 번 이상
 */
export interface ProductNameWarning {
  code: 'PRODUCT_NAME_TOO_LONG' | 'PRODUCT_NAME_BANNED_WORD' | 'PRODUCT_NAME_REPEATED_WORD';
  message: string;
}

function compare(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}

export function productNameLength(name: string): number {
  return [...name].length;
}

export function productNameWarnings(
  name: string,
  bannedWords: readonly string[],
): ProductNameWarning[] {
  const out: ProductNameWarning[] = [];
  const length = productNameLength(name);
  if (length > PRODUCT_NAME_MAX) {
    out.push({
      code: 'PRODUCT_NAME_TOO_LONG',
      message: `상품명이 ${length}자로 ${PRODUCT_NAME_MAX}자를 넘습니다. 최종 승인 전에 줄여 주세요.`,
    });
  }
  const key = compare(name);
  const banned = bannedWords.filter((word) => {
    const w = compare(word);
    return w !== '' && key.includes(w);
  });
  for (const word of [...new Set(banned)]) {
    out.push({
      code: 'PRODUCT_NAME_BANNED_WORD',
      message: `금지 수식어 '${word}'가 들어 있습니다.`,
    });
  }
  const counts = new Map<string, { word: string; count: number }>();
  for (const word of name.normalize('NFKC').trim().split(/\s+/)) {
    if (word === '') continue;
    const k = word.toLowerCase();
    const entry = counts.get(k) ?? { word, count: 0 };
    entry.count += 1;
    counts.set(k, entry);
  }
  for (const { word, count } of counts.values()) {
    if (count > 1) {
      out.push({
        code: 'PRODUCT_NAME_REPEATED_WORD',
        message: `같은 낱말 '${word}'가 ${count}번 나옵니다.`,
      });
    }
  }
  return out;
}
