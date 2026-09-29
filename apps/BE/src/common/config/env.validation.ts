import { plainToInstance, Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import { isAbsolute, resolve } from 'node:path';
import { DEFAULT_APP_DATA_DIR, REPO_ROOT } from './paths.js';

export const NODE_ENVS = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const DEFAULT_DEV_FE_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173';

/** 시작할 때 검증하는 환경변수(06-4). 틀리면 앱이 뜨지 않는다. */
export class EnvironmentVariables {
  @IsOptional()
  @IsIn(NODE_ENVS)
  NODE_ENV: NodeEnv = 'development';

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? Number(value) : value))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3100;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsOptional()
  @IsString()
  APP_DATA_DIR: string = DEFAULT_APP_DATA_DIR;

  @IsOptional()
  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevel = 'info';

  @IsOptional()
  @IsString()
  DEV_FE_ORIGINS: string = DEFAULT_DEV_FE_ORIGINS;
}

export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  // 빈 값('KEY=')은 없는 것으로 보고 기본값을 쓴다
  const present = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => !(typeof v === 'string' && v.trim() === '')),
  );
  const env = plainToInstance(EnvironmentVariables, present, { exposeDefaultValues: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const lines = errors.map(
      (e) => `- ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
    );
    throw new Error(`환경변수 검증 실패(apps/BE/.env.example 참고)\n${lines.join('\n')}`);
  }
  if (!isAbsolute(env.APP_DATA_DIR)) {
    env.APP_DATA_DIR = resolve(REPO_ROOT, env.APP_DATA_DIR);
  }
  return env;
}
