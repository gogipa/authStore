import type { FactLabelSettings } from '../../settings/schema/settings.types.js';
import type { FactFieldKey } from '../fields/field-keys.js';

/**
 * ⑥-2 사양 추출의 공통 모양(P3-03 규칙 9~11, PRD §8.5 CT-02 표). 추출기는 순위별 순수 함수이고 결과는 필드 이름별
 * `{값 원문, 원문 발췌, 방법}`이다. 앞 순위에서 찾은 필드는 뒤 순위가 덮지 않는다(`mergeFacts`).
 * 파이프라인은 필드 추가형이다 — P3-04가 색상 표기·주의 문구를 더할 때 `FACT_NAMES`·AI 필드 표(`ai-fact.extractor.ts`)에 더한다.
 */

/** 추출 대상 필드 이름(AI 스키마 속성 이름과 같다) */
export const FACT_NAMES = [
  'origin',
  'material_upper',
  'material_lining',
  'material_sole',
  'heel_height',
] as const;
export type FactName = (typeof FACT_NAMES)[number];

/** 필드 이름 → content_draft_field.field_key */
export const FACT_KEY_OF: Readonly<Record<FactName, FactFieldKey>> = {
  origin: 'fact.origin',
  material_upper: 'fact.material_upper',
  material_lining: 'fact.material_lining',
  material_sole: 'fact.material_sole',
  heel_height: 'fact.heel_height',
};

/** 굽·밑창 높이 값(`{"value":"3.5","unit":"cm"}` → `{value: 3.5, unit: 'cm'}`) */
export interface HeightValue {
  value: number;
  unit: 'cm' | 'mm';
}

/** 찾은 필드 하나(근거가 있을 때만 만든다 — 근거 없음은 결과에 없다 = NONE) */
export interface ExtractedFact {
  /** 값 원문(나라·소재 글, 원문 표기). 높이는 `height`가 값이다 */
  raw: string;
  height: HeightValue | null;
  /** 일본어 원문 발췌(원문 표기 그대로) */
  evidenceQuote: string;
  method: 'SKU_ATTRIBUTE' | 'DESCRIPTION_PATTERN' | 'AI';
  /** AI가 OCR로 읽은 스펙 이미지 순번(0부터, 넘긴 이미지 순서). 글에서 찾았으면 null */
  evidenceImageIndex: number | null;
}

export type FactExtraction = Partial<Record<FactName, ExtractedFact>>;

/** 순위대로 합친다: 앞 결과에 있는 필드는 뒤 결과가 덮지 않는다(규칙 9) */
export function mergeFacts(...layers: readonly FactExtraction[]): FactExtraction {
  const out: FactExtraction = {};
  for (const layer of layers) {
    for (const name of FACT_NAMES) {
      const fact = layer[name];
      if (fact && !out[name]) out[name] = fact;
    }
  }
  return out;
}

/** 아직 못 찾은 필드(다음 순위로 넘긴다) */
export function missingFacts(extraction: FactExtraction): FactName[] {
  return FACT_NAMES.filter((name) => !extraction[name]);
}

/** 항목 이름 묶음(설정 `content.factLabels`) → 필드. `material`은 겉감·밑창을 따로 못 찾을 때 겉감으로 본다 */
export type LabelGroup = keyof FactLabelSettings;

export const LABEL_GROUP_FACT: Readonly<Record<Exclude<LabelGroup, 'material'>, FactName>> = {
  origin: 'origin',
  upper: 'material_upper',
  lining: 'material_lining',
  sole: 'material_sole',
  heelHeight: 'heel_height',
};

/**
 * 항목 이름을 볼 순서: 굽높이('ソール高')를 밑창('ソール')보다, 원산지를 소재보다 먼저 본다. 같은 위치의 더 긴 이름이 이긴다
 */
export const LABEL_GROUP_ORDER: readonly LabelGroup[] = [
  'heelHeight',
  'origin',
  'upper',
  'lining',
  'sole',
  'material',
];
