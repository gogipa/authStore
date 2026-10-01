import { Global, Module } from '@nestjs/common';
import { LoggerModule, type Params } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import type { DestinationStream, LoggerOptions } from 'pino';
import type { Options as PinoHttpOptions } from 'pino-http';
import { AppConfigService } from '../config/app-config.service.js';
import type { LogLevel } from '../config/env.validation.js';
import {
  redactSecretHeaders,
  redactSecrets,
  SECRET_MASK,
  scrubKnownSecrets,
} from '../secrets/secret-mask.js';

/**
 * 로그 헤더 가림(들어오는 요청·응답). `authorization`·`proxy-authorization`·`cookie`·`set-cookie`·`x-*-secret`·
 * `x-*-token`·`x-*-key`는 `***`, 나머지 값의 알려진 비밀도 지운다(F-BS-25, secret-mask.ts).
 */
export function redactHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return redactSecretHeaders(headers);
}

/**
 * 로그 출력 대상(주입 토큰). 기본은 null(표준 출력). e2e 누출 검사는 메모리 스트림과 수준을 넣는다(P1-07).
 */
export interface LogDestination {
  stream: DestinationStream;
  level?: LogLevel;
}

export const LOG_DESTINATION = Symbol('LOG_DESTINATION');

/** pino 로그 인자 가림: 문자열의 알려진 비밀·`Bearer <토큰>`, 객체의 비밀 이름 키·헤더를 지운다 */
export const redactLogArgsHook: NonNullable<LoggerOptions['hooks']>['logMethod'] = function (
  this: unknown,
  args,
  method,
) {
  const safe = args.map((arg: unknown) =>
    typeof arg === 'string' ? scrubKnownSecrets(arg) : redactSecrets(arg),
  ) as Parameters<typeof method>;
  method.apply(this, safe);
};

/** nestjs-pino(pino-http) 설정. 테스트가 같은 설정으로 로거를 만들어 가림을 검사한다 */
export function buildPinoHttpOptions(options: {
  level: LogLevel;
  pretty: boolean;
}): PinoHttpOptions {
  return {
    level: options.level,
    transport: options.pretty
      ? {
          target: 'pino-pretty',
          options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
        }
      : undefined,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.headers.authorization',
        '*.headers.Authorization',
        'headers.authorization',
        'headers.Authorization',
      ],
      censor: SECRET_MASK,
    },
    hooks: { logMethod: redactLogArgsHook },
    serializers: {
      // 요청 본문·업로드 파일(이름 포함)은 로그에 넣지 않는다 — 비밀 키 입력, ⑦ 경쟁 태그 원본(TG-01·CON-09, P3-05)
      req: (req: { headers?: Record<string, unknown> } & Record<string, unknown>) => {
        const safe: Record<string, unknown> = {
          ...req,
          url: typeof req.url === 'string' ? scrubKnownSecrets(req.url) : req.url,
          headers: redactHeaders(req.headers),
        };
        delete safe.body;
        delete safe.file;
        delete safe.files;
        return safe;
      },
      res: (res: { headers?: Record<string, unknown> } & Record<string, unknown>) => ({
        ...res,
        headers: redactHeaders(res.headers),
      }),
    },
    // 요청 본문은 남기지 않는다(비밀 키 입력 API, 05-1 §1.2)
    customProps: (req: IncomingMessage) => ({ method: req.method }),
  };
}

/** LOG_DESTINATION 기본값(null = 표준 출력). e2e가 overrideProvider로 바꾼다 */
@Global()
@Module({
  providers: [{ provide: LOG_DESTINATION, useValue: null }],
  exports: [LOG_DESTINATION],
})
export class LogDestinationModule {}

@Module({
  imports: [
    LogDestinationModule,
    LoggerModule.forRootAsync({
      imports: [LogDestinationModule],
      inject: [AppConfigService, LOG_DESTINATION],
      useFactory: (config: AppConfigService, destination: LogDestination | null): Params => {
        const options = buildPinoHttpOptions({
          level: destination?.level ?? config.logLevel,
          // 출력 스트림을 받으면 pretty(transport)는 쓰지 않는다(pino는 둘을 같이 받지 않는다)
          pretty: config.isDevelopment && !destination,
        });
        return { pinoHttp: destination ? [options, destination.stream] : options };
      },
    }),
  ],
})
export class LoggingModule {}
