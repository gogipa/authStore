import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  THUMBNAIL_FACE_OPTIONS,
  type ThumbnailFaceOption,
} from '../../settings/schema/settings.types.js';
import { IMAGE_GEN_PROVIDER_CODES } from '../../integrations/image-gen/image-gen.port.js';
import { PROMPT_ADJUSTMENT_MAX } from '../prompt/prompt-builder.js';

export const GENERATION_TRIGGER_TYPES = ['INITIAL', 'OWNER_RETRY', 'AUTO_RETRY'] as const;
export const GENERATION_RUN_STATUSES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'REFUSED'] as const;

/**
 * 05-2 GenerationRunCreateRequest. 모양만 여기서 본다(422 VALIDATION_FAILED). 후보 번호 범위(1..N, N = 설정 후보 수)·중복은
 * 서비스가 `parseGenerationRequest`로 본다(설정 값이 필요하다).
 */
export class GenerationRunCreateRequestDto {
  @ApiProperty({
    type: 'integer',
    isArray: true,
    minItems: 1,
    uniqueItems: true,
    description: '생성·다시 만들 후보 번호(1..N)',
  })
  @IsDefined({ message: '후보 번호가 필요합니다.' })
  @IsArray({ message: '배열이어야 합니다.' })
  @ArrayMinSize(1, { message: '후보 번호를 1개 이상 골라 주세요.' })
  @ArrayMaxSize(100, { message: '너무 많습니다.' })
  @IsInt({ each: true, message: '1 이상의 정수여야 합니다.' })
  @Min(1, { each: true, message: '1 이상의 정수여야 합니다.' })
  slotNos!: number[];

  @ApiProperty({ enum: THUMBNAIL_FACE_OPTIONS })
  @IsDefined({ message: '얼굴 노출 수준이 필요합니다.' })
  @IsIn(THUMBNAIL_FACE_OPTIONS, {
    message: 'FULL_FACE·CHIN_CROP·HANDS_UPPER_BODY 중 하나여야 합니다.',
  })
  faceOption!: ThumbnailFaceOption;

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    maxLength: PROMPT_ADJUSTMENT_MAX,
    description: '오너 프롬프트 조정(있으면 promptAdjusted=true)',
  })
  @IsOptional()
  @IsString({ message: '글자여야 합니다.' })
  @MaxLength(PROMPT_ADJUSTMENT_MAX, { message: `${PROMPT_ADJUSTMENT_MAX}자 이하여야 합니다.` })
  promptAdjustment?: string | null;
}

/** 05-2 GenerationRunAcceptedItem */
export class GenerationRunAcceptedItemDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  generationRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  slotNo!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  attemptNo!: number;

  @ApiProperty({ enum: GENERATION_TRIGGER_TYPES })
  triggerType!: (typeof GENERATION_TRIGGER_TYPES)[number];

  @ApiProperty({ enum: ['RUNNING'] })
  status!: 'RUNNING';
}

/** 05-2 GenerationRunAccepted */
export class GenerationRunAcceptedDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  stepRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({ type: GenerationRunAcceptedItemDto, isArray: true, minItems: 1 })
  generationRuns!: GenerationRunAcceptedItemDto[];
}

/** 05-2 ThumbnailGenerationSummary: 생성 시도 한 건 요약(프롬프트 전문 제외) */
export class ThumbnailGenerationSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: 'generation_run.id' })
  generationRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1, description: '후보 번호 1..N(기본 N=2, 설정)' })
  slotNo!: number;

  @ApiProperty({ type: 'integer', minimum: 1, description: '같은 후보 번호 안의 회차' })
  attemptNo!: number;

  @ApiProperty({ enum: GENERATION_TRIGGER_TYPES })
  triggerType!: (typeof GENERATION_TRIGGER_TYPES)[number];

  @ApiProperty({ description: '오너가 프롬프트를 고쳤는지' })
  promptAdjusted!: boolean;

  @ApiProperty({ enum: THUMBNAIL_FACE_OPTIONS })
  faceOption!: ThumbnailFaceOption;

  @ApiProperty({ type: 'integer', minimum: 1, description: '요청 해상도 px' })
  requestedSizePx!: number;

  @ApiProperty({ enum: IMAGE_GEN_PROVIDER_CODES })
  provider!: (typeof IMAGE_GEN_PROVIDER_CODES)[number];

  @ApiProperty({ maxLength: 100 })
  model!: string;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 40 })
  providerVersion!: string | null;

  @ApiProperty({ enum: GENERATION_RUN_STATUSES })
  status!: (typeof GENERATION_RUN_STATUSES)[number];

  @ApiPropertyOptional({ type: 'string', nullable: true, description: '콘텐츠 필터 거부 사유' })
  refusalReason!: string | null;

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    description: '실패 사유(한국어, 비밀정보 없음)',
  })
  errorMessage!: string | null;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 1,
    description: 'SUCCEEDED일 때 결과 이미지(kind=GENERATED)',
  })
  resultImageAssetId!: number | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  startedAt!: string;

  @ApiPropertyOptional({ type: 'string', format: 'date-time', nullable: true })
  finishedAt!: string | null;

  @ApiProperty({ description: 'G3 선택본에 들어갔는지(계산)' })
  adopted!: boolean;

  @ApiPropertyOptional({ type: 'number', nullable: true, description: '(M2) 신발 비중(IM-04)' })
  shoeRatio!: number | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 16 })
  shoeRatioMetric!: string | null;

  @ApiPropertyOptional({ type: 'boolean', nullable: true, description: '(M2) 디테일 검증 통과' })
  detailPass!: boolean | null;

  @ApiPropertyOptional({ type: 'number', nullable: true, description: '(M2) 색상 차이 ΔE' })
  colorDeltaE!: number | null;
}

/** 05-2 GenerationRunDetail: 생성 시도 한 건 전체(generation_run 그대로) */
export class GenerationRunDetailDto extends ThumbnailGenerationSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: '이 생성을 실행한 ⑤ 버전' })
  stepRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({ description: '실제로 보낸 프롬프트 전문(차단어 검사 통과본)' })
  prompt!: string;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  referenceSetSha256!: string;

  @ApiPropertyOptional({ type: 'object', nullable: true, additionalProperties: true })
  shoeBox!: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: 'object', nullable: true, additionalProperties: true })
  detailVerdict!: Record<string, unknown> | null;
}
