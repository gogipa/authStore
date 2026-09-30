import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Allow,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiException } from '../../../common/errors/api.exception.js';
import type { FieldError } from '../../../common/errors/error-response.js';
import { PageMetaDto, PageQueryDto } from '../../../common/paging/page-query.dto.js';
import {
  KEYWORD_ABORT_REASONS,
  KEYWORD_SNAPSHOT_METHODS,
  KEYWORD_SNAPSHOT_STATUSES,
  type KeywordSnapshotMethod,
  type KeywordSnapshotStatus,
  PASTE_CIDS,
  RANK_LIMITS,
  type RankLimit,
} from '../keywords.constants.js';

// ── 요청 ─────────────────────────────────────────────────────────────────

/**
 * POST /keyword-snapshots body(05-2 KeywordSnapshotCreateRequest — method로 BUTTON·PASTE를 가른다).
 * 칸 타입은 class-validator가, 방식별 필수·허용 칸은 `assertSnapshotCreateShape`가 본다(둘 다 422 VALIDATION_FAILED).
 * 붙여넣기 글 길이 상한(100,000자)은 422가 아니라 413 PAYLOAD_TOO_LARGE라 여기서 막지 않는다(서비스가 본다).
 */
export class CreateKeywordSnapshotDto {
  @ApiProperty({ enum: KEYWORD_SNAPSHOT_METHODS, description: 'BUTTON=버튼 수집, PASTE=붙여넣기' })
  @IsIn(KEYWORD_SNAPSHOT_METHODS, { message: 'method는 BUTTON 또는 PASTE여야 합니다.' })
  method!: KeywordSnapshotMethod;

  @ApiPropertyOptional({
    enum: RANK_LIMITS,
    default: 100,
    description: 'BUTTON: 수집 범위(100위 = cid당 5페이지, 500위 = cid당 25페이지)',
  })
  @IsOptional()
  @IsInt({ message: '정수여야 합니다.' })
  @IsIn(RANK_LIMITS, { message: 'rankLimit은 100 또는 500이어야 합니다.' })
  rankLimit?: RankLimit;

  @ApiPropertyOptional({ type: [String], description: '(M2) 수집할 하위 cid. M1은 받지 않는다' })
  @Allow()
  requestedCids?: unknown;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: '(M2) 성별·연령·기기 필터. M1은 받지 않는다',
  })
  @Allow()
  filters?: unknown;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 100_000,
    description: "PASTE: 데이터랩 화면에서 복사한 '순위 + 키워드' 텍스트",
  })
  @IsOptional()
  @IsString({ message: '글자여야 합니다.' })
  @MinLength(1, { message: '비울 수 없습니다.' })
  text?: string;

  @ApiPropertyOptional({
    enum: [...PASTE_CIDS],
    nullable: true,
    default: null,
    description: 'PASTE: 여성신발 50000173 / 남성신발 50000174 / null = 모름(기본)',
  })
  @IsOptional()
  @IsIn(PASTE_CIDS, { message: 'cid는 50000173·50000174·null 중 하나여야 합니다.' })
  cid?: string | null;
}

/** 방식별 받는 칸(05-2 KeywordButtonCollectionRequest·KeywordPasteRequest, additionalProperties: false) */
const SHAPES: Record<KeywordSnapshotMethod, { required: string[]; allowed: string[] }> = {
  BUTTON: { required: [], allowed: ['rankLimit'] },
  PASTE: { required: ['text'], allowed: ['text', 'cid'] },
};
const BODY_FIELDS = ['rankLimit', 'requestedCids', 'filters', 'text', 'cid'] as const;
/** M2 칸(F-KW-09·10). M1은 받지 않는다(Proposed) */
const M2_FIELDS: ReadonlySet<string> = new Set(['requestedCids', 'filters']);

