import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageMetaDto, PageQueryDto } from '../../../common/paging/page-query.dto.js';
import { AI_ENGINE_CODES, type AiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';

export const AI_CLI_CHECK_TRIGGERS = ['STARTUP', 'MANUAL', 'BEFORE_SAVE', 'FIRST_RUN'] as const;
/** 화면이 부르는 계기(STARTUP은 앱이 스스로 쓴다 — 요청으로 받으면 422, 05-2 AiCliCheckRequest) */
export const AI_CLI_CHECK_REQUEST_TRIGGERS = ['MANUAL', 'BEFORE_SAVE', 'FIRST_RUN'] as const;
export type AiCliCheckRequestTrigger = (typeof AI_CLI_CHECK_REQUEST_TRIGGERS)[number];
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

const MODEL_MESSAGE = '1~100자 글자여야 합니다.';

/** 05-2 AiCliCheckRequest.models(엔진 코드 → 연결 테스트 모델, 정의 밖 키는 422) */
export class AiCliCheckModelsDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString({ message: MODEL_MESSAGE })
  @MinLength(1, { message: MODEL_MESSAGE })
  @MaxLength(100, { message: MODEL_MESSAGE })
  CLAUDE?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString({ message: MODEL_MESSAGE })
  @MinLength(1, { message: MODEL_MESSAGE })
  @MaxLength(100, { message: MODEL_MESSAGE })
  AGY?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString({ message: MODEL_MESSAGE })
  @MinLength(1, { message: MODEL_MESSAGE })
  @MaxLength(100, { message: MODEL_MESSAGE })
  CODEX?: string;
}

/**
 * POST /ai-cli-checks 본문(05-2 AiCliCheckRequest). 형식은 여기서(422 VALIDATION_FAILED), `smokeTest=true`인데 `engineCodes`가
 * 없는 것(규칙 8)과 모델 검사(422 AI_MODEL_INVALID)는 서비스가 본다.
 */
export class AiCliCheckRequestDto {
  @ApiPropertyOptional({
    type: [String],
    enum: AI_ENGINE_CODES,
    minItems: 1,
    uniqueItems: true,
    description: '점검할 엔진(없으면 세 엔진 감지). smokeTest=true면 필수',
  })
  @IsOptional()
  @IsArray({ message: '엔진 코드 목록이어야 합니다.' })
  @ArrayMinSize(1, { message: '엔진을 하나 이상 골라 주세요.' })
  @ArrayUnique({ message: '같은 엔진을 두 번 줄 수 없습니다.' })
  @IsIn(AI_ENGINE_CODES, {
    each: true,
    message: `${AI_ENGINE_CODES.join('·')} 중 하나여야 합니다.`,
  })
  engineCodes?: AiEngineCode[];

  @ApiProperty({ description: "true면 연결 테스트('OK' 호출 1회)까지, false면 감지만" })
  @IsDefined({ message: '꼭 있어야 하는 값입니다.' })
  @IsBoolean({ message: 'true·false여야 합니다.' })
  smokeTest!: boolean;

  @ApiPropertyOptional({ type: AiCliCheckModelsDto })
  @IsOptional()
  @IsObject({ message: '엔진 코드 → 모델 묶음이어야 합니다.' })
  @ValidateNested()
  @Type(() => AiCliCheckModelsDto)
  models?: AiCliCheckModelsDto;

  @ApiProperty({ enum: AI_CLI_CHECK_REQUEST_TRIGGERS })
  @IsDefined({ message: '꼭 있어야 하는 값입니다.' })
  @IsIn(AI_CLI_CHECK_REQUEST_TRIGGERS, {
    message: `${AI_CLI_CHECK_REQUEST_TRIGGERS.join('·')} 중 하나여야 합니다(STARTUP은 앱이 스스로 씁니다).`,
  })
  trigger!: AiCliCheckRequestTrigger;
}

/** 05-2 components.schemas.AiCliCheckAccepted */
export class AiCliCheckAcceptedDto {
  @ApiProperty({ type: [String], enum: AI_ENGINE_CODES })
  engineCodes!: AiEngineCode[];

  @ApiProperty()
  smokeTest!: boolean;

  @ApiProperty({ enum: AI_CLI_CHECK_REQUEST_TRIGGERS })
  trigger!: AiCliCheckRequestTrigger;

  @ApiProperty({ enum: ['RUNNING'] })
  status!: 'RUNNING';

  @ApiProperty({ type: 'string', format: 'date-time' })
  acceptedAt!: string;
}

/** GET /ai-cli-checks 쿼리(P1-11 Proposed): 페이징 + 엔진 거르기(선택, 밖 값은 422 INVALID_QUERY_PARAMETER) */
export class AiCliCheckListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: AI_ENGINE_CODES, description: '이 엔진의 점검만' })
  @IsOptional()
  @IsIn(AI_ENGINE_CODES, { message: `${AI_ENGINE_CODES.join('·')} 중 하나여야 합니다.` })
  engineCode?: AiEngineCode;
}

/** 05-2 components.schemas.AiCliCheckPage(P1-11 Proposed) */
export class AiCliCheckPageDto {
  @ApiProperty({ type: [AiCliCheckDto] })
  content!: AiCliCheckDto[];

  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;
}
