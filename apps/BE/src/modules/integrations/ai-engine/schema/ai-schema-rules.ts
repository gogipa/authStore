import { AiSchemaRuleError } from '../ai-engine.errors.js';
import type { AiJsonSchema } from '../ai-engine.port.js';

/**
 * AI 결과 스키마 규칙(P1-10 규칙 7, PRD §8.9 스키마 규칙·AI-02, F-BS-31). 세 엔진(`--json-schema`·`--output-schema`)이
 * 같이 받는 draft-07 공통 부분집합만 쓴다.
 * - 맨 위는 object
 * - 모든 object: `additionalProperties: false`, `properties`의 모든 키가 `required`(선택 값은 `["string","null"]`처럼 null 허용)
 * - `format` 금지(엔진마다 다르게 다룬다). `$ref`·`oneOf`·`allOf`·`not`·`if` 같은 조합 키워드와 튜플 `items`도 쓰지 않는다
 * 규칙을 어긴 스키마는 호출 전에 거부한다(앱 코드의 잘못).
 */

/** 쓸 수 있는 키워드(Proposed: 세 CLI가 공통으로 받는다고 문서가 가정한 부분집합) */
export const AI_SCHEMA_KEYWORDS = new Set([
  '$schema',
  'title',
  'description',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'anyOf',
]);

const JSON_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typesOf(schema: Record<string, unknown>): string[] {
  const t = schema.type;
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  return [];
}

function walk(schema: unknown, path: string, out: string[]): void {
  if (!isRecord(schema)) {
    out.push(`${path}: 스키마는 객체여야 한다`);
    return;
  }
  for (const key of Object.keys(schema)) {
    if (key === 'format') out.push(`${path}: format 키워드는 쓰지 않는다`);
    else if (!AI_SCHEMA_KEYWORDS.has(key))
      out.push(`${path}: ${key} 키워드는 공통 부분집합 밖이다`);
  }
  const types = typesOf(schema);
  if (schema.type !== undefined && (types.length === 0 || types.some((t) => !JSON_TYPES.has(t)))) {
    out.push(`${path}: type 값이 올바르지 않다`);
  }
  const isObject = types.includes('object') || schema.properties !== undefined;
  if (isObject) {
    if (schema.additionalProperties !== false) {
      out.push(`${path}: additionalProperties는 false여야 한다`);
    }
    const props = schema.properties === undefined ? {} : schema.properties;
    if (!isRecord(props)) {
      out.push(`${path}: properties는 객체여야 한다`);
    } else {
      const required = Array.isArray(schema.required) ? schema.required : [];
      for (const key of Object.keys(props)) {
        if (!required.includes(key)) out.push(`${path}: ${key}가 required에 없다`);
        walk(props[key], `${path}/properties/${key}`, out);
      }
      for (const key of required) {
        if (typeof key !== 'string' || !(key in props)) {
          out.push(`${path}: required의 ${String(key)}가 properties에 없다`);
        }
      }
    }
  }
  if (schema.items !== undefined) {
    if (Array.isArray(schema.items)) out.push(`${path}: 튜플 items는 쓰지 않는다`);
    else walk(schema.items, `${path}/items`, out);
  }
  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf)) out.push(`${path}: anyOf는 배열이어야 한다`);
    else schema.anyOf.forEach((s, i) => walk(s, `${path}/anyOf/${i}`, out));
  }
}

/** 위반 목록(없으면 빈 배열) */
export function checkAiSchemaRules(schema: AiJsonSchema): string[] {
  const out: string[] = [];
  if (!isRecord(schema) || !typesOf(schema).includes('object')) {
    out.push('/: 맨 위는 type: object여야 한다');
  }
  walk(schema, '', out);
  return out.map((v) => (v.startsWith(':') ? `/${v}` : v));
}

/** 규칙을 어기면 AiSchemaRuleError(호출 전) */
export function assertAiSchemaRules(schema: AiJsonSchema): void {
  const violations = checkAiSchemaRules(schema);
  if (violations.length > 0) throw new AiSchemaRuleError(violations);
}
