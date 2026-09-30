import type { CautionTemplateSettings } from '../../settings/schema/settings.types.js';
import type { FieldDraft } from '../fields/content-field.store.js';
import { CAUTION_FIELD_KEY } from '../fields/field-keys.js';
import { compareKey } from './fact-text.js';

/**
 * 소재별 주의 문구(P3-04 규칙 6, F-CT-21, PRD §8.5 CT-03 `caution` — ⑥-2에서 한다). 설정 템플릿(`content.cautionTemplates` —
 * 기본 문장 + 소재 말이 든 문장)으로 만들고, ⑥-2가 AI를 부를 때(못 찾은 사실·사전에 없는 색상) 같은 호출에 '보완 한 문장'을
 * 묶어 묻는다(Proposed — 주의 문구만을 위해 AI를 따로 부르지 않는다). 보완은 근거가 된 소재 원문이 자료에 있을 때만 붙인다.
 * 방법: 템플릿만 = TEMPLATE, 보완을 붙였으면 AI(원문 발췌 = 소재 원문).
 */

/** 템플릿 문장(기본 → 소재별, 같은 문장은 한 번) */
export function cautionFromTemplates(
  materials: readonly (string | null)[],
  templates: CautionTemplateSettings,
): string {
  const texts = materials.filter((m): m is string => m !== null && m.trim() !== '').map(compareKey);
  const lines = [templates.default.trim()];
  for (const entry of templates.byMaterial) {
    const hit = entry.terms.some((term) => {
      const key = compareKey(term);
      return key !== '' && texts.some((text) => text.includes(key));
    });
    if (hit && !lines.includes(entry.text.trim())) lines.push(entry.text.trim());
  }
  return lines.filter((line) => line !== '').join(' ');
}

/** 주의 문구 행(⑥-2 `fact.caution`) */
export function cautionDraft(input: {
  templateText: string;
  supplement: { value: string; quote: string } | null;
  itemCode: string;
  itemUrl: string;
}): FieldDraft {
  const supplement = input.supplement?.value.trim() ?? '';
  const value =
    supplement !== '' && !input.templateText.includes(supplement)
      ? `${input.templateText} ${supplement}`
      : input.templateText;
  const byAi = value !== input.templateText;
  return {
    fieldKey: CAUTION_FIELD_KEY,
    value: value.slice(0, 1000),
    generatedValue: value.slice(0, 1000),
    valueSource: 'GENERATED',
    extractionMethod: byAi ? 'AI' : 'TEMPLATE',
    evidenceQuote: byAi ? (input.supplement?.quote ?? null) : null,
    evidenceUrl: byAi ? input.itemUrl : null,
    evidenceImageAssetId: null,
    basisItemCode: input.itemCode,
    basisSha256: null,
    ownerConfirmedAt: null,
    choicePending: false,
    recheckReason: null,
    recheckResolvedAt: null,
  };
}
