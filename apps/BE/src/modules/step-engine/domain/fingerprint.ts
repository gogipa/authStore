import { createHash } from 'node:crypto';

/**
 * 입력 지문(F-BS-20, PRD §5.3 '재실행 필요' 판정 규칙 1·2, ERD step_run.input_fingerprint_*·step_run_input.value_hash).
 * - 값 해시(`valueHash`) = 값의 SHA-256(정규화 JSON: 객체 키 정렬, 공백 없음). 이미지는 파일 해시(sha256 글자)를 값으로,
 *   설명은 `normalizeText`(NFKC + 공백 정리)한 글을 값으로 넣는다. 없는 '선택' 입력은 null 값의 해시다.
 * - 지문(`fingerprint`) = 시작 조건 `{ inputKey: valueHash }`를 키 정렬 JSON으로 만든 SHA-256 hex 64자.
 *   실행 중 오너 입력(is_start_condition=false)과 수집 시각은 넣지 않는다.
 */

function sortKeys(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
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

/** 정규화 JSON: 객체 키를 정렬하고 undefined 칸을 뺀다. Date는 ISO 글자. undefined 자체는 null */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value === undefined ? null : value));
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 설명 텍스트 정리: NFKC(전각 → 반각 등) + 공백 여러 개를 한 칸으로 + 앞뒤 공백 제거 */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

/** 값 해시(소문자 hex 64자) */
export function valueHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** 설명 텍스트의 값 해시(normalizeText 뒤) */
export function textHash(text: string): string {
  return valueHash(normalizeText(text));
}

/** 없는 '선택' 입력의 값 해시(null) */
export const NULL_VALUE_HASH = valueHash(null);

/** 지문: `{ inputKey: valueHash }`(시작 조건만)를 키 정렬 JSON으로 만든 SHA-256 */
export function fingerprint(hashes: Readonly<Record<string, string>>): string {
  return sha256Hex(canonicalJson(hashes));
}

/** 해시가 붙은 입력 하나 */
export interface HashedInput {
  inputKey: string;
  isStartCondition: boolean;
  valueHash: string;
}

/** 시작 조건 입력만 `{ inputKey: valueHash }`로 */
export function startConditionHashes(inputs: readonly HashedInput[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const input of inputs) if (input.isStartCondition) out[input.inputKey] = input.valueHash;
  return out;
}

/** 입력 목록의 지문(시작 조건만) */
export function inputFingerprint(inputs: readonly HashedInput[]): string {
  return fingerprint(startConditionHashes(inputs));
}

/**
 * 바뀐 입력 이름: 두 해시 표의 키를 합쳐 값이 다른 키(한쪽에만 있으면 없는 쪽은 null 값 해시로 본다). 키 사전순.
 */
export function changedInputKeys(
  stored: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
): string[] {
  const keys = [...new Set([...Object.keys(stored), ...Object.keys(current)])].sort();
  return keys.filter(
    (key) => (stored[key] ?? NULL_VALUE_HASH) !== (current[key] ?? NULL_VALUE_HASH),
  );
}
