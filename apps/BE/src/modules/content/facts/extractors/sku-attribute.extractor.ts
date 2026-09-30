import type { FactLabelSettings } from '../../../settings/schema/settings.types.js';
import type { ItemAttribute } from '../../content-sources.js';
import {
  LABEL_GROUP_FACT,
  LABEL_GROUP_ORDER,
  type ExtractedFact,
  type FactExtraction,
  type HeightValue,
  type LabelGroup,
} from '../fact.schema.js';
import { labelPositions, parseHeight } from '../fact-text.js';
import { extractFromDescription } from './description-pattern.extractor.js';

function groupOf(name: string, labels: FactLabelSettings): LabelGroup | null {
  const normalized = name.normalize('NFKC');
  for (const group of LABEL_GROUP_ORDER) {
    if (labels[group].some((label) => labelPositions(normalized, label).length > 0)) return group;
  }
  return null;
}

/** 굽 높이 속성 값: `{"value":"3.5","unit":"cm"}`·`3.5cm`·(이름에 단위가 있을 때) 숫자 */
function heightOf(attr: ItemAttribute): HeightValue | null {
  const value = attr.value;
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && 'value' in value) {
    const v = value as { value?: unknown; unit?: unknown };
    const unit = typeof v.unit === 'string' ? v.unit : '';
    return parseHeight(`${String(v.value)}${unit || 'cm'}`);
  }
  const parsed = parseHeight(attr.text);
  if (parsed) return parsed;
  const nameUnit = /\((cm|mm)\)/i.exec(attr.name.normalize('NFKC'));
  return nameUnit ? parseHeight(`${attr.text}${nameUnit[1]}`) : null;
}

/**
 * 1순위 — SKU 속성(P3-03 규칙 9-1, F-CT-09, PRD §8.5 CT-02: `原産国／製造国`, `素材`(`素材（生地・毛糸）`), `種類（アウトソール）`,
 * `ヒール高`(`{"value":"3.5","unit":"cm"}`)). 속성 이름(NFKC)에 항목 이름이 들어 있으면 그 필드다(굽높이 → 원산지 → 겉감 → 안감 →
 * 밑창 → 소재 순). '素材' 같은 소재 전체 속성은 값 안에 겉감·밑창 항목이 있으면 그것을 쓰고, 없으면 겉감으로 본다. 원문 발췌는
 * `이름: 값`(원문 표기). 같은 필드는 앞 속성(상품 속성 → SKU 속성)이 이긴다.
 */
export function extractFromAttributes(
  attributes: readonly ItemAttribute[],
  labels: FactLabelSettings,
): FactExtraction {
  const out: FactExtraction = {};
  let generic: ExtractedFact | null = null;
  for (const attr of attributes) {
    const group = groupOf(attr.name, labels);
    if (!group) continue;
    const quote = `${attr.name}: ${attr.text}`;
    const fact: ExtractedFact = {
      raw: attr.text.slice(0, 100),
      height: null,
      evidenceQuote: quote,
      method: 'SKU_ATTRIBUTE',
      evidenceImageIndex: null,
    };
    if (group === 'material') {
      // 값 안의 항목(アッパー:… ソール:…)을 먼저 본다
      const nested = extractFromDescription(attr.text, labels);
      for (const name of ['material_upper', 'material_lining', 'material_sole'] as const) {
        const found = nested[name];
        if (found && !out[name]) out[name] = { ...fact, raw: found.raw };
      }
      if (!nested.material_upper && !nested.material_sole && !nested.material_lining) {
        generic ??= fact;
      }
      continue;
    }
    const name = LABEL_GROUP_FACT[group];
    if (out[name]) continue;
    if (name === 'heel_height') {
      const height = heightOf(attr);
      if (height) out[name] = { ...fact, height };
      continue;
    }
    out[name] = fact;
  }
  if (!out.material_upper && generic) out.material_upper = generic;
  return out;
}