/** 방식별 모양 검사. 빠진 칸·그 방식이 받지 않는 칸·M2 칸은 422 VALIDATION_FAILED */
export function assertSnapshotCreateShape(body: CreateKeywordSnapshotDto): void {
  const shape = SHAPES[body.method];
  const fieldErrors: FieldError[] = [];
  for (const field of BODY_FIELDS) {
    const value = body[field];
    if (shape.required.includes(field) && (value === undefined || value === null)) {
      fieldErrors.push({ field, message: `${body.method}에 필요한 값입니다.` });
    } else if (!shape.allowed.includes(field) && value !== undefined) {
      fieldErrors.push({
        field,
        message: M2_FIELDS.has(field)
          ? '하위 분류·필터 수집은 아직 쓸 수 없습니다(M2).'
          : `${body.method}에서는 받지 않는 값입니다.`,
      });
    }
  }
  if (fieldErrors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors });
}

/** 쿼리 불리언: 'true'·'false' 글자만 받는다(그 밖은 그대로 두어 IsBoolean이 422로 막는다) */
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/** GET /keyword-snapshots 쿼리(05-2 listKeywordSnapshots) */
export class ListKeywordSnapshotsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: KEYWORD_SNAPSHOT_METHODS, description: '수집 방식으로 거르기' })
  @IsOptional()
  @IsIn(KEYWORD_SNAPSHOT_METHODS, { message: 'method는 BUTTON 또는 PASTE여야 합니다.' })
  method?: KeywordSnapshotMethod;

  @ApiPropertyOptional({ enum: KEYWORD_SNAPSHOT_STATUSES, description: '결과 상태로 거르기' })
  @IsOptional()
  @IsIn(KEYWORD_SNAPSHOT_STATUSES, {
    message: 'status는 RUNNING·COMPLETED·ABORTED 중 하나여야 합니다.',
  })
  status?: KeywordSnapshotStatus;
}

/** (M2) 브랜드 사전 보기. M1은 ALL만 받는다 */
export const KEYWORD_VIEWS = ['ALL', 'EXCLUDED_BRANDS', 'JAPAN_BRAND_PRIORITY'] as const;

/** GET /keyword-snapshots/{id}/keywords 쿼리(05-2 listSnapshotKeywords) */
export class ListSnapshotKeywordsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    maxLength: 16,
    description: '카테고리 ID로 거르기(50000173 여 / 50000174 남)',
  })
  @IsOptional()
  @IsString({ message: '글자여야 합니다.' })
  @MaxLength(16, { message: '16자 이내여야 합니다.' })
  cid?: string;

  @ApiPropertyOptional({
    type: 'boolean',
    default: false,
    description: "true면 아동화로 빠진 키워드('제외됨')만, false면 빠지지 않은 키워드만",
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'true 또는 false여야 합니다.' })
  excluded?: boolean;

  @ApiPropertyOptional({
    enum: KEYWORD_VIEWS,
    default: 'ALL',
    description: '(M2) 브랜드 사전 기준 보기. M1은 ALL만',
  })
  @IsOptional()
  @IsIn(['ALL'], { message: '브랜드 사전 보기는 아직 쓸 수 없습니다(M2). ALL만 됩니다.' })
  view?: 'ALL';
}

// ── 응답 ─────────────────────────────────────────────────────────────────

