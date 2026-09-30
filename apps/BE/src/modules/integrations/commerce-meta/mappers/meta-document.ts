import { createHash } from 'node:crypto';
import type { MetaDocumentKind } from '../commerce-meta.constants.js';

/** commerce_meta_document 한 행(kind, scope_key)의 내용 */
export interface MetaDocument {
  kind: MetaDocumentKind;
  scopeKey: string;
  /** 응답 원문(JSON). 통째로 둔다 */
  payload: unknown;
  /** 정규화 JSON의 SHA-256(소문자 hex 64자, ck_cmd_sha) */
  payloadSha256: string;
}

/** 키를 정렬한 JSON(공백 없음). 배열 순서는 그대로다. 키 순서만 다른 응답은 같은 글자가 된다 */
export function canonicalMetaJson(value: unknown): string {
  return JSON.stringify(sortKeys(value === undefined ? null : value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) out[key] = sortKeys(child);
    }
    return out;
  }
  return value;
}

/** payload_sha256: 정규화 JSON의 SHA-256(소문자 hex 64자) */
export function payloadSha256(payload: unknown): string {
  return createHash('sha256').update(canonicalMetaJson(payload), 'utf8').digest('hex');
}

/** scope_key 최대 길이(varchar(40)) */
export const META_SCOPE_KEY_MAX = 40;

export function toMetaDocument(
  kind: MetaDocumentKind,
  scopeKey: string,
  payload: unknown,
): MetaDocument {
  if (scopeKey.length === 0 || scopeKey.length > META_SCOPE_KEY_MAX) {
    throw new Error(`메타 문서 범위 키는 1~${META_SCOPE_KEY_MAX}자여야 합니다.`);
  }
  const normalized = payload === undefined ? null : payload;
  return { kind, scopeKey, payload: normalized, payloadSha256: payloadSha256(normalized) };
}
