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
import { isAbsolute, relative, resolve } from 'node:path';
import { APPS_DIR, DEFAULT_APP_DATA_DIR, defaultProductionDataDir, REPO_ROOT } from './paths.js';

export const NODE_ENVS = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const DEFAULT_DEV_FE_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173';

/** 켜기·끄기 환경변수 값 */
export const ON_OFF = ['on', 'off'] as const;
export type OnOff = (typeof ON_OFF)[number];

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

  /** 비우면 개발·테스트는 저장소 루트 .data, 운영은 OS 사용자 데이터 폴더(validateEnv가 채운다) */
  @IsOptional()
  @IsString()
  APP_DATA_DIR: string = '';

  @IsOptional()
  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevel = 'info';

  @IsOptional()
  @IsString()
  DEV_FE_ORIGINS: string = DEFAULT_DEV_FE_ORIGINS;

  /** 커머스API 메타데이터 하루 1회 자동 동기화(P1-08). off면 '지금 동기화'로만 받는다 */
  @IsOptional()
  @IsIn(ON_OFF)
  COMMERCE_META_AUTO_SYNC: OnOff = 'on';

  /**
   * 앱을 켤 때 AI 엔진 감지 + 선택 엔진 계약 테스트(P1-10 규칙 13). off면 돌지 않는다(개발 중 구독 쿼터 아끼기).
   * off면 점검 기록이 없어 AI 단계 시작이 409 AI_ENGINE_UNAVAILABLE(NOT_CHECKED)로 막힌다 — 'AI 엔진'에서 연결 테스트를 한다
   */
  @IsOptional()
  @IsIn(ON_OFF)
  AI_ENGINE_STARTUP_CHECK: OnOff = 'on';

  /**
   * 환율 자동 수집(P2-04 — 원가 환율 영업일 11시 뒤 하루 1회, 과세환율 주 1회). off면 설정 화면 '환율 직접 입력'으로만 넣는다.
   * 키(KOREAEXIM_API_KEY·CUSTOMS_SERVICE_KEY)가 없으면 켜 두어도 부르지 않고 실패 경고만 띄운다
   */
  @IsOptional()
  @IsIn(ON_OFF)
  FX_AUTO_COLLECT: OnOff = 'on';
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
  if (env.APP_DATA_DIR === '') {
    env.APP_DATA_DIR =
      env.NODE_ENV === 'production' ? defaultProductionDataDir(raw) : DEFAULT_APP_DATA_DIR;
  }
  if (!isAbsolute(env.APP_DATA_DIR)) {
    env.APP_DATA_DIR = resolve(REPO_ROOT, env.APP_DATA_DIR);
  }
  // F-BS-02: 설정·이미지·로그는 코드 폴더(apps/)에 쓰지 않고, 운영은 설치 폴더(저장소) 밖에만 쓴다
  if (isInsideOrSame(APPS_DIR, env.APP_DATA_DIR)) {
    throw new Error(
      '환경변수 검증 실패(apps/BE/.env.example 참고)\n- APP_DATA_DIR: 코드 폴더(apps/) 안은 쓸 수 없습니다',
    );
  }
  if (env.NODE_ENV === 'production' && isInsideOrSame(REPO_ROOT, env.APP_DATA_DIR)) {
    throw new Error(
      '환경변수 검증 실패(apps/BE/.env.example 참고)\n- APP_DATA_DIR: 운영에서는 설치 폴더 밖이어야 합니다',
    );
  }
  return env;
}

function isInsideOrSame(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
