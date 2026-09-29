import { HttpException } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from './error-codes.js';
import type { FieldError } from './error-response.js';

/** 도메인 오류. 전역 예외 필터가 05-3 봉투로 바꾼다. */
export class ApiException extends HttpException {
  readonly code: ErrorCode;
  readonly fieldErrors?: FieldError[];
  readonly details?: Record<string, unknown>;
  /** 응답에 붙일 헤더(예: 409 하루 상한·24시간 쉼의 Retry-After, 05-3 §2) */
  readonly headers?: Readonly<Record<string, string>>;

  constructor(
    code: ErrorCode,
    options: {
      message?: string;
      fieldErrors?: FieldError[];
      details?: Record<string, unknown>;
      headers?: Record<string, string>;
    } = {},
  ) {
    const def = ERROR_CODES[code];
    const message = options.message ?? def.message;
    super(message, def.status);
    this.code = code;
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
    this.headers = options.headers;
  }
}
