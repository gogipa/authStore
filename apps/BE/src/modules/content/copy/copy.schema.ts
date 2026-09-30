import type { FieldError } from '../../../common/errors/error-response.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AiJsonSchema } from '../../integrations/ai-engine/ai-engine.port.js';
import { COPY_FIELD_PROPS, type CopyFieldKey, type CopyFieldProp } from '../fields/field-keys.js';

/**
 * ⑥-1 카피 결과 스키마(P3-03 규칙 2, PRD §8.5 카피 스키마 CT-01, F-CT-05, US-14 AC1, AI-02). draft-07 공통 부분집합 —
 * `additionalProperties:false`, 모든 필드 required(P1-10 `assertAiSchemaRules`). 앱이 Ajv로 다시 검증하고(`AiExecutor.run`),
 * 어기면 ⑥-1은 FAILED(`failureKind=AI`, `AI_OUTPUT_INVALID`)다. M1은 자동 재시도가 없다(AI-05 재시도는 M2).
 * 길이 상한(헤드라인 40자·셀링포인트 3~5개 말고)은 Proposed다.
 */
export const COPY_LIMITS = {
  headlineMax: 40,
  sellingPointsMin: 3,
  sellingPointsMax: 5,
  sellingPointMax: 100,
  bodyMax: 2000,
  fitAndStylingMax: 1000,
  sizeGuideMax: 1000,
  sourceFactsMin: 1,
  sourceFactsMax: 20,
  sourceFactMax: 300,
} as const;

const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength }) as const;

export const COPY_SCHEMA: AiJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'headline',
    'selling_points',
    'body',
    'fit_and_styling',
    'size_guide',
    'source_facts_used',
  ],
  properties: {
    headline: { ...text(COPY_LIMITS.headlineMax), description: '헤드라인(40자 이하)' },
    selling_points: {
      type: 'array',
      minItems: COPY_LIMITS.sellingPointsMin,
      maxItems: COPY_LIMITS.sellingPointsMax,
      items: text(COPY_LIMITS.sellingPointMax),
      description: '셀링포인트 3~5개',
    },
    body: { ...text(COPY_LIMITS.bodyMax), description: '본문' },
    fit_and_styling: { ...text(COPY_LIMITS.fitAndStylingMax), description: '착화감·코디 제안' },
    size_guide: { ...text(COPY_LIMITS.sizeGuideMax), description: '사이즈 안내' },
    source_facts_used: {
      type: 'array',
      minItems: COPY_LIMITS.sourceFactsMin,
      maxItems: COPY_LIMITS.sourceFactsMax,
      items: text(COPY_LIMITS.sourceFactMax),
      description: '카피에 쓴 원문 사실(자료의 일본어 원문 그대로)',
    },
  },
};

/** 카피 문서(content_draft_copy.generated_copy·copy — 키는 AI 스키마 그대로 snake_case) */
export interface CopyDraft {
  headline: string;
  selling_points: string[];
  body: string;
  fit_and_styling: string;
  size_guide: string;
  source_facts_used: string[];
}

/** 카피 문서 모양인가(DB jsonb를 읽을 때) */
export function isCopyDraft(value: unknown): value is CopyDraft {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === 'string');
  return (
    typeof v.headline === 'string' &&
    strings(v.selling_points) &&
    typeof v.body === 'string' &&
    typeof v.fit_and_styling === 'string' &&
    typeof v.size_guide === 'string' &&
    strings(v.source_facts_used)
  );
}

/** 글자 수(코드 포인트 — 화면 카운터 `25/40`과 같다) */
export function charLength(value: string): number {
  return [...value].length;
}

function textError(field: string, value: unknown, label: string, max: number): FieldError | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return { field, message: `${label}을(를) 비울 수 없습니다.`, rejectedValue: value };
  }
  if (charLength(value.trim()) > max) {
    return {
      field,
      message: `${label}은(는) ${max}자 이하여야 합니다(지금 ${charLength(value.trim())}자).`,
      rejectedValue: value,
    };
  }
  return null;
}

/**
 * 오너가 고친 카피 필드 값 검사(P3-03 규칙 6 — 어기면 422 VALIDATION_FAILED). 헤드라인 40자 이하, 셀링포인트 3~5개(각 1~100자),
 * 나머지 글 1자 이상·상한 이하. `at`은 fieldErrors의 field(예 `fields[0].value`)
 */
export function copyFieldErrors(key: CopyFieldKey, value: unknown, at: string): FieldError[] {
  const prop = COPY_FIELD_PROPS[key];
  if (prop === 'selling_points') {
    if (!Array.isArray(value)) {
      return [{ field: at, message: '셀링포인트는 글 목록이어야 합니다.', rejectedValue: value }];
    }
    const errors: FieldError[] = [];
    if (
      value.length < COPY_LIMITS.sellingPointsMin ||
      value.length > COPY_LIMITS.sellingPointsMax
    ) {
      errors.push({
        field: at,
        message: `셀링포인트는 ${COPY_LIMITS.sellingPointsMin}~${COPY_LIMITS.sellingPointsMax}개여야 합니다(지금 ${value.length}개).`,
        rejectedValue: value,
      });
    }
    value.forEach((item, i) => {
      const e = textError(`${at}[${i}]`, item, '셀링포인트', COPY_LIMITS.sellingPointMax);
      if (e) errors.push(e);
    });
    return errors;
  }
  const spec: Record<Exclude<CopyFieldProp, 'selling_points'>, [string, number]> = {
    headline: ['헤드라인', COPY_LIMITS.headlineMax],
    body: ['본문', COPY_LIMITS.bodyMax],
    fit_and_styling: ['착화감·코디 제안', COPY_LIMITS.fitAndStylingMax],
    size_guide: ['사이즈 안내', COPY_LIMITS.sizeGuideMax],
  };
  const [label, max] = spec[prop];
  const e = textError(at, value, label, max);
  return e ? [e] : [];
}

/** 오너 값 정리(앞뒤 공백 제거). 검사를 통과한 값만 넣는다 */
export function cleanCopyValue(key: CopyFieldKey, value: unknown): string | string[] {
  if (COPY_FIELD_PROPS[key] === 'selling_points') {
    return (value as string[]).map((s) => s.trim());
  }
  return (value as string).trim();
}

/** 카피 문서 → jsonb 입력 */
export function copyJson(copy: CopyDraft): Prisma.InputJsonObject {
  return structuredClone(copy) as unknown as Prisma.InputJsonObject;
}
