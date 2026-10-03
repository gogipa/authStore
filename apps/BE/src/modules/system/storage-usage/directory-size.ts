import type { Dirent, Stats } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** 폴더 재기 결과 상태(05-2 StorageUsageStatus, D-25) */
export const STORAGE_USAGE_STATUSES = ['OK', 'PARTIAL', 'NOT_FOUND', 'UNREADABLE'] as const;
export type StorageUsageStatus = (typeof STORAGE_USAGE_STATUSES)[number];

/** 폴더 하나의 크기·파일 수. NOT_FOUND·UNREADABLE이면 둘 다 null */
export interface DirectorySize {
  status: StorageUsageStatus;
  bytes: number | null;
  fileCount: number | null;
}

/** 파일 시스템 함수(테스트가 바꿔 끼운다). 읽기 함수만 둔다 — 쓰기·지우기 함수는 받지도 않는다 */
export interface DirectoryReadOps {
  lstat: (path: string) => Promise<Stats>;
  readdir: (path: string, options: { withFileTypes: true }) => Promise<Dirent[]>;
}

export interface MeasureDirectoryOptions {
  /** 이 시각(`now()` 기준 ms)이 지나면 더 읽지 않고 센 만큼을 PARTIAL로 돌려준다 */
  deadline: number;
  /** 단조 시계(ms). 기본 `performance.now()` */
  now?: () => number;
  /** 한 폴더 안의 파일 lstat을 한 번에 몇 개까지 기다리는지(기본 32) */
  concurrency?: number;
  ops?: DirectoryReadOps;
}

const DEFAULT_CONCURRENCY = 32;
const DEFAULT_OPS: DirectoryReadOps = { lstat, readdir };
/** 사라진 항목(읽는 사이 agy가 지운 파일 등). 일부만 잰 것으로 보지 않는다 */
const GONE_CODES = new Set(['ENOENT', 'ENOTDIR']);

const NOT_FOUND: DirectorySize = { status: 'NOT_FOUND', bytes: null, fileCount: null };
const UNREADABLE: DirectorySize = { status: 'UNREADABLE', bytes: null, fileCount: null };

function isGone(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && GONE_CODES.has(code);
}

/**
 * 폴더 아래 일반 파일의 크기(st_size) 합과 개수를 잰다(D-25, F-ST-33). 읽기 전용이다.
 * - 폴더 목록(readdir)과 lstat만 쓴다. 파일 내용은 읽지 않고, 쓰거나 지우지 않는다.
 * - 바로가기(심볼릭 링크)는 따라가지 않고 세지도 않는다. 뿌리가 바로가기·파일이면 UNREADABLE.
 * - 하위 폴더를 읽지 못하면(권한 등) 건너뛰고 PARTIAL. 읽는 사이 사라진 항목은 그냥 건너뛴다.
 * - `deadline`이 지나면 멈추고 센 만큼을 PARTIAL로 준다(하위 폴더 하나를 읽는 도중에는 끊지 않는다).
 */
export async function measureDirectory(
  root: string,
  options: MeasureDirectoryOptions,
): Promise<DirectorySize> {
  const now = options.now ?? (() => performance.now());
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const ops = options.ops ?? DEFAULT_OPS;

  try {
    const rootStat = await ops.lstat(root);
    if (!rootStat.isDirectory()) return UNREADABLE;
  } catch (error) {
    return isGone(error) ? NOT_FOUND : UNREADABLE;
  }

  let bytes = 0;
  let fileCount = 0;
  let partial = false;
  const pending: string[] = [root];

  walk: while (pending.length > 0) {
    if (now() >= options.deadline) {
      partial = true;
      break;
    }
    const dir = pending.pop()!;
    let entries: Dirent[];
    try {
      entries = await ops.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (dir === root) return isGone(error) ? NOT_FOUND : UNREADABLE;
      if (!isGone(error)) partial = true;
      continue;
    }
    const files: string[] = [];
    for (const entry of entries) {
      // Dirent 종류는 링크를 따라가지 않는다(isDirectory는 링크면 false)
      if (entry.isDirectory()) pending.push(join(dir, entry.name));
      else if (entry.isFile()) files.push(join(dir, entry.name));
    }
    for (let i = 0; i < files.length; i += concurrency) {
      if (now() >= options.deadline) {
        partial = true;
        break walk;
      }
      const stats = await Promise.allSettled(
        files.slice(i, i + concurrency).map((f) => ops.lstat(f)),
      );
      for (const result of stats) {
        if (result.status === 'fulfilled') {
          if (result.value.isFile()) {
            bytes += result.value.size;
            fileCount += 1;
          }
        } else if (!isGone(result.reason)) {
          partial = true;
        }
      }
    }
  }

  return { status: partial ? 'PARTIAL' : 'OK', bytes, fileCount };
}
