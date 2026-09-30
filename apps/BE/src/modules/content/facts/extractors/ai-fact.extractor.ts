import {
  AI_RUN_ERROR_CODES,
  AiOutputInvalidError,
} from '../../../integrations/ai-engine/ai-engine.errors.js';
import type { AiJsonSchema } from '../../../integrations/ai-engine/ai-engine.port.js';
import type { AiExecutorInput, AiTask } from '../../../integrations/ai-engine/ai-executor.types.js';
import type { ItemAttribute } from '../../content-sources.js';
import { COPY_DATA_BLOCK_RULE } from '../../copy/copy.prompt.js';
import type { ExtractedFact, FactExtraction, FactName } from '../fact.schema.js';
import { compareKey, parseHeight } from '../fact-text.js';

/** ⑥-2 AI 작업(요구사항 ID). 스펙 이미지가 있으면 비전, 없으면 글만 넘기는 텍스트 작업(P3-03 Proposed) */
export function factAiTask(withImages: boolean): AiTask {
  return { name: 'CT-02', kind: withImages ? 'VISION' : 'TEXT' };
}

/**
 * AI가 뽑을 수 있는 필드 표(P3-03 §5.1 '확장형' — P3-04가 색상 표기·주의 문구를 더한다). 키는 AI 스키마 속성 이름이다
 */
export const FACT_AI_FIELD_SPECS: Readonly<Record<string, { label: string; hint: string }>> = {
  origin: {
    label: '원산지(제조국)',
    hint: '原産国·製造国·生産国·MADE IN 뒤의 나라 이름. 판매국(일본)이 아니라 만든 나라. 여러 나라면 원문대로',
  },
  material_upper: { label: '겉감 소재', hint: 'アッパー·甲材 등 신발 윗부분 소재(원문 표기)' },
  material_lining: { label: '안감 소재', hint: 'ライニング·裏地 소재(원문 표기)' },
  material_sole: { label: '밑창 소재', hint: 'アウトソール·ソール·靴底 소재(원문 표기)' },
  heel_height: {
    label: '굽·밑창 높이',
    hint: 'ヒール高さ·ソール高·厚底 값. 숫자와 단위(cm·mm)를 함께(예: 3.5cm)',
  },
};

/** 필드 하나의 결과 모양(draft-07 공통 부분집합 — 모든 키 required, 선택 값은 null 허용) */
const FIELD_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'evidence_quote', 'method', 'image_index'],
  properties: {
    value: { type: ['string', 'null'], maxLength: 200 },
    evidence_quote: { type: ['string', 'null'], maxLength: 500 },
    method: { type: 'string', enum: ['TEXT', 'IMAGE', 'NONE'] },
    image_index: { type: ['integer', 'null'], minimum: 1, maximum: 20 },
  },
} as const;

/** 못 찾은 필드만 담은 결과 스키마(`{field: {value, evidence_quote, method, image_index}}`, PRD §8.9 CT-02 출력) */
export function factAiSchema(names: readonly string[]): AiJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...names],
    properties: Object.fromEntries(
      names.map((name) => [name, structuredClone(FIELD_RESULT_SCHEMA)]),
    ),
  };
}

export interface FactPromptInput {
  names: readonly string[];
  itemName: string;
  descriptionText: string | null;
  attributes: readonly ItemAttribute[];
  /** 넘기는 스펙 이미지 수(비전) */
  imageCount: number;
}

/**
 * 3순위 — AI 추출 프롬프트(P3-03 규칙 9-3, F-CT-10, PRD §8.9 비전 템플릿). 라쿠텐 글은 데이터 블록(출처 RAKUTEN)으로만 넣는다.
 * 규칙: 근거(원문 발췌)가 없으면 값을 null로 둔다(추측 금지 — F-CT-11), 이미지에서 읽었으면 method=IMAGE·image_index(1부터).
 */
