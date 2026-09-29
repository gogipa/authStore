import { HttpException } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from './error-codes.js';
import type { FieldError } from './error-response.js';

/** 도메인 오류. 전역 예외 필터가 05-3 봉투로 바꾼다. */
export class ApiException extends HttpException {
  readonly code: string;
  readonly fieldErrors?: FieldError[];
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    options: {
      message?: string;
      fieldErrors?: FieldError[];
      details?: Record<string, unknown>;
    } = {},
  ) {
    const def = ERROR_CODES[code];
    const message = options.message ?? def.message;
    super(message, def.status);
    this.code = code;
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
  }
}
