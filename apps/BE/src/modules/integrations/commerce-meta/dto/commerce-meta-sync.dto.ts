import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsIn, ValidateIf } from 'class-validator';
import {
  META_SYNC_RUN_STATUSES,
  META_SYNC_TARGETS,
  type MetaSyncRunStatus,
  type MetaSyncTarget,
} from '../commerce-meta.constants.js';

/** 05-2 components.schemas.CommerceMetaSyncRun */
export class CommerceMetaSyncRunDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({
    enum: META_SYNC_TARGETS,
    description: '메타데이터 동기화 대상(ck_cmsr_target, RG-03)',
  })
  target!: MetaSyncTarget;

  @ApiProperty({ enum: META_SYNC_RUN_STATUSES })
  status!: MetaSyncRunStatus;

  @ApiProperty({ type: 'string', format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  finishedAt!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 0 })
  itemCount!: number | null;

  @ApiProperty({ type: 'string', nullable: true, description: '실패 사유(비밀 없음)' })
  errorMessage!: string | null;
}

/** 05-2 components.schemas.CommerceMetaSyncTargetStatus */
export class CommerceMetaSyncTargetStatusDto {
  @ApiProperty({ enum: META_SYNC_TARGETS })
  target!: MetaSyncTarget;

  @ApiProperty({
    type: CommerceMetaSyncRunDto,
    nullable: true,
    description: '대상의 최신 실행 기록. 한 번도 돌지 않았으면 null',
  })
  latestRun!: CommerceMetaSyncRunDto | null;

  @ApiProperty({
    type: 'string',
    format: 'date-time',
    nullable: true,
    description: '마지막 SUCCEEDED 행의 finishedAt(계산)',
  })
  lastSucceededAt!: string | null;
}

/** 05-2 components.schemas.CommerceMetaSyncStatusList */
export class CommerceMetaSyncStatusListDto {
  @ApiProperty({ type: [CommerceMetaSyncTargetStatusDto], description: '대상 8개(05-2 enum 순서)' })
  items!: CommerceMetaSyncTargetStatusDto[];
}

/**
 * 05-2 components.schemas.CommerceMetaSyncRequest(본문은 선택). `targets`는 1개 이상·중복 없음·8개 값 중.
 * 없으면 전체. 어기면 422 VALIDATION_FAILED(null도 거절한다).
 */
export class CommerceMetaSyncRequestDto {
  @ApiPropertyOptional({
    enum: META_SYNC_TARGETS,
    isArray: true,
    minItems: 1,
    uniqueItems: true,
    description: '없으면 전체 대상',
  })
  @ValidateIf((o: CommerceMetaSyncRequestDto) => o.targets !== undefined)
  @IsArray({ message: '대상 목록이어야 합니다.' })
  @ArrayMinSize(1, { message: '대상을 하나 이상 주거나 targets를 빼 주세요.' })
  @ArrayUnique({ message: '같은 대상을 두 번 줄 수 없습니다.' })
  @IsIn(META_SYNC_TARGETS, {
    each: true,
    message: `알 수 없는 대상입니다(가능: ${META_SYNC_TARGETS.join('·')}).`,
  })
  targets?: MetaSyncTarget[];
}

/** 05-2 components.schemas.CommerceMetaSyncAccepted */
export class CommerceMetaSyncAcceptedDto {
  @ApiProperty({
    type: [CommerceMetaSyncRunDto],
    description: '대상별로 만든 실행 기록(status=RUNNING)',
  })
  items!: CommerceMetaSyncRunDto[];
}
