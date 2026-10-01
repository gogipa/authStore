import type {
  ContentSettings,
  MaterialTermEntry,
  OriginCountryEntry,
} from '../../settings/schema/settings.types.js';
import type { FieldJson } from '../fields/content-field.store.js';
import type { ExtractedFact, FactName } from './fact.schema.js';
import { compareKey, splitCountries, splitMaterials, splitParenNotes } from './fact-text.js';

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

/**
 * 조각 안에 사전의 나라 이름이 섞여 있는가(`一部ベトナム` → 예, `福岡県久留米市の自社工場` → 아니오). 영문 이름은 낱말 경계로만 본다.
 * 괄호 설명을 버려도 되는지 가린다 — 나라 이름이 섞였으면 버리지 않고 '확정 못 함'으로 남긴다(안전한 쪽).
 */
export function mentionsDictionaryCountry(
  token: string,
  dictionary: readonly OriginCountryEntry[],
): boolean {
  const upper = token.normalize('NFKC').toUpperCase();
  const key = compareKey(token);
  return dictionary.some((entry) =>
    [entry.raw, countryOfArea(entry.area)].some((name) => {
      const n = name.normalize('NFKC').toUpperCase().trim();
      if (n.length < 2) return false;
      if (/^[A-Z .]+$/.test(n)) {
        const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^A-Z])${escaped}([^A-Z]|$)`).test(upper);
      }
      return key.includes(compareKey(n));
    }),
  );
}

/**
 * 원산지 원문 → 한국어 나라 이름(사전) + 사전에 없는 조각.
 * 괄호 설명(M0 S7 §4.2: `日本（福岡県…）`·`タイ (태국)`)은 떼어 본다: 괄호 안이 사전 나라면 더하고, 나라 이름이 섞인 글이면
 * 확정 못 한 조각으로 남기고, 그 밖(지역·공장 설명, 번역)은 버린다.
 */
export function resolveOrigin(
  raw: string,
  dictionary: readonly OriginCountryEntry[],
): { countries: string[]; unresolved: string[] } {
  const countries: string[] = [];
  const unresolved: string[] = [];
  const add = (value: string) => {
    if (!countries.includes(value)) countries.push(value);
  };
  const { main, notes } = splitParenNotes(raw);
  for (const token of splitCountries(main)) {
    const country = countryFromDictionary(token, dictionary);
    add(country ?? token);
    if (!country) unresolved.push(token);
  }
  for (const note of notes) {
    for (const token of splitCountries(note)) {
      const country = countryFromDictionary(token, dictionary);
      if (country) add(country);
      else if (mentionsDictionaryCountry(token, dictionary)) {
        add(token);
        unresolved.push(token);
      }
    }
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
