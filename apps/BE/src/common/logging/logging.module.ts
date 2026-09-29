import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import { AppConfigService } from '../config/app-config.service.js';

/** 로그에 남기지 않는 헤더. x-*-secret 형식은 정규식으로 가린다. */
const SECRET_HEADER = /^(authorization|cookie|set-cookie|x-.*-secret)$/i;

export function redactHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!headers) return headers;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = SECRET_HEADER.test(k) ? '[Redacted]' : v;
  return out;
}

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.logLevel,
          transport: config.isDevelopment
            ? {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
              }
            : undefined,
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
            censor: '[Redacted]',
          },
          serializers: {
            req: (req: { headers?: Record<string, unknown> } & Record<string, unknown>) => ({
              ...req,
              headers: redactHeaders(req.headers),
            }),
            res: (res: { headers?: Record<string, unknown> } & Record<string, unknown>) => ({
              ...res,
              headers: redactHeaders(res.headers),
            }),
          },
          // 요청 본문은 남기지 않는다(비밀 키 입력 API, 05-1 §1.2)
          customProps: (req: IncomingMessage) => ({ method: req.method }),
        },
      }),
    }),
  ],
})
export class LoggingModule {}
