/**
 * 비밀정보 가림(F-BS-25, NFR-02, 05-1 §1.2·§1.5). 로거·전역 예외 필터·SSE 발행기·call_log 쓰기가 같이 쓴다.
 *
 * 두 겹으로 막는다.
 * 1. 이름으로: 비밀을 담는 헤더(`authorization`·`cookie`·`x-*-secret` …)·필드(`client_secret_sign`·`access_token` …)의
 *    값을 `***`로 바꾼다. `Bearer <토큰>` 모양도 가린다.
 * 2. 값으로: 저장소(키체인)에서 읽거나 쓴 값과 받은 토큰을 프로세스 메모리의 '알려진 비밀' 목록에 올려 두고,
 *    어떤 문자열에서든 그 값을 `***`로 지운다. 이름을 모르는 곳(오류 문구·URL·임의 로그 인자)에 섞여도 지운다.
 * 목록은 메모리에만 있고 파일·DB에 쓰지 않는다(Proposed, P1-07).
 */

export const SECRET_MASK = '***';

/** 이보다 짧은 값은 알려진 비밀로 올리지 않는다(짧은 값을 지우면 로그가 망가진다, Proposed) */
export const KNOWN_SECRET_MIN_LENGTH = 6;
/** 알려진 비밀 목록의 최대 개수(오래된 것부터 뺀다). 키 6개 + 토큰·서명 몇 개면 충분하다 */
export const KNOWN_SECRET_MAX = 256;

const knownSecrets = new Set<string>();
/** 긴 것부터 지우려고 정렬해 둔 사본(값이 겹칠 때 짧은 값이 긴 값 일부만 지우지 않게) */
let knownSorted: string[] = [];

/** 값을 가린 표시(`***`). 값이 없으면 빈 문자열 */
export function maskSecret(value: string | null | undefined): string {
  return value ? SECRET_MASK : '';
}

/** 이 값을 알려진 비밀로 올린다(로그·응답·call_log에서 지운다) */
export function registerKnownSecret(value: string | null | undefined): void {
  if (typeof value !== 'string' || value.length < KNOWN_SECRET_MIN_LENGTH) return;
  if (knownSecrets.has(value)) return;
  knownSecrets.add(value);
  while (knownSecrets.size > KNOWN_SECRET_MAX) {
    const oldest = knownSecrets.values().next().value;
    if (oldest === undefined) break;
    knownSecrets.delete(oldest);
  }
  knownSorted = [...knownSecrets].sort((a, b) => b.length - a.length);
}

/** 테스트용: 목록을 비운다 */
export function clearKnownSecrets(): void {
  knownSecrets.clear();
  knownSorted = [];
}

export function knownSecretCount(): number {
  return knownSecrets.size;
}

const BEARER_RE = /\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi;

/** 문자열에서 알려진 비밀값과 `Bearer <토큰>`을 `***`로 지운다 */
export function scrubKnownSecrets(text: string): string {
  let out = text;
  for (const secret of knownSorted) {
    if (out.includes(secret)) out = out.split(secret).join(SECRET_MASK);
  }
  return out.replace(BEARER_RE, `$1 ${SECRET_MASK}`);
}

/** 값이 비밀인 헤더 이름(들어오는 요청·나가는 요청 모두) */
const SECRET_HEADER_RE =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-.*-(secret|token|key))$/i;

export function isSecretHeaderName(name: string): boolean {
  return SECRET_HEADER_RE.test(name);
}

/**
 * 값이 비밀인 필드 이름(폼 본문·JSON·로그 객체의 키). 키 '이름'을 적는 `secretKey`·`secretKeys`는 비밀이 아니다.
 * 커머스 토큰 폼의 `client_secret_sign`, 토큰 응답의 `access_token`, 라쿠텐·환율 키 이름 등.
 */
