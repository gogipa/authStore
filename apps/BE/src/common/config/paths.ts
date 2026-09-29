import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 이 파일에서 위로 올라가며 pnpm-workspace.yaml이 있는 저장소 루트를 찾는다(src·dist 어디서 돌아도 같다). */
function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start, '../../../..');
    dir = parent;
  }
}

export const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
export const BE_ROOT = join(REPO_ROOT, 'apps', 'BE');
export const BE_ENV_FILE = join(BE_ROOT, '.env');
export const FE_DIST_DIR = join(REPO_ROOT, 'apps', 'FE', 'dist');
/** 코드 폴더. 앱 데이터를 여기에 쓰지 않는다(F-BS-02) */
export const APPS_DIR = join(REPO_ROOT, 'apps');
/** 개발·테스트 기본 데이터 폴더(저장소 루트 .data, git 제외) */
export const DEFAULT_APP_DATA_DIR = join(REPO_ROOT, '.data');

/** 앱 이름(사용자 데이터 폴더 이름) */
export const APP_DIR_NAME = 'autoStore';

/**
 * 운영(설치본) 기본 데이터 폴더: 설치 폴더 밖의 OS 사용자 데이터 폴더(F-BS-02, US-36 AC3). Proposed(06-4).
 * - macOS: ~/Library/Application Support/autoStore
 * - Windows: %APPDATA%\autoStore
 * - 그 밖: $XDG_DATA_HOME/autoStore(없으면 ~/.local/share/autoStore)
 */
export function defaultProductionDataDir(
  env: Record<string, unknown> = {},
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const str = (k: string): string | undefined => {
    const v = env[k];
    return typeof v === 'string' && v.trim() !== '' ? v : undefined;
  };
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', APP_DIR_NAME);
  if (platform === 'win32') {
    return join(str('APPDATA') ?? join(home, 'AppData', 'Roaming'), APP_DIR_NAME);
  }
  return join(str('XDG_DATA_HOME') ?? join(home, '.local', 'share'), APP_DIR_NAME);
}
