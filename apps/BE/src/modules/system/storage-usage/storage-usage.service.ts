import { statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service.js';
import { IMAGES_DIR } from '../../../common/files/file-storage.service.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import { type DirectorySize, measureDirectory } from './directory-size.js';
import type { StorageDiskSpaceDto, StorageUsageDto } from './storage-usage.dto.js';
import {
  AGY_RECORDS_DISPLAY_PATH,
  APP_IMAGES_FALLBACK_DISPLAY_PATH,
  homeDisplayPath,
  STORAGE_USAGE_OPTIONS,
  type StorageUsageOptions,
} from './storage-usage.options.js';

type StatfsFn = (
  path: string,
  options: { bigint: true },
) => Promise<{
  bavail: bigint;
  blocks: bigint;
  bsize: bigint;
}>;

/**
 * 폴더가 있는 디스크(볼륨)의 남은 공간·전체(statfs). 남은 공간은 일반 사용자가 쓸 수 있는 블록(bavail)이다.
 * 읽지 못하면(폴더 없음·지원 안 함) 두 값 모두 null.
 */
export async function readDiskSpace(
  path: string,
  statfsFn: StatfsFn = statfs,
): Promise<StorageDiskSpaceDto> {
  try {
    const s = await statfsFn(path, { bigint: true });
    return { freeBytes: Number(s.bavail * s.bsize), totalBytes: Number(s.blocks * s.bsize) };
  } catch {
    return { freeBytes: null, totalBytes: null };
  }
}

interface CachedUsage {
  value: StorageUsageDto;
  /** CLOCK 기준 만료 시각(ms) */
  expiresAtMs: number;
}

/**
 * 저장 공간(D-25, F-ST-33, 05-2 getStorageUsage). SCR-13 '저장 공간' 패널의 값이다. **읽기 전용**이다.
 * - 잰 폴더는 두 곳뿐이다: agy 기록(`~/.gemini/antigravity-cli`, 홈에서 정한 고정 경로)과 앱 이미지(`APP_DATA_DIR/images`).
 *   요청 값은 경로에 닿지 않는다. 폴더 목록·lstat·statfs만 쓰고 파일 내용은 읽지 않는다. 지우거나 쓰지 않는다.
 * - 두 폴더를 함께 재고 같은 마감(기본 5초)을 쓴다. 넘으면 센 만큼을 PARTIAL로 준다.
 * - 결과는 1분(CLOCK 기준) 동안 다시 쓴다. `refresh`면 새로 잰다. 재는 중에 온 요청은 그 결과를 같이 받는다.
 * - 응답에는 절대 경로를 넣지 않는다(표시 글 `~/…`·`<데이터 폴더>/images`, 05-1 §1.2). 로그에도 경로를 남기지 않는다.
 */
@Injectable()
export class StorageUsageService {
  private readonly logger = new Logger(StorageUsageService.name);
  private cached: CachedUsage | null = null;
  private inFlight: Promise<StorageUsageDto> | null = null;

  constructor(
    private readonly config: AppConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORAGE_USAGE_OPTIONS) private readonly options: StorageUsageOptions,
  ) {}

  get(refresh = false): Promise<StorageUsageDto> {
    if (this.inFlight) return this.inFlight;
    const cached = this.cached;
    if (!refresh && cached && this.clock.now().getTime() < cached.expiresAtMs) {
      return Promise.resolve(cached.value);
    }
    const run = this.measure().finally(() => {
      if (this.inFlight === run) this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async measure(): Promise<StorageUsageDto> {
    const measuredAt = this.clock.now();
    const now = this.options.monotonicNow ?? (() => performance.now());
    const startedMs = now();
    const deadline = startedMs + this.options.timeBudgetMs;
    const dataDir = resolve(this.config.appDataDir);
    const imagesDir = join(dataDir, IMAGES_DIR);

    const [agy, images, disk] = await Promise.all([
      measureDirectory(this.options.agyRoot, { deadline, now }),
      measureDirectory(imagesDir, { deadline, now }),
      readDiskSpace(dataDir),
    ]);

    const value: StorageUsageDto = {
      items: [
        item('AGY_RECORDS', AGY_RECORDS_DISPLAY_PATH, agy),
        item(
          'APP_IMAGES',
          homeDisplayPath(imagesDir, this.options.homeDir, APP_IMAGES_FALLBACK_DISPLAY_PATH),
          images,
        ),
      ],
      disk,
      measuredAt: measuredAt.toISOString(),
    };
    this.cached = { value, expiresAtMs: this.clock.now().getTime() + this.options.cacheTtlMs };
    this.logger.debug(
      {
        agy: agy.status,
        images: images.status,
        diskRead: disk.freeBytes !== null,
        durationMs: Math.round(now() - startedMs),
      },
      '저장 공간을 쟀습니다',
    );
    return value;
  }
}

function item(
  key: StorageUsageDto['items'][number]['key'],
  displayPath: string,
  size: DirectorySize,
): StorageUsageDto['items'][number] {
  return { key, displayPath, status: size.status, bytes: size.bytes, fileCount: size.fileCount };
}
