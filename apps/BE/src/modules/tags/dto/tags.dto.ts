import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 05-2 tags 스키마(P3-05). 모양은 05-2 그대로다(응답 문서용 — 요청 검사는 서비스가 한다) */

const STEP_STATUSES = [
  'NOT_RUN',
  'RUNNING',
  'WAITING_INPUT',
  'COMPLETED',
  'FAILED',
  'RERUN_REQUIRED',
] as const;
const OUTCOMES = [
  'SELECTED',
  'NOT_SELECTED',
  'FILTERED',
  'RESTRICTED',
  'OWNER_REMOVED',
  'BELOW_SCORE',
] as const;
const FILTER_REASONS = [
  'CATEGORY_TOKEN',
  'BRAND_NAME',
  'STORE_NAME',
  'PROMOTION',
  'ATTRIBUTE_MISMATCH',
] as const;
const SOURCE_TYPES = ['SELLERFINDER', 'BROWSER_RESPONSE', 'FREE_TEXT'] as const;

export type TagStepRunStatus = (typeof STEP_STATUSES)[number];
export type TagCandidateOutcome = (typeof OUTCOMES)[number];
export type TagCandidateFilterReason = (typeof FILTER_REASONS)[number];

/** 05-2 TagCandidateItem */
export class TagCandidateItemDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ maxLength: 100, description: '보낼 태그 텍스트' })
  text!: string;

  @ApiProperty({ maxLength: 100, description: '정규화 키(중복 제거 기준)' })
  textKey!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: '^[0-9]+$',
    maxLength: 20,
    description: 'recommend-tags 태그 ID(숫자 문자열). 추천과 정확히 일치할 때만',
  })
  code!: string | null;

  @ApiProperty()
  inRecommend!: boolean;

  @ApiProperty()
  inCompetitor!: boolean;

  @ApiProperty()
  ownerAdded!: boolean;

  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 1 })
  competitorBestRank!: number | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 1 })
  competitorFrequency!: number | null;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    description: '경쟁 태그 입력 순서(빈도가 없을 때 선정 기준)',
  })
  inputOrder!: number | null;

  @ApiProperty({ enum: OUTCOMES })
  outcome!: TagCandidateOutcome;

  @ApiPropertyOptional({ enum: FILTER_REASONS, nullable: true })
  filterReason!: TagCandidateFilterReason | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 200,
    description: "걸린 사전 항목이나 설명('뺀 태그와 사유')",
  })
  filterDetail!: string | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description: 'restricted-tags 1차 결과. null = 조회 안 함',
  })
  restricted!: boolean | null;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: 10,
    description: '최종 태그 순서(SELECTED만)',
  })
  finalOrder!: number | null;

  @ApiProperty({ description: "오너 추가이고 code가 없어 '사전 미등록' 경고(계산)" })
  dictionaryUnregistered!: boolean;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: '(M2) 0.6×경쟁 빈도비 + 0.4×사전 등재. M1은 null',
  })
  score!: number | null;
}

/** 05-2 FinalTagItem: 등록 요청에 보낼 형태 */
export class FinalTagItemDto {
  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^[0-9]+$', maxLength: 20 })
  code?: string | null;

  @ApiProperty({ maxLength: 100 })
  text!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 10 })
  finalOrder!: number;
}

/** 05-2 TagOwnerEditItem */
export class TagOwnerEditItemDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ enum: ['ADD', 'REMOVE'] })
  action!: 'ADD' | 'REMOVE';

  @ApiProperty({ maxLength: 100 })
  text!: string;

  @ApiProperty({ maxLength: 100 })
  textKey!: string;

  @ApiProperty({ format: 'date-time' })
  editedAt!: string;

  @ApiPropertyOptional({
    enum: ['OWNER', 'REGISTRATION_ERROR'],
    nullable: true,
    description: '(M2) 편집 출처. M1은 null',
  })
  editSource!: 'OWNER' | 'REGISTRATION_ERROR' | null;
}

/** 05-2 TagSetOutput */
export class TagSetOutputDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: '⑦ 실행 기록(버전) id' })
  stepRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number;

  @ApiProperty({ enum: STEP_STATUSES })
  stepRunStatus!: TagStepRunStatus;

  @ApiProperty()
  isCurrent!: boolean;

  @ApiProperty({ type: 'integer', minimum: 1 })
  tagSetId!: number;

  @ApiProperty({ type: String, isArray: true, description: 'recommend-tags에 보낸 키워드' })
  recommendKeywords!: string[];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 20,
    description: "필터에 쓴 ④ 리프 ID. null = '카테고리 미확정'",
  })
  leafCategoryId!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date-time',
    description: '1차 restricted-tags 검증 시각',
  })
  restrictedCheckedAt!: string | null;

  @ApiProperty({ description: '태그 관련성 AI 판정을 켰는지' })
  aiRelevanceEnabled!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    type: 'integer',
    isArray: true,
    description: '이 버전이 읽은 경쟁 태그 입력 id(tag_set_competitor_input)',
  })
  competitorInputIds!: number[];

  @ApiProperty({ type: TagCandidateItemDto, isArray: true })
  candidates!: TagCandidateItemDto[];

  @ApiProperty({
    type: FinalTagItemDto,
    isArray: true,
    maxItems: 10,
    description: 'outcome=SELECTED를 finalOrder 순으로(계산)',
  })
  finalTags!: FinalTagItemDto[];

  @ApiProperty({ type: TagOwnerEditItemDto, isArray: true })
  ownerEdits!: TagOwnerEditItemDto[];
}

/** 05-2 TagCompetitorTagItem */
export class TagCompetitorTagItemDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  seq!: number;

  @ApiProperty({ maxLength: 100 })
  tagText!: string;

  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 1 })
  sourceRank!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^[0-9]+$', maxLength: 20 })
  naverProductId!: string | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 1 })
  frequency!: number | null;
}

/** 05-2 TagCompetitorInputItem */
export class TagCompetitorInputItemDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({ enum: SOURCE_TYPES })
  sourceType!: (typeof SOURCE_TYPES)[number];

  @ApiProperty({ description: '빈도 정보가 있는 입력인지' })
  hasFrequency!: boolean;

  @ApiProperty({ type: 'integer', minimum: 0 })
  itemCount!: number;

  @ApiProperty({ format: 'date-time' })
  importedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  removedAt!: string | null;

  @ApiProperty({ type: TagCompetitorTagItemDto, isArray: true })
  tags!: TagCompetitorTagItemDto[];
}

/** 05-2 TagCompetitorInputList */
export class TagCompetitorInputListDto {
  @ApiProperty({ type: TagCompetitorInputItemDto, isArray: true })
  items!: TagCompetitorInputItemDto[];
}

/** 05-2 TagCompetitorInputCreated */
export class TagCompetitorInputCreatedDto extends TagCompetitorInputItemDto {
  @ApiProperty({
    enum: [
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
    ],
    isArray: true,
    description: '입력이 바뀌어 재실행 필요가 된 단계(완료된 ⑦이 있으면 TAGS)',
  })
  rerunRequiredSteps!: string[];
}