/** 05-2 components.schemas.KeywordSnapshot */
export class KeywordSnapshotDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ enum: KEYWORD_SNAPSHOT_METHODS })
  method!: KeywordSnapshotMethod;

  @ApiProperty({ format: 'date-time', description: '수집 시각' })
  collectedAt!: string;

  @ApiProperty({
    type: [String],
    description:
      '요청한 cid 목록(M1 기본 50000173·50000174). 붙여넣기는 고른 1개 또는 빈 배열(모름)',
  })
  requestedCids!: string[];

  @ApiProperty({ type: String, format: 'date', nullable: true })
  periodStart!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  periodEnd!: string | null;

  @ApiProperty({ type: 'integer', enum: [100, 500], nullable: true })
  rankLimit!: number | null;

  @ApiProperty({ type: String, maxLength: 40, nullable: true })
  responseRange!: string | null;

  @ApiProperty({ type: Boolean, nullable: true })
  rangeMatched!: boolean | null;

  @ApiProperty({ enum: KEYWORD_SNAPSHOT_STATUSES })
  status!: KeywordSnapshotStatus;

  @ApiProperty({ enum: KEYWORD_ABORT_REASONS, nullable: true })
  abortReason!: string | null;

  @ApiProperty({ type: 'integer', nullable: true })
  httpStatus!: number | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    nullable: true,
    description: '(M2) 필터. M1은 늘 null',
  })
  filters!: Record<string, string> | null;

  @ApiProperty({ type: 'integer', minimum: 0 })
  keywordCount!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  excludedCount!: number;
}

/** 05-2 components.schemas.KeywordSnapshotDetail */
export class KeywordSnapshotDetailDto extends KeywordSnapshotDto {
  @ApiProperty({
    description: 'ABORTED이고 사유가 NO_RANKS_KEY·HTTP_404·NOT_JSON·RETURN_CODE·COUNT_MISMATCH',
  })
  structureChangeSuspected!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  blockedUntil!: string | null;
}

export class KeywordSnapshotPageDto {
  @ApiProperty({ type: [KeywordSnapshotDto] })
  content!: KeywordSnapshotDto[];

  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;
}

/** 05-2 components.schemas.KeywordCollectionAccepted(202) */
export class KeywordCollectionAcceptedDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  keywordSnapshotId!: number;

  @ApiProperty({ enum: KEYWORD_SNAPSHOT_STATUSES })
  status!: KeywordSnapshotStatus;

  @ApiProperty({ type: 'integer', enum: [100, 500] })
  rankLimit!: number;

  @ApiProperty({ type: [String] })
  requestedCids!: string[];
}

/** 05-2 components.schemas.RankedKeyword(M2 classification·brandPolicy는 M1에 없다) */
export class RankedKeywordDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  keywordSnapshotId!: number;

  @ApiProperty({ type: String, maxLength: 16, nullable: true })
  cid!: string | null;

  @ApiProperty({ type: 'integer', minimum: 1 })
  rank!: number;

  @ApiProperty({ maxLength: 100 })
  keyword!: string;

  @ApiProperty({ type: String, enum: ['CHILD'], nullable: true })
  excludedReason!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  selectedAt!: string | null;

  @ApiProperty({
    type: [Number],
    description: '이 키워드를 출처로 만든 후보(candidate.source_keyword_id)',
  })
  candidateIds!: number[];
}

export class RankedKeywordPageDto {
  @ApiProperty({ type: [RankedKeywordDto] })
  content!: RankedKeywordDto[];

  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;
}

/** 05-2 components.schemas.KeywordCollectionStatus */
export class KeywordCollectionStatusDto {
  @ApiProperty()
  collecting!: boolean;

  @ApiProperty({ type: 'integer', nullable: true })
  runningKeywordSnapshotId!: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  lastKeywordSnapshotId!: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastCollectedAt!: string | null;

  @ApiProperty({ enum: KEYWORD_SNAPSHOT_STATUSES, nullable: true })
  lastStatus!: KeywordSnapshotStatus | null;

  @ApiProperty({ type: String, nullable: true })
  lastAbortReason!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  blockedUntil!: string | null;

  @ApiProperty({ type: Number, minimum: 0 })
  requestIntervalSeconds!: number;

  @ApiProperty({
    type: String,
    enum: ['ALREADY_IN_PROGRESS', 'EXTERNAL_CALL_COOLDOWN'],
    nullable: true,
  })
  disabledReasonCode!: 'ALREADY_IN_PROGRESS' | 'EXTERNAL_CALL_COOLDOWN' | null;
}
