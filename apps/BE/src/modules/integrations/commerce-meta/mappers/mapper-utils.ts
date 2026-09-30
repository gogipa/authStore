/**
 * 응답 → 행 변환 공통 도구(순수 함수). 응답 모양이 예상과 다르면 `MetaMappingError`를 던진다.
 * 그 대상은 FAILED가 되고 이전 캐시는 그대로 남는다(규칙 5). 메시지에는 값이 아니라 칸 이름만 넣는다.
 */
export class MetaMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaMappingError';
  }
}

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 목록 응답에서 배열을 꺼낸다. 최상위 배열이거나, 객체의 `keys` 중 처음 있는 배열 칸.
 * 둘 다 아니면 응답 모양 오류.
 */
export function listOf(data: unknown, keys: readonly string[], what: string): unknown[] {
  if (Array.isArray(data)) return data;
  if (isObject(data)) {
    for (const key of keys) {
      const value = data[key];
      if (Array.isArray(value)) return value;
    }
  }
  throw new MetaMappingError(
    `${what} 응답에서 목록을 찾지 못했습니다(예상 칸: ${keys.join('·')}).`,
  );
}

/** 첫 번째로 있는 칸의 값(문자열·숫자면 문자열로). 없으면 null */
export function textOf(item: JsonObject, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** 꼭 있어야 하는 글자 칸. 없거나 `max`자를 넘으면 응답 모양 오류 */
export function requiredText(
  item: JsonObject,
  keys: readonly string[],
  what: string,
  max: number,
): string {
  const value = textOf(item, keys);
  if (value === null) throw new MetaMappingError(`${what}에 ${keys[0]} 값이 없습니다.`);
  if (value.length > max) {
    throw new MetaMappingError(`${what}의 ${keys[0]} 값이 ${max}자를 넘습니다.`);
  }
  return value;
}

/** 표시용 글자를 `max`자로 자른다(이름·주소 요약. 자연키에는 쓰지 않는다) */
export function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** 자연키가 같은 항목이 여럿이면 처음 것만 둔다(응답 순서 유지) */
export function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
