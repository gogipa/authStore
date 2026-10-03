import { type NestApplicationOptions, Logger as NestLogger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { AppConfigService } from './common/config/app-config.service.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { ERROR_CODES } from './common/errors/error-codes.js';
import { buildErrorResponse } from './common/errors/error-response.js';
import { AppValidationPipe } from './common/errors/app-validation.pipe.js';
import { localSecurityMiddleware } from './common/security/local-security.js';

export const API_PREFIX = 'api/v1';

/**
 * 앱을 만들 때 쓰는 옵션. main.ts와 e2e·흐름 테스트 앱이 같이 쓴다.
 * - `bufferLogs`: pino 로거를 붙이기 전 로그를 모아 둔다.
 * - `forceCloseConnections`(Proposed, 06-2 §9-257~262): 앱을 닫을 때 열린 HTTP 연결(SSE·keep-alive)을 끊는다. 없으면 `app.close()`가
 *   SSE 연결이 끝나기를 한없이 기다린다(25초 연결 유지 주석이 스트림을 살려 둔다). 그러면 프로세스가 끝나지 않아
 *   `nest start --watch`가 새 프로세스를 띄우지 못한다.
 */
export const NEST_APP_OPTIONS: NestApplicationOptions = {
  bufferLogs: true,
  forceCloseConnections: true,
};

/**
 * JSON 본문 상한(Proposed, P2-01 06-2 §9). Express 기본 100kb로는 붙여넣기 글 100,000자(한글이면 약 300KB)를 받지 못한다.
 * 글자 수 상한(413 PAYLOAD_TOO_LARGE)은 API가 따로 본다. 이 값을 넘는 본문도 413 PAYLOAD_TOO_LARGE다.
 */
export const JSON_BODY_LIMIT = '1mb';

/**
 * main.ts와 e2e 테스트가 같이 쓰는 앱 설정. listen 전에 부른다.
 * 요청 순서: 로컬 보안 → 본문 파싱 → Nest 라우트(/api/v1) → 정적 화면(운영) → 404 봉투
 */
export async function configureApp(app: NestExpressApplication): Promise<void> {
  const config = app.get(AppConfigService);
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  // 로컬 보안은 본문 파싱·라우팅·정적 파일보다 먼저(모든 요청). CORS는 켜지 않는다.
  const securityLog = new NestLogger('LocalSecurity');
  app.use(
    localSecurityMiddleware({
      extraAllowedOrigins: config.devFeOrigins,
      onBlocked: ({ code, method, path }) => securityLog.warn(`${code} ${method} ${path}`),
    }),
  );
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(new AppValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  await app.init();
  // Nest의 404 처리는 /api/v1 아래만 맡는다. 그 밖(/api/v2, 화면이 없을 때의 /)도 같은 봉투로 답한다.
  app.use((req: Request, res: Response) => {
    const { status, message } = ERROR_CODES.ROUTE_NOT_FOUND;
    res
      .status(status)
      .json(
        buildErrorResponse({ code: 'ROUTE_NOT_FOUND', message, status, path: req.originalUrl }),
      );
  });
}
