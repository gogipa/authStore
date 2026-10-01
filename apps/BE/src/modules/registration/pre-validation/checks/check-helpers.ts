import { htmlText } from '../../../../common/rules/detail-html.js';
import type { StepCode } from '../../../step-engine/domain/steps.js';
import type {
  PreValidationCheck,
  PreValidationCheckCode,
  PreValidationGateCode,
} from '../pre-validation.types.js';

/** 통과 항목 */
export function passed(checkCode: PreValidationCheckCode): PreValidationCheck {
  return {
    checkCode,
    passed: true,
    severity: 'BLOCK',
    reason: null,
    stepCode: null,
    gateCode: null,
  };
}

/** 실패 사유 한 줄(고칠 단계·게이트 포함) */
export interface CheckProblem {
  message: string;
  stepCode: StepCode | null;
  gateCode?: PreValidationGateCode | null;
}

/**
 * 문제 목록 → 항목(없으면 통과). 사유는 ' · '로 잇고, 고칠 단계·게이트는 첫 문제의 것이다(화면 링크 하나 — 규칙 13 '최신이 아닌
 * 단계마다 stepCode(게이트면 gateCode)를 채워 링크를 단다')
 */
export function resultOf(
  checkCode: PreValidationCheckCode,
  problems: readonly CheckProblem[],
): PreValidationCheck {
  if (problems.length === 0) return passed(checkCode);
  const first = problems[0]!;
  return {
    checkCode,
    passed: false,
    severity: 'BLOCK',
    reason: problems.map((problem) => problem.message).join(' · '),
    stepCode: first.stepCode,
    gateCode: first.gateCode ?? null,
  };
}

/**
 * 문구 비교 키(P4-02 Proposed — P3-04 상품명 금지 수식어와 같은 방식): NFKC → 소문자 → 공백 모두 제거. '일본 제품'과 '일본제품',
 * '정품 100%'와 '정품100％'를 같게 본다.
 */
export function wordingKey(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}

/**
 * 글 안에서 찾은 말(설정 순서, 겹치지 않게). 일치 방식은 **부분 일치**다(P4-02 Proposed — '공식'은 '비공식'에도 걸린다. 막는 쪽으로
 * 틀리는 편이 안전하다: 오너가 문구를 고치면 된다).
 */
export function findWords(texts: readonly string[], words: readonly string[]): string[] {
  const keys = texts.map(wordingKey);
  const found: string[] = [];
  for (const word of words) {
    const key = wordingKey(word);
    if (key === '' || found.includes(word)) continue;
    if (keys.some((text) => text.includes(key))) found.push(word);
  }
  return found;
}

/** 상세 HTML의 평문(태그 떼기·엔티티 풀기 — common/rules `htmlText`) */
export function detailText(html: string | null | undefined): string {
  return html ? htmlText(html) : '';
}

/** 상세 HTML 안 모든 `<img src="…">` 주소(엔티티 풀기) */
export function imageSourcesOf(html: string | null | undefined): string[] {
  if (!html) return [];
  const out: string[] = [];
  for (const match of html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*"([^"]*)"/giu)) {
    out.push(
      match[1]!
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&'),
    );
  }
  return out;
}

/** 상품명 글자 수 — 코드 포인트(P3-04 `productNameLength`와 같은 기준, P4-02 Proposed) */
export function productNameLength(name: string): number {
  return [...name].length;
}

/** 상품명 최대 글자 수(F-AP-11, US-17 AC1) */
export const PRODUCT_NAME_MAX = 100;

/** 따옴표로 묶은 목록('a', 'b') */
export function quoted(words: readonly string[]): string {
  return words.map((word) => `'${word}'`).join(', ');
}
