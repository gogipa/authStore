import { Ajv, type ValidateFunction } from 'ajv';
import { IMAGES_SEEN_FIELD } from '../ai-engine.constants.js';
import { AI_RUN_ERROR_CODES, AiOutputInvalidError } from '../ai-engine.errors.js';
import type { AiJsonSchema } from '../ai-engine.port.js';

/**
 * AI 결과 재검증(P1-10 규칙 8·9, F-BS-32, AI-02). CLI가 스키마를 받았어도 앱이 Ajv 8로 다시 본다.
 * 어댑터(봉투에서 꺼낸 직후)와 실행기(돌려주기 전)가 같은 함수를 쓴다.
 * - 빈 결과(null·빈 객체)·스키마 불일치(추가 필드 포함) → AI_OUTPUT_INVALID
 * - 비전: `images_seen`(읽은 파일 이름 목록, Proposed)이 없거나 넘긴 이미지 이름 집합과 다르면 → AI_IMAGES_NOT_SEEN
 * 오류 문구에는 필드 경로만 넣는다(값·출력 본문은 넣지 않는다, NFR-02).
 */

const ajv = new Ajv({ allErrors: false, strict: false });
const cache = new Map<string, ValidateFunction>();
const CACHE_MAX = 200;

function compile(schema: AiJsonSchema): ValidateFunction {
  const key = JSON.stringify(schema);
  let fn = cache.get(key);
  if (!fn) {
    fn = ajv.compile(schema);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, fn);
  }
  return fn;
}

/** 비전 스키마: 호출자 스키마 맨 위에 `images_seen: string[]`을 더한다(required 포함) */
export function withImagesSeen(schema: AiJsonSchema): AiJsonSchema {
  const properties = { ...((schema.properties as Record<string, unknown> | undefined) ?? {}) };
  properties[IMAGES_SEEN_FIELD] = { type: 'array', items: { type: 'string' } };
  const required = Array.isArray(schema.required) ? [...(schema.required as string[])] : [];
  if (!required.includes(IMAGES_SEEN_FIELD)) required.push(IMAGES_SEEN_FIELD);
  return { ...schema, properties, required };
}

/** 결과에서 images_seen을 뺀다(호출자에게는 따로 준다) */
export function stripImagesSeen(output: Record<string, unknown>): {
  output: Record<string, unknown>;
  imagesSeen: string[] | null;
} {
  if (!(IMAGES_SEEN_FIELD in output)) return { output, imagesSeen: null };
  const { [IMAGES_SEEN_FIELD]: seen, ...rest } = output;
  return { output: rest, imagesSeen: Array.isArray(seen) ? seen.map(String) : null };
}

function isEmptyResult(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'object' && !Array.isArray(value)) return Object.keys(value).length === 0;
  return false;
}

/** 파일 이름만(경로가 붙어 와도 마지막 조각) */
function baseName(name: string): string {
  const parts = name.split(/[\\/]/);
  return parts[parts.length - 1] ?? name;
}

export interface ValidateAiOutputOptions {
  /** 비전: 넘긴 이미지 파일 이름(images_seen 기대값) */
  expectedImages?: readonly string[];
}

/** 검증한 결과(객체). 어기면 AiOutputInvalidError */
export function validateAiOutput(
  schema: AiJsonSchema,
  value: unknown,
  options: ValidateAiOutputOptions = {},
): Record<string, unknown> {
  if (isEmptyResult(value))
    throw new AiOutputInvalidError(AI_RUN_ERROR_CODES.OUTPUT_INVALID, '빈 결과');
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AiOutputInvalidError(AI_RUN_ERROR_CODES.OUTPUT_INVALID, '결과가 객체가 아님');
  }
  const expected = options.expectedImages;
  if (expected && expected.length > 0) {
    const seen = (value as Record<string, unknown>)[IMAGES_SEEN_FIELD];
    if (!Array.isArray(seen)) {
      throw new AiOutputInvalidError(AI_RUN_ERROR_CODES.IMAGES_NOT_SEEN, 'images_seen 없음');
    }
    const got = new Set(seen.filter((s): s is string => typeof s === 'string').map(baseName));
    const want = new Set(expected.map(baseName));
    const missing = [...want].filter((n) => !got.has(n));
    const extra = [...got].filter((n) => !want.has(n));
    if (missing.length > 0 || extra.length > 0) {
      throw new AiOutputInvalidError(
        AI_RUN_ERROR_CODES.IMAGES_NOT_SEEN,
        `읽지 않은 이미지 ${missing.length}장, 넘기지 않은 이름 ${extra.length}개`,
      );
    }
  }
  const validate = compile(schema);
  if (!validate(value)) {
    const first = validate.errors?.[0];
    const where = first ? `${first.instancePath || '/'} ${first.keyword}` : '스키마 불일치';
    throw new AiOutputInvalidError(AI_RUN_ERROR_CODES.OUTPUT_INVALID, `스키마 불일치: ${where}`);
  }
  return value as Record<string, unknown>;
}
