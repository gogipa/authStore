import { existsSync } from 'node:fs';
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
export const DEFAULT_APP_DATA_DIR = join(REPO_ROOT, '.data');
