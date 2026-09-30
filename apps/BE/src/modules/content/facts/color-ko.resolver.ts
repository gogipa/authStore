import type { ColorTermEntry } from '../../settings/schema/settings.types.js';
import type { FieldDraft } from '../fields/content-field.store.js';
import { COLOR_KO_FIELD_KEY } from '../fields/field-keys.js';
import { compareKey } from './fact-text.js';

/**
 * 색상 한국어 표기(P3-04 규칙 6, F-CT-17, PRD §8.5 CT-03 `color` — ⑥-2에서 한다). 선택 색상 원문 → 색상 사전(설정
 * `content.colorTerms`) → 사전에 없으면 AI 보조(⑥-2 AI 추출 호출에 묶는다) → 오너 확인·수정. 방법은 `DICTIONARY`·`AI`로 남긴다.
 * - 원문을 구분자(`/`·`／`·`・`·`,`·`、`·`×`·`&`·`+`·괄호·공백)로 나누고 조각마다 사전으로 바꾼다. 구분자는 그대로 둔다
 *   (`クリーム/ブラック` → `크림/블랙`). 숫자가 든 조각(색상 코드 `108`)은 그대로 둔다
 * - 조각 하나라도 사전에 없으면 사전으로 정하지 못한 것이다(AI 보조)
 */

const SEPARATOR = /([/／・,、×&+()（）\s]+)/u;

/** 사전으로 바꾼 한국어 표기. 한 조각이라도 사전에 없으면 null */
export function colorKoFromDictionary(
  raw: string | null,
  terms: readonly ColorTermEntry[],
): string | null {
  const text = (raw ?? '').normalize('NFKC').trim();
  if (text === '') return null;
  const byKey = new Map(terms.map((t) => [compareKey(t.raw), t.ko]));
  let words = 0;
  const out: string[] = [];
  for (const part of text.split(SEPARATOR)) {
    if (part === '' || SEPARATOR.test(part)) {
      out.push(part.trim() === '' && part !== '' ? ' ' : part);
      continue;
    }
    if (/\d/.test(part)) {
      out.push(part);
      continue;
    }
    const ko = byKey.get(compareKey(part));
    if (ko === undefined) return null;
    words += 1;
    out.push(ko);
  }
  if (words === 0) return null;
  return out.join('').replace(/\s+/g, ' ').trim();
}

/**
 * 색상 표기 행(⑥-2 `fact.color_ko`). 사전으로 정했으면 DICTIONARY, AI가 근거(원문 발췌)와 함께 답했으면 AI, 둘 다 아니면 값 없음
 * (NONE — ⑥-3 고시는 선택 색상 원문을 쓴다). 원문 발췌 = 선택 색상 원문, 출처 = ② 상품 페이지
 */
export function colorKoDraft(input: {
  selectedColorRaw: string | null;
  dictionaryValue: string | null;
  ai: { value: string; quote: string } | null;
  itemCode: string;
  itemUrl: string;
}): FieldDraft {
  const base: FieldDraft = {
    fieldKey: COLOR_KO_FIELD_KEY,
    value: null,
    generatedValue: null,
    valueSource: 'GENERATED',
    extractionMethod: 'NONE',
    evidenceQuote: null,
    evidenceUrl: null,
    evidenceImageAssetId: null,
    basisItemCode: input.itemCode,
    basisSha256: null,
    ownerConfirmedAt: null,
    choicePending: false,
    recheckReason: null,
    recheckResolvedAt: null,
  };
  if (input.dictionaryValue !== null) {
    return {
      ...base,
      value: input.dictionaryValue,
      generatedValue: input.dictionaryValue,
      extractionMethod: 'DICTIONARY',
      evidenceQuote: input.selectedColorRaw,
      evidenceUrl: input.itemUrl,
    };
  }
  if (input.ai) {
    return {
      ...base,
      value: input.ai.value,
      generatedValue: input.ai.value,
      extractionMethod: 'AI',
      evidenceQuote: input.ai.quote,
      evidenceUrl: input.itemUrl,
    };
  }
  return base;
}
