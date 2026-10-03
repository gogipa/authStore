import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';

/** 잰 폴더(05-2 StorageUsageKey). 응답·화면 순서도 이 순서 */
export const STORAGE_USAGE_KEYS = ['AGY_RECORDS', 'APP_IMAGES'] as const;
export type StorageUsageKey = (typeof STORAGE_USAGE_KEYS)[number];

/** agy 기록 폴더의 표시 글(D-25). 응답에는 절대 경로 대신 이것만 쓴다 */
export const AGY_RECORDS_DISPLAY_PATH = '~/.gemini/antigravity-cli';
/** 앱 데이터 폴더가 홈 밖일 때 앱 이미지 폴더의 표시 글(SSE 경로 가림의 '<데이터 폴더>'와 같은 이름) */
export const APP_IMAGES_FALLBACK_DISPLAY_PATH = '<데이터 폴더>/images';

/** 한 번 재기의 시간 한도 기본값(Proposed, D-25) */
export const STORAGE_USAGE_TIME_BUDGET_MS = 5_000;
/** 결과를 다시 쓰는 시간 기본값(Proposed, D-25) */
export const STORAGE_USAGE_CACHE_TTL_MS = 60_000;

/**
 * 저장 공간 재기 설정(주입 토큰 `STORAGE_USAGE_OPTIONS`). 앱 데이터 폴더는 AppConfigService에서 읽는다.
 * 테스트는 `overrideProvider(STORAGE_USAGE_OPTIONS)`로 agy 폴더를 임시 폴더로 바꾼다(사용자 `~/.gemini`를 읽지 않게).
 */
export interface StorageUsageOptions {
  /** agy 기록 폴더(절대 경로). 기본 `~/.gemini/antigravity-cli` */
  agyRoot: string;
  /** `~` 표시에 쓰는 홈 폴더. 기본 `os.homedir()` */
  homeDir: string;
  /** 한 번 재기의 시간 한도(ms). 두 폴더가 같은 마감을 쓴다 */
  timeBudgetMs: number;
  /** 결과를 다시 쓰는 시간(ms). `refresh=true`면 건너뛴다 */
  cacheTtlMs: number;
  /** 단조 시계(ms, 시간 한도용). 기본 `performance.now()` */
  monotonicNow?: () => number;
}

export const STORAGE_USAGE_OPTIONS = Symbol('STORAGE_USAGE_OPTIONS');

/** agy 기록 폴더(`<홈>/.gemini/antigravity-cli`). 사용자 입력이 닿지 않는 고정 경로다 */
export function defaultAgyRecordsRoot(home: string = homedir()): string {
  return join(home, '.gemini', 'antigravity-cli');
}

export function defaultStorageUsageOptions(home: string = homedir()): StorageUsageOptions {
  return {
    agyRoot: defaultAgyRecordsRoot(home),
    homeDir: home,
    timeBudgetMs: STORAGE_USAGE_TIME_BUDGET_MS,
    cacheTtlMs: STORAGE_USAGE_CACHE_TTL_MS,
  };
}

/**
 * 절대 경로 → 화면 표시 글. 홈 아래면 `~/a/b`(구분자는 `/`), 아니면 `fallback`.
 * 응답에 사용자 이름이 든 절대 경로를 넣지 않으려고 쓴다(05-1 §1.2).
 */
export function homeDisplayPath(absPath: string, home: string, fallback: string): string {
  if (home.length <= 1 || !isAbsolute(home)) return fallback;
  const rel = relative(home, absPath);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return fallback;
  return `~/${rel.split(sep).join('/')}`;
}