export function buildFactPrompt(input: FactPromptInput): AiExecutorInput {
  const fields = input.names.map((name) => {
    const spec = FACT_AI_FIELD_SPECS[name];
    return `- ${name}: ${spec?.label ?? name} — ${spec?.hint ?? ''}`;
  });
  const instruction = [
    '일본 라쿠텐 신발 상품의 [자료]에서 아래 항목의 값을 찾는다.',
    '',
    '[항목]',
    ...fields,
    '',
    '[규칙]',
    '1. 자료(글·이미지)에 적힌 값만 쓴다. 추측하거나 일반 상식으로 채우지 않는다.',
    '2. 값마다 근거가 된 원문을 evidence_quote에 일본어 원문 표기 그대로 짧게 옮긴다. 근거가 없으면 value·evidence_quote를 null, method를 NONE으로 둔다.',
    input.imageCount > 0
      ? `3. 글에서 찾았으면 method=TEXT·image_index=null, 이미지(스펙표 ${input.imageCount}장, 넘긴 순서 1~${input.imageCount})에서 읽었으면 method=IMAGE·image_index에 그 번호를 쓴다.`
      : '3. 이미지는 없다. 글에서 찾았으면 method=TEXT, image_index=null.',
    '4. 판매국(일본)과 제조국을 헷갈리지 않는다. 일본에서 판다는 사실만으로 원산지를 일본으로 쓰지 않는다.',
    `5. ${COPY_DATA_BLOCK_RULE}`,
  ].join('\n');
  const attributeText = input.attributes.map((a) => `${a.name}: ${a.text}`).join('\n');
  return {
    instruction,
    blocks: [
      { source: 'RAKUTEN', label: '라쿠텐 상품명', text: input.itemName },
      { source: 'RAKUTEN', label: '라쿠텐 설명', text: input.descriptionText ?? '(설명 없음)' },
      { source: 'RAKUTEN', label: '라쿠텐 속성', text: attributeText || '(속성 없음)' },
    ],
  };
}

interface AiFieldResult {
  value: string | null;
  evidence_quote: string | null;
  method: 'TEXT' | 'IMAGE' | 'NONE';
  image_index: number | null;
}

function fieldResult(output: Record<string, unknown>, name: string): AiFieldResult | null {
  const r = output[name];
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return null;
  return r as AiFieldResult;
}

export interface InterpretOptions {
  names: readonly FactName[];
  /** 넘긴 스펙 이미지 수 */
  imageCount: number;
  /** AI가 읽었다고 답한 이미지(비전 — P1-10 `images_seen`). 텍스트 작업이면 null */
  imagesSeen: readonly string[] | null;
  /** 글 근거 확인용 원문(상품명·설명·속성 글) */
  knownText: string;
}

/**
 * AI 결과 → 찾은 필드(P3-03 규칙 11 — 추측 금지).
 * - 이미지를 넘겼는데 `images_seen`이 없거나 모자라면 결과를 쓰지 않는다(`AI_IMAGES_NOT_SEEN` — 실행기가 FAILED로 닫는다, 규칙 15).
 *   P1-10 실행기가 먼저 같은 검사를 하고, 여기는 한 번 더 본다
 * - 값만 있고 원문 발췌가 없으면 그 값을 쓰지 않는다(NONE)
 * - 글(TEXT)에서 찾았다는 발췌가 원문 글에 없으면(NFKC·공백 무시) 쓰지 않는다(Proposed — 지어낸 발췌를 막는다)
 * - 굽높이는 숫자+단위를 읽지 못하면 쓰지 않는다
 */
export function interpretAiFacts(
  output: Record<string, unknown>,
  options: InterpretOptions,
): FactExtraction {
  if (options.imageCount > 0) {
    const seen = options.imagesSeen;
    if (seen === null || seen.length < options.imageCount) {
      throw new AiOutputInvalidError(
        AI_RUN_ERROR_CODES.IMAGES_NOT_SEEN,
        `읽은 이미지 ${seen?.length ?? 0}장 / 넘긴 이미지 ${options.imageCount}장`,
      );
    }
  }
  const known = compareKey(options.knownText);
  const out: FactExtraction = {};
  for (const name of options.names) {
    const r = fieldResult(output, name);
    if (!r || r.method === 'NONE') continue;
    const value = typeof r.value === 'string' ? r.value.trim() : '';
    const quote = typeof r.evidence_quote === 'string' ? r.evidence_quote.trim() : '';
    if (value === '' || quote === '') continue;
    const fromImage =
      r.method === 'IMAGE' &&
      typeof r.image_index === 'number' &&
      r.image_index >= 1 &&
      r.image_index <= options.imageCount;
    if (!fromImage && !known.includes(compareKey(quote))) continue;
    const fact: ExtractedFact = {
      raw: value.slice(0, 100),
      height: null,
      evidenceQuote: quote,
      method: 'AI',
      evidenceImageIndex: fromImage ? r.image_index! - 1 : null,
    };
    if (name === 'heel_height') {
      const height = parseHeight(value);
      if (!height) continue;
      out[name] = { ...fact, height };
      continue;
    }
    out[name] = fact;
  }
  return out;
}
