import { ApiProperty } from '@nestjs/swagger';
import { AI_ENGINE_CODES, type AiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';

export const AI_CLI_CHECK_TRIGGERS = ['STARTUP', 'MANUAL', 'BEFORE_SAVE', 'FIRST_RUN'] as const;
export const AI_AUTH_STATUSES = ['OK', 'NOT_LOGGED_IN', 'UNKNOWN'] as const;
export const AI_SMOKE_STATUSES = ['PASSED', 'FAILED', 'SKIPPED'] as const;

/** 05-2 components.schemas.AiCliCheck */
export class AiCliCheckDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ enum: AI_ENGINE_CODES })
  engineCode!: AiEngineCode;

  @ApiProperty({ enum: AI_CLI_CHECK_TRIGGERS })
  trigger!: (typeof AI_CLI_CHECK_TRIGGERS)[number];

  @ApiProperty()
  installed!: boolean;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 1024 })
  binPath!: string | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 40 })
  cliVersion!: string | null;

  @ApiProperty({ type: 'boolean', nullable: true })
  versionSupported!: boolean | null;

  @ApiProperty({ enum: AI_AUTH_STATUSES })
  authStatus!: (typeof AI_AUTH_STATUSES)[number];

  @ApiProperty({ enum: AI_SMOKE_STATUSES })
  smokeStatus!: (typeof AI_SMOKE_STATUSES)[number];

  @ApiProperty({ type: 'string', nullable: true, maxLength: 100 })
  model!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 0 })
  latencyMs!: number | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 100 })
  errorCode!: string | null;

  @ApiProperty({ type: 'string', nullable: true })
  errorMessage!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  checkedAt!: string;
}

/** 05-2 components.schemas.AiCliCheckLatestItem */
export class AiCliCheckLatestItemDto {
  @ApiProperty({ enum: AI_ENGINE_CODES })
  engineCode!: AiEngineCode;

  @ApiProperty({ description: '설정의 선택 엔진인지' })
  selected!: boolean;

  @ApiProperty({ type: AiCliCheckDto, nullable: true, description: '점검한 적 없으면 null' })
  latest!: AiCliCheckDto | null;
}

/** 05-2 components.schemas.AiCliCheckLatestList */
export class AiCliCheckLatestListDto {
  @ApiProperty({ enum: AI_ENGINE_CODES })
  selectedEngine!: AiEngineCode;

  @ApiProperty({ type: [AiCliCheckLatestItemDto], description: '엔진 3개(CLAUDE·AGY·CODEX 순서)' })
  items!: AiCliCheckLatestItemDto[];
}
