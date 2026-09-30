import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const STEP_STATUSES = [
  'NOT_RUN',
  'RUNNING',
  'WAITING_INPUT',
  'COMPLETED',
  'FAILED',
  'RERUN_REQUIRED',
] as const;
const STEP_CODES = [
  'SOURCING',
  'PRICING',
  'CATEGORY',
  'THUMBNAIL',
  'COPY',
  'NOTICE_RAW',
  'NOTICE_HTML',
  'TAGS',
  'UPLOAD',
  'REGISTER',
] as const;
export const CATEGORY_CANDIDATE_SOURCES = ['MAPPING', 'GENDER_PATH_ALL', 'SEARCH'] as const;
export const CATEGORY_EXCEPTION_DECISIONS = ['PASS', 'KC_EXEMPT', 'BLOCKED'] as const;
export const CATEGORY_OPTION_BLOCK_REASONS = [
  'CHILD_CERTIFICATION',
  'CHILD_CATEGORY',
  'CON08_EXCLUDED',
  'GENDER_MISMATCH',
  'REMOVED',
] as const;

type StepStatus = (typeof STEP_STATUSES)[number];
type StepCode = (typeof STEP_CODES)[number];

/** 05-2 CategoryOption: 보여 준 리프 후보 하나(category_options 항목 + 조회 때 계산한 예외 표시) */
export class CategoryOptionDto {
  @ApiProperty({ maxLength: 20 })
  leafCategoryId!: string;

  @ApiProperty({ maxLength: 500 })
  wholeCategoryName!: string;

  @ApiProperty({ description: "KC 인증 예외 — 고르려면 'KC 면제 성인용 확인' 필요(계산)" })
  kcExemptionRequired!: boolean;

  @ApiProperty({
    description:
      '아동 인증·아동 카테고리·판매 제외 품목·성별 불일치·캐시에서 사라짐이라 고를 수 없음(계산)',
  })
  blocked!: boolean;

  @ApiProperty({
    enum: CATEGORY_OPTION_BLOCK_REASONS,
    nullable: true,
    description: '막힌 이유(P2-06 Proposed). 막히지 않았으면 null',
  })
  blockReason!: (typeof CATEGORY_OPTION_BLOCK_REASONS)[number] | null;
}

/** 05-2 CategoryDecisionDetail: ④ 카테고리 버전 하나의 결정(category_decision) */
export class CategoryDecisionDetailDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  stepRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number;

  @ApiProperty({ enum: STEP_STATUSES })
  stepStatus!: StepStatus;

  @ApiProperty()
  isCurrent!: boolean;

  @ApiProperty({ type: 'integer', nullable: true })
  inputGenreId!: number | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 64 })
  inputProductType!: string | null;

  @ApiProperty({ enum: ['MALE', 'FEMALE'] })
  gender!: 'MALE' | 'FEMALE';

  @ApiProperty()
  genderChangedInRun!: boolean;

  @ApiProperty({ enum: CATEGORY_CANDIDATE_SOURCES, description: 'SEARCH는 M2' })
  candidateSource!: (typeof CATEGORY_CANDIDATE_SOURCES)[number];

  @ApiProperty({ type: [CategoryOptionDto] })
  categoryOptions!: CategoryOptionDto[];

  @ApiProperty({ type: 'string', nullable: true, maxLength: 20, description: '입력 대기 중 null' })
  leafCategoryId!: string | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 500 })
  wholeCategoryName!: string | null;

  @ApiProperty({ type: 'boolean', nullable: true })
  genderPathMatch!: boolean | null;

  @ApiPropertyOptional({
    description: '카테고리 상세 exceptionalCategories 원문(외부 응답 jsonb). 없으면 null',
  })
  exceptionalCategories!: unknown;

  @ApiProperty({ enum: CATEGORY_EXCEPTION_DECISIONS, nullable: true })
  exceptionDecision!: (typeof CATEGORY_EXCEPTION_DECISIONS)[number] | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 500 })
  blockReason!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  kcExemptAdultConfirmedAt!: string | null;

  @ApiPropertyOptional({
    description: '자동 구성한 certificationTargetExcludeContent(요청 JSON 조각). 없으면 null',
  })
  certificationExcludeContent!: unknown;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  decidedAt!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string;
}

/**
 * PUT /category-decisions/{id}/selection 본문(05-2 CategorySelectionRequest). 모양은 class-validator가(422 VALIDATION_FAILED),
 * M1에서 받지 않는 리프 검색·직접 선택(`candidateSource=SEARCH`, M2 F-CA-11)은 서비스가 422로 막는다(Proposed).
 */
export class CategorySelectionRequestDto {
  @ApiProperty({ minLength: 1, maxLength: 20 })
  @IsString({ message: '글자여야 합니다.' })
  @MinLength(1, { message: '비울 수 없습니다.' })
  @MaxLength(20, { message: '20자 이내여야 합니다.' })
  leafCategoryId!: string;

  @ApiPropertyOptional({
    default: false,
    description: "'KC 면제 성인용 확인' 체크(웹 화면 전용). KC 예외 카테고리면 true 필요",
  })
  @IsOptional()
  @IsBoolean({ message: 'true 또는 false여야 합니다.' })
  kcExemptAdultConfirmed?: boolean;

  @ApiPropertyOptional({
    enum: ['SEARCH'],
    description: '(M2) 리프 검색·직접 선택이면 SEARCH. 없으면 보여 준 목록에서 고른 것',
  })
  @IsOptional()
  @IsIn(['SEARCH'], { message: 'SEARCH만 받습니다.' })
  candidateSource?: 'SEARCH';
}

/** 05-2 CategorySelectionResult: 확정 결과 */
export class CategorySelectionResultDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  categoryDecisionId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  stepRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({ enum: STEP_STATUSES })
  stepStatus!: StepStatus;

  @ApiProperty({ maxLength: 20 })
  leafCategoryId!: string;

  @ApiProperty({ maxLength: 500 })
  wholeCategoryName!: string;

  @ApiProperty({ enum: ['PASS', 'KC_EXEMPT'] })
  exceptionDecision!: 'PASS' | 'KC_EXEMPT';

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  kcExemptAdultConfirmedAt!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  decidedAt!: string;

  @ApiProperty({
    enum: STEP_CODES,
    isArray: true,
    description: '재실행 필요로 바뀐 뒷단계(⑦을 먼저 만들었으면 TAGS)',
  })
  staleDownstreamSteps!: StepCode[];
}
