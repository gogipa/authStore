import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsOptional, IsString, MaxLength } from 'class-validator';

const STEP_STATUSES = [
  'NOT_RUN',
  'RUNNING',
  'WAITING_INPUT',
  'COMPLETED',
  'FAILED',
  'RERUN_REQUIRED',
] as const;
export type ContentStepStatus = (typeof STEP_STATUSES)[number];

const METHODS = ['SKU_ATTRIBUTE', 'DESCRIPTION_PATTERN', 'AI', 'DICTIONARY', 'TEMPLATE', 'NONE'];
const RECHECK_REASONS = ['ITEM_CODE_CHANGED', 'SALE_SIZES_CHANGED', 'NOTICE_RAW_CHANGED'];

/** 05-2 ContentDraftFieldItem: 콘텐츠 단계의 필드 단위 값(content_draft_field) */
export class ContentDraftFieldItemDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  stepRunId!: number;

  @ApiProperty({
    maxLength: 48,
    pattern: '^((copy|fact|notice)\\.[a-z_]+|product_name)$',
    description: 'ERD 형식 필드 경로(copy.* / fact.* / notice.* / product_name)',
  })
  fieldKey!: string;

  @ApiProperty({
    description: "유효 값(문자열·배열·{value, unit} 같은 작은 구조값). null = '정보 없음'",
    nullable: true,
  })
  value!: unknown;

  @ApiPropertyOptional({
    description: '이 버전에서 단계가 계산·추출한 값(오너 입력과 나란히 보여 줄 때)',
    nullable: true,
  })
  generatedValue!: unknown;

  @ApiProperty({ enum: ['GENERATED', 'OWNER_INPUT'] })
  valueSource!: 'GENERATED' | 'OWNER_INPUT';

  @ApiPropertyOptional({ enum: METHODS, nullable: true, description: '⑥-2 필드만 추출 방법' })
  extractionMethod!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: '원문 발췌(일본어)' })
  evidenceQuote!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 2048,
    description: '근거 출처 URL',
  })
  evidenceUrl!: string | null;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 1,
    description: 'OCR로 읽은 설명 스펙 이미지',
  })
  evidenceImageAssetId!: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 128,
    description: '값을 추출·입력한 때의 itemCode',
  })
  basisItemCode!: string | null;

  @ApiPropertyOptional({ type: 'string', format: 'date-time', nullable: true })
  ownerConfirmedAt!: string | null;

  @ApiProperty({ description: '다시 실행한 결과가 오너 입력과 달라 오너가 골라야 함' })
  choicePending!: boolean;

  @ApiPropertyOptional({ enum: RECHECK_REASONS, nullable: true, description: "'재확인 필요' 사유" })
  recheckReason!: string | null;

  @ApiPropertyOptional({ type: 'string', format: 'date-time', nullable: true })
  recheckResolvedAt!: string | null;

  @ApiProperty({ description: 'recheckReason이 있고 recheckResolvedAt이 없음(계산)' })
  recheckRequired!: boolean;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string;
}

/** 05-2 ContentCopyOutput: ⑥-1 카피 한 버전 */
export class ContentCopyOutputDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: '⑥-1 실행 기록(버전) id' })
  stepRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number;

  @ApiProperty({ enum: STEP_STATUSES })
  stepRunStatus!: ContentStepStatus;

  @ApiProperty()
  isCurrent!: boolean;

  @ApiProperty({ type: 'integer', minimum: 1 })
  contentDraftCopyId!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: '이 버전의 AI 원 결과(§8.5 카피 스키마, 앱 재검증 통과본)',
  })
  generatedCopy!: Record<string, unknown>;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: '유효 카피 = generatedCopy + 필드별 오너 입력. source_facts_used 포함(F-CT-07)',
  })
  copy!: Record<string, unknown>;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    type: ContentDraftFieldItemDto,
    isArray: true,
    description: '오너가 고쳤거나 확인한 copy.* 필드 행',
  })
  fields!: ContentDraftFieldItemDto[];

  @ApiProperty({ description: "⑥-1이 RERUN_REQUIRED라 '그대로 유지'를 쓸 수 있는지(계산)" })
  keepAsIsAllowed!: boolean;
}

/** 05-2 ContentFactOutput: ⑥-2 고시 원자료 한 버전 */
export class ContentFactOutputDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: '⑥-2 실행 기록(버전) id' })
  stepRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number;

  @ApiProperty({ enum: STEP_STATUSES })
  stepRunStatus!: ContentStepStatus;

  @ApiProperty()
  isCurrent!: boolean;

  @ApiProperty({ type: 'integer', minimum: 1 })
  contentDraftFactId!: number;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 128 })
  sourceItemCode!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2048 })
  sourcePageUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 128 })
  selectedColorRaw!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    type: ContentDraftFieldItemDto,
    isArray: true,
    description: '사실 필드(fact.*) 행. 버전마다 항상 있다',
  })
  fields!: ContentDraftFieldItemDto[];

  @ApiProperty({
    type: String,
    isArray: true,
    description: '입력 대기 원인이 된 필드 키(계산). 예 fact.origin',
  })
  pendingInputs!: string[];
}

/** 05-2 ContentFieldInputRequest: 열린 ⑥-2 실행의 필드 오너 입력 */
export class ContentFieldInputRequestDto {
  @ApiProperty({ description: '오너 값. 원산지는 나라 이름 문자열' })
  @IsDefined({ message: '값(value)이 필요합니다.' })
  value!: unknown;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 2048,
    description: '근거 출처 URL. fact.origin이면 필수(422 EVIDENCE_URL_REQUIRED)',
  })
  @IsOptional()
  @IsString({ message: '글자여야 합니다.' })
  @MaxLength(2048, { message: '2048자 이하여야 합니다.' })
  evidenceUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: '근거 원문 발췌(선택)' })
  @IsOptional()
  @IsString({ message: '글자여야 합니다.' })
  @MaxLength(2000, { message: '2000자 이하여야 합니다.' })
  evidenceQuote?: string | null;
}

/** 05-2 ContentFieldInputResult */
export class ContentFieldInputResultDto {
  @ApiProperty({ type: ContentDraftFieldItemDto })
  field!: ContentDraftFieldItemDto;

  @ApiProperty({ type: 'integer', minimum: 1 })
  stepRunId!: number;

  @ApiProperty({ enum: STEP_STATUSES })
  stepRunStatus!: ContentStepStatus;

  @ApiProperty({
    type: String,
    isArray: true,
    description: '아직 남은 대기 입력 키. 비면 단계가 이어서 끝난다',
  })
  pendingInputs!: string[];
}
