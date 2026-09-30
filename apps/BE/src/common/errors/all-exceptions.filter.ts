import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { redactSecrets, scrubKnownSecrets } from '../secrets/secret-mask.js';
import { ApiException } from './api.exception.js';
import { ERROR_CODES, type ErrorCode } from './error-codes.js';
import { buildErrorResponse, type ErrorResponse } from './error-response.js';

/**
 * 모든 예외를 05-3 오류 봉투로 바꾼다.
 * - ApiException: 코드 그대로(headers가 있으면 응답 헤더로, 예: Retry-After)
 * - 없는 경로(Nest 404): ROUTE_NOT_FOUND(Proposed)
 * - JSON 파싱 실패(body-parser → 400)·그 밖 본문 파싱 오류(끊긴 요청·모르는 charset): MALFORMED_REQUEST
 * - 본문 크기 초과(PayloadTooLargeException·body-parser `entity.too.large`, P2-01): PAYLOAD_TOO_LARGE
 * - 그 밖: INTERNAL_ERROR(내부 메시지는 로그에만, 응답에는 05-3 문구만)
 * 응답 message·details·fieldErrors와 로그에서 알려진 비밀값을 지운다(F-BS-25, secret-mask.ts).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const body = this.toBody(exception, req.originalUrl ?? req.url);
    if (body.status >= 500) {
      this.logger.error(
        redactSecrets({ err: exception, code: body.code, path: body.path }),
        scrubKnownSecrets(exception instanceof Error ? exception.message : 'unknown error'),
      );
    }
    if (exception instanceof ApiException && exception.headers) {
      for (const [name, value] of Object.entries(exception.headers)) res.setHeader(name, value);
    }
    res.status(body.status).json(body);
  }

  toBody(exception: unknown, path: string): ErrorResponse {
    if (exception instanceof ApiException) {
      return buildErrorResponse({
        code: exception.code,
        message: scrubKnownSecrets(exception.message),
        status: exception.getStatus(),
        path: scrubKnownSecrets(path),
        fieldErrors: exception.fieldErrors && redactSecrets(exception.fieldErrors),
        details: exception.details && redactSecrets(exception.details),
      });
    }
    return fromCode(mapHttpException(exception), scrubKnownSecrets(path));
  }
}

/**
 * body-parser(Express 본문 파싱)가 던진 http-errors인가. Nest는 JSON 문법 오류(SyntaxError)만 400으로 바꾸고, 본문 크기 초과
 * (`entity.too.large`)·끊긴 요청(`request.aborted`)·모르는 charset 등은 그대로 넘긴다(P2-01: JSON 본문 상한 1MB를 넘으면 500이
 * 아니라 413이어야 한다). 모양: `expose: true`, 숫자 `status`, 글자 `type`(`entity.*`·`request.*`·`charset.*`·`encoding.*`).
 */
function bodyParserStatus(exception: unknown): number | null {
  if (!(exception instanceof Error)) return null;
  const e = exception as Error & { status?: unknown; type?: unknown; expose?: unknown };
  if (e.expose !== true || typeof e.status !== 'number' || typeof e.type !== 'string') return null;
  return /^(entity|request|charset|encoding)\./.test(e.type) ? e.status : null;
}

function mapHttpException(exception: unknown): ErrorCode {
  const parserStatus = bodyParserStatus(exception);
  if (parserStatus !== null) {
    return parserStatus === Number(HttpStatus.PAYLOAD_TOO_LARGE)
      ? 'PAYLOAD_TOO_LARGE'
      : 'MALFORMED_REQUEST';
  }
  if (exception instanceof NotFoundException) return 'ROUTE_NOT_FOUND';
  if (exception instanceof PayloadTooLargeException) return 'PAYLOAD_TOO_LARGE';
  if (exception instanceof BadRequestException) return 'MALFORMED_REQUEST';
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status === Number(HttpStatus.NOT_FOUND)) return 'ROUTE_NOT_FOUND';
    if (status === Number(HttpStatus.PAYLOAD_TOO_LARGE)) return 'PAYLOAD_TOO_LARGE';
    if (status === Number(HttpStatus.BAD_REQUEST)) return 'MALFORMED_REQUEST';
  }
  return 'INTERNAL_ERROR';
}

function fromCode(code: ErrorCode, path: string): ErrorResponse {
  const def = ERROR_CODES[code];
  return buildErrorResponse({ code, message: def.message, status: def.status, path });
}
