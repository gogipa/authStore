import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { STORAGE_USAGE_STATUSES, type StorageUsageStatus } from './directory-size.js';
import { STORAGE_USAGE_KEYS, type StorageUsageKey } from './storage-usage.options.js';

/** 쿼리 불리언: 'true'·'false' 글자만 받는다(그 밖은 그대로 두어 IsBoolean이 422 INVALID_QUERY_PARAMETER로 막는다) */
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

// ── 요청 ─────────────────────────────────────────────────────────────────

/** GET /storage-usage 쿼리(05-2 getStorageUsage) */
export class StorageUsageQueryDto {
  @ApiPropertyOptional({
    type: 'boolean',
    default: false,
    description: 'true면 1분 캐시를 쓰지 않고 새로 잰다([다시 재기])',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'true 또는 false여야 합니다.' })
  refresh?: boolean;
}

// ── 응답 ─────────────────────────────────────────────────────────────────

/** 05-2 components.schemas.StorageUsageItem */
export class StorageUsageItemDto {
  @ApiProperty({ enum: STORAGE_USAGE_KEYS })
  key!: StorageUsageKey;

  @ApiProperty({
    maxLength: 512,
    description:
      '화면에 보일 위치. 절대 경로가 아니다 — 홈 아래면 `~/…`, 앱 데이터 폴더가 홈 밖이면 `<데이터 폴더>/images`',
  })
  displayPath!: string;

  @ApiProperty({ enum: STORAGE_USAGE_STATUSES })
  status!: StorageUsageStatus;

  @ApiProperty({
    type: 'integer',
    format: 'int64',
    nullable: true,
    minimum: 0,
    description: '일반 파일 크기의 합(바이트). PARTIAL이면 센 만큼. NOT_FOUND·UNREADABLE이면 null',
  })
  bytes!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    minimum: 0,
    description: '일반 파일 수. PARTIAL이면 센 만큼. NOT_FOUND·UNREADABLE이면 null',
  })
  fileCount!: number | null;
}

/** 05-2 components.schemas.StorageDiskSpace */
export class StorageDiskSpaceDto {
  @ApiProperty({
    type: 'integer',
    format: 'int64',
    nullable: true,
    minimum: 0,
    description: '남은 공간(바이트, statfs bavail × bsize)',
  })
  freeBytes!: number | null;

  @ApiProperty({
    type: 'integer',
    format: 'int64',
    nullable: true,
    minimum: 0,
    description: '전체 크기(바이트, statfs blocks × bsize)',
  })
  totalBytes!: number | null;
}

/** 05-2 components.schemas.StorageUsage */
export class StorageUsageDto {
  @ApiProperty({
    type: [StorageUsageItemDto],
    description: '폴더 2개(AGY_RECORDS·APP_IMAGES 순서)',
  })
  items!: StorageUsageItemDto[];

  @ApiProperty({ type: StorageDiskSpaceDto })
  disk!: StorageDiskSpaceDto;

  @ApiProperty({
    type: 'string',
    format: 'date-time',
    description: '잰 시각. 캐시 값이면 처음 잰 시각이다',
  })
  measuredAt!: string;
}
