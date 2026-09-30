/**
 * 커머스API 오류 본문 해석(R04 §2.2·FR-13). 게이트웨이·API 오류는 대개
 * `{ code, message, timestamp, traceId, invalidInputs?: [{ name, type, message }] }` 모양이다.
 * JSON이 아니거나 모양이 다르면 빈 값으로 둔다(던지지 않는다).
 */
export interface CommerceInvalidInput {
  name: string | null;
  type: string | null;
  message: string | null;
}

export interface CommerceErrorBody {
  code: string | null;
  message: string | null;
  invalidInputs: CommerceInvalidInput[];
  traceId: string | null;
}

const EMPTY: CommerceErrorBody = { code: null, message: null, invalidInputs: [], traceId: null };

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;

export function parseCommerceErrorBody(body: Buffer | string): CommerceErrorBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof body === 'string' ? body : body.toString('utf8'));
  } catch {
    return { ...EMPTY, invalidInputs: [] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...EMPTY, invalidInputs: [] };
  }
  const o = parsed as Record<string, unknown>;
  const invalidInputs = Array.isArray(o.invalidInputs)
    ? o.invalidInputs
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map((x) => ({
          name: str(x.name, 200),
          type: str(x.type, 100),
          message: str(x.message, 500),
        }))
    : [];
  return {
    code: str(o.code, 100),
    message: str(o.message, 500),
    invalidInputs,
    traceId: str(o.traceId, 100),
  };
}

/** 오류 코드(call_log.error_code): 본문 `code`, 없으면 `HTTP_<상태>` */
export function commerceErrorCode(status: number, body: CommerceErrorBody): string {
  return body.code ?? `HTTP_${status}`;
}
