import type {
  ContentSettings,
  MaterialTermEntry,
  OriginCountryEntry,
} from '../../settings/schema/settings.types.js';
import type { FieldJson } from '../fields/content-field.store.js';
import type { ExtractedFact, FactName } from './fact.schema.js';
import { compareKey, splitCountries, splitMaterials } from './fact-text.js';

/**
 * ⑥-2 값의 한국어 정리(P3-03 규칙 10 '값은 한국어로 정리한다. 정리 방법(사전·AI)은 문서에 없음' → Proposed: **설정 사전**).
 * - 원산지: 나라 조각마다 원산지 나라 사전(`content.originCountries` — 원문 표기 → '대륙 > 국가', P3-04와 공유)의 국가 이름.
 *   값 모양은 한국어 나라 이름 배열(`["베트남","인도네시아","중국"]`). 사전에 없는 조각은 원문 그대로 두고 '확정 못 함'으로 본다
 * - 소재: 조각마다 소재 말 사전(`content.materialTerms`), 없는 말은 원문 그대로. `·`로 잇는다(`합성섬유·합성가죽`)
 * - 굽높이: `{value, unit}` 그대로(번역할 글이 없다)
 */

/** '대륙 > 국가'의 국가 조각 */
export function countryOfArea(area: string): string {
  const parts = area.split('>').map((s) => s.trim());
  return parts.at(-1) ?? area.trim();
}

/**
 * 나라 조각 하나 → 한국어 나라 이름(사전에서만). 원문 표기(`ベトナム`·`VIETNAM`), '대륙 > 국가', 한국어 나라 이름(`베트남`) 모두
 * 받는다(비교는 NFKC·대문자·공백 무시). 없으면 null
 */
export function countryFromDictionary(
  token: string,
  dictionary: readonly OriginCountryEntry[],
): string | null {
  const key = compareKey(token);
  if (key === '') return null;
  for (const entry of dictionary) {
    const country = countryOfArea(entry.area);
    if (
      compareKey(entry.raw) === key ||
      compareKey(entry.area) === key ||
      compareKey(country) === key
    ) {
      return country;
    }
  }
  return null;
}

/** 원산지 원문 → 한국어 나라 이름(사전) + 사전에 없는 조각 */
export function resolveOrigin(
  raw: string,
  dictionary: readonly OriginCountryEntry[],
): { countries: string[]; unresolved: string[] } {
  const countries: string[] = [];
  const unresolved: string[] = [];
  for (const token of splitCountries(raw)) {
    const country = countryFromDictionary(token, dictionary);
    const value = country ?? token;
    if (!countries.includes(value)) countries.push(value);
    if (!country) unresolved.push(token);
  }
  return { countries, unresolved };
}

/** 소재 원문 → 한국어(사전에 없는 말은 원문 그대로) */
export function koreanMaterial(raw: string, terms: readonly MaterialTermEntry[]): string {
  const byKey = new Map(terms.map((t) => [compareKey(t.raw), t.ko]));
  const parts = splitMaterials(raw).map((token) => byKey.get(compareKey(token)) ?? token);
  return parts.length > 0 ? parts.join('·') : raw.trim();
}

/** 찾은 필드 → 저장 값(한국어 정리). `unresolved`는 원산지에서 사전에 없는 나라 조각 */
export function factValueOf(
  name: FactName,
  fact: ExtractedFact,
  settings: Pick<ContentSettings, 'originCountries' | 'materialTerms'>,
): { value: FieldJson; unresolved: string[] } {
  if (name === 'origin') {
    const { countries, unresolved } = resolveOrigin(fact.raw, settings.originCountries);
    return { value: countries, unresolved };
  }
  if (name === 'heel_height') {
    const height = fact.height;
    return { value: height ? { value: height.value, unit: height.unit } : null, unresolved: [] };
  }
  return { value: koreanMaterial(fact.raw, settings.materialTerms), unresolved: [] };
}
