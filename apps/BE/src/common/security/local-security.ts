import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_CODES, type ErrorCode } from '../errors/error-codes.js';
import { buildErrorResponse } from '../errors/error-response.js';

/** 상태를 바꾸는 메서드(05-1 §1.2). 이 요청만 Origin·사용자 정의 헤더를 본다. */
export const STATE_CHANGING_METHODS: ReadonlySet<string> = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

export const CLIENT_HEADER = 'x-autostore-client';

export interface LocalSecurityRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  /** 요청이 들어온 로컬 포트(= 앱이 듣는 포트) */
  localPort: number | undefined;
}

export interface LocalSecurityOptions {
  /** 개발에서 더 허용하는 Origin(FE 개발 서버). 운영·테스트는 빈 배열 */
  extraAllowedOrigins: readonly string[];
  /** 막은 요청을 알린다(로그용). 헤더 값은 넘기지 않는다 */
  onBlocked?: (info: { code: ErrorCode; method: string; path: string }) => void;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 로컬 보안 규칙(03-2 §5, 05-1 §1.2). 막아야 하면 오류 코드, 통과면 null.
 * 1) Host가 127.0.0.1:포트·localhost:포트가 아니면 HOST_NOT_ALLOWED(모든 요청, SSE 포함)
 * 2) 상태 변경 요청의 Origin이 있고 앱 자신(개발은 FE 개발 서버 포함)이 아니면 ORIGIN_NOT_ALLOWED
 * 3) 상태 변경 요청에 X-AutoStore-Client: 1이 없으면 CLIENT_HEADER_REQUIRED
 * CORS는 켜지 않는다(허용 헤더를 내보내지 않음).
 */
export function checkLocalSecurity(
  req: LocalSecurityRequest,
  options: LocalSecurityOptions,
): ErrorCode | null {
  const port = req.localPort;
  const host = single(req.headers.host)?.trim().toLowerCase();
  const allowedHosts = port === undefined ? [] : [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!host || !allowedHosts.includes(host)) return 'HOST_NOT_ALLOWED';

  if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) return null;

  const origin = single(req.headers.origin)?.trim();
  if (origin !== undefined) {
    const allowedOrigins = [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      ...options.extraAllowedOrigins,
    ];
    if (!allowedOrigins.includes(origin)) return 'ORIGIN_NOT_ALLOWED';
  }

  if (single(req.headers[CLIENT_HEADER])?.trim() !== '1') return 'CLIENT_HEADER_REQUIRED';
  return null;
}

/** Express 전역 미들웨어. Nest 라우터·정적 파일·본문 파싱보다 먼저 돈다(app.setup.ts). */
export function localSecurityMiddleware(options: LocalSecurityOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const code = checkLocalSecurity(
      { method: req.method, headers: req.headers, localPort: req.socket.localPort },
      options,
    );
    if (code === null) {
      next();
      return;
    }
    options.onBlocked?.({ code, method: req.method, path: req.originalUrl });
    const def = ERROR_CODES[code];
    res.status(def.status).json(
      buildErrorResponse({
        code,
        message: def.message,
        status: def.status,
        path: req.originalUrl,
      }),
    );
  };
}
