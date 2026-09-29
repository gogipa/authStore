/** 05-2 components.schemas.FieldError */
export interface FieldError {
  field: string;
  message: string;
  rejectedValue?: unknown;
}

/** 05-2 components.schemas.ErrorResponse(05-3 §2 오류 봉투) */
export interface ErrorResponse {
  code: string;
  message: string;
  status: number;
  timestamp: string;
  path: string;
  fieldErrors?: FieldError[];
  details?: Record<string, unknown>;
}

/** 지역 시간대 오프셋을 붙인 ISO 8601(예 2026-09-27T14:02:11+09:00). 05-1 §1.1 */
export function formatTimestamp(date: Date = new Date()): string {
  const pad = (n: number): string => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`
  );
}

export function buildErrorResponse(input: {
  code: string;
  message: string;
  status: number;
  path: string;
  fieldErrors?: FieldError[];
  details?: Record<string, unknown>;
  now?: Date;
}): ErrorResponse {
  const body: ErrorResponse = {
    code: input.code,
    message: input.message,
    status: input.status,
    timestamp: formatTimestamp(input.now),
    path: input.path,
  };
  if (input.fieldErrors && input.fieldErrors.length > 0) body.fieldErrors = input.fieldErrors;
  if (input.details && Object.keys(input.details).length > 0) body.details = input.details;
  return body;
}
