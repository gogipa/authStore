import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables, LogLevel, NodeEnv } from './env.validation.js';

/** 검증된 환경변수를 타입 있게 읽는 창구. process.env를 직접 읽지 않는다. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  get nodeEnv(): NodeEnv {
    return this.config.get('NODE_ENV', { infer: true });
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }

  get databaseUrl(): string {
    return this.config.get('DATABASE_URL', { infer: true });
  }

  get appDataDir(): string {
    return this.config.get('APP_DATA_DIR', { infer: true });
  }

  get logLevel(): LogLevel {
    return this.config.get('LOG_LEVEL', { infer: true });
  }

  /** 커머스API 메타데이터 하루 1회 자동 동기화를 켜는지(`COMMERCE_META_AUTO_SYNC`, 기본 on, P1-08) */
  get commerceMetaAutoSync(): boolean {
    return this.config.get('COMMERCE_META_AUTO_SYNC', { infer: true }) !== 'off';
  }

  /** 개발에서만 더 허용하는 FE 개발 서버 Origin. 개발이 아니면 빈 배열. */
  get devFeOrigins(): string[] {
    if (!this.isDevelopment) return [];
    return this.config
      .get('DEV_FE_ORIGINS', { infer: true })
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}