const SECRET_FIELD_RE =
  /(client[-_]?secret|secret[-_]?(sign|value)|^secret$|access[-_]?token|refresh[-_]?token|^token$|bearer|password|passwd|api[-_]?key|access[-_]?key|application[-_]?id|auth[-_]?key|service[-_]?key|^authorization$|^cookie$)/i;

export function isSecretFieldName(name: string): boolean {
  return SECRET_FIELD_RE.test(name);
}

/** 헤더 묶음에서 비밀 헤더 값을 가린다(원본은 바꾸지 않는다) */
export function redactSecretHeaders<T extends Record<string, unknown> | undefined>(headers: T): T {
  if (!headers) return headers;
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = isSecretHeaderName(name)
      ? SECRET_MASK
      : typeof value === 'string'
        ? scrubKnownSecrets(value)
        : value;
  }
  return out as T;
}

/**
 * `application/x-www-form-urlencoded` 본문에서 비밀 필드 값을 가린다(커머스 토큰 요청 본문 등).
 * 순서·다른 필드는 그대로 둔다.
 */
export function maskFormBody(body: string): string {
  return scrubKnownSecrets(
    body
      .split('&')
      .map((pair) => {
        const eq = pair.indexOf('=');
        if (eq === -1) return pair;
        let name = pair.slice(0, eq);
        try {
          name = decodeURIComponent(name.replace(/\+/g, ' '));
        } catch {
          // 잘못된 인코딩이면 원문 이름으로 본다
        }
        return isSecretFieldName(name) || name === 'client_id'
          ? `${pair.slice(0, eq)}=${SECRET_MASK}`
          : pair;
      })
      .join('&'),
  );
}

const MAX_DEPTH = 8;

/**
 * 로그 인자·응답 객체를 깊게 복사하며 가린다: 문자열은 알려진 비밀을 지우고, 비밀 이름의 키·헤더 값은 `***`로 바꾼다.
 * Error는 같은 종류의 새 Error로(메시지·stack·cause를 가려서) 바꾼다. 순환·너무 깊은 값은 그대로 둔다.
 */
export function redactSecrets<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return scrubKnownSecrets(v);
    if (v === null || typeof v !== 'object') return v;
    if (depth > MAX_DEPTH) return v;
    if (seen.has(v)) return seen.get(v);
    if (v instanceof Error) return redactError(v, (x) => walk(x, depth + 1));
    if (Buffer.isBuffer(v) || ArrayBuffer.isView(v) || v instanceof Date || v instanceof RegExp) {
      return v;
    }
    if (Array.isArray(v)) {
      const arr: unknown[] = [];
      seen.set(v, arr);
      for (const item of v) arr.push(walk(item, depth + 1));
      return arr;
    }
    const proto = Object.getPrototypeOf(v) as object | null;
    if (proto !== Object.prototype && proto !== null) {
      // 클래스 인스턴스(요청 객체·토큰 등)는 모양을 바꾸지 않는다. 직렬화기·toJSON이 따로 다룬다
      return v;
    }
    const out: Record<string, unknown> = {};
    seen.set(v, out);
    for (const [key, item] of Object.entries(v as Record<string, unknown>)) {
      out[key] =
        (isSecretFieldName(key) || isSecretHeaderName(key)) && item !== null && item !== undefined
          ? SECRET_MASK
          : walk(item, depth + 1);
    }
    return out;
  };
  return walk(value, 0) as T;
}

function redactError(err: Error, walk: (v: unknown) => unknown): Error {
  const copy = Object.create(Object.getPrototypeOf(err) as object) as Error;
  for (const key of Object.getOwnPropertyNames(err)) {
    const desc = Object.getOwnPropertyDescriptor(err, key);
    if (!desc || !('value' in desc)) continue;
    let val: unknown = desc.value;
    if (key === 'message' || key === 'stack') {
      val = typeof val === 'string' ? scrubKnownSecrets(val) : val;
    } else if (isSecretFieldName(key)) {
      val = SECRET_MASK;
    } else {
      val = walk(val);
    }
    Object.defineProperty(copy, key, { ...desc, value: val });
  }
  return copy;
}
