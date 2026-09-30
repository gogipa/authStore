import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PageMetaDto, PageQueryDto } from '../../../../common/paging/page-query.dto.js';
import {
  FX_CURRENCIES,
  FX_RATE_KINDS,
  FX_SOURCES,
  FX_UNITS,
  type FxCurrency,
  type FxRateKind,
  type FxSource,
  type FxUnit,
} from '../fx-rate.normalize.js';

/** RFC 3339 date-time(시각·시간대 필수) */
const DATE_TIME_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** numeric(12,4)에 들어가는 가장 큰 값 */
export const FX_MANUAL_RATE_MAX = 99_999_999.9999;

export const FX_WARNING_CODES = ['FX_FETCH_FAILED', 'FX_DIVERGENCE'] as const;
export type FxWarningCode = (typeof FX_WARNING_CODES)[number];

// ── 요청 ─────────────────────────────────────────────────────────────────

/** GET /fx-rates 쿼리(05-2 listFxRates). 허용 밖 값은 422 INVALID_QUERY_PARAMETER */
export class ListFxRatesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: FX_RATE_KINDS })
  @IsOptional()
  @IsIn(FX_RATE_KINDS, { message: 'rateKind는 COST 또는 CUSTOMS여야 합니다.' })
  rateKind?: FxRateKind;

  @ApiPropertyOptional({ enum: FX_CURRENCIES })
  @IsOptional()
  @IsIn(FX_CURRENCIES, { message: 'currency는 JPY 또는 USD여야 합니다.' })
  currency?: FxCurrency;

  @ApiPropertyOptional({ enum: FX_SOURCES })
  @IsOptional()
  @IsIn(FX_SOURCES, { message: 'source는 KEXIM·CUSTOMS_SERVICE·MANUAL 중 하나여야 합니다.' })
  source?: FxSource;
}

/**
 * POST /fx-rates 본문(05-2 FxRateManualInput). 칸 모양은 class-validator가, 칸 사이 규칙(USD는 단위 1만, 원가 환율은 엔만)과
 * 0 이하는 서비스가 422 VALIDATION_FAILED로 막는다(fieldErrors에 칸 이름).
 */
export class CreateManualFxRateDto {
  @ApiProperty({ enum: FX_RATE_KINDS })
  @IsIn(FX_RATE_KINDS, { message: '원가 환율(COST) 또는 과세환율(CUSTOMS)이어야 합니다.' })
  rateKind!: FxRateKind;

  @ApiProperty({ enum: FX_CURRENCIES })
  @IsIn(FX_CURRENCIES, { message: '엔(JPY) 또는 달러(USD)여야 합니다.' })
  currency!: FxCurrency;

  @ApiProperty({
    type: 'number',
    minimum: 0,
    exclusiveMinimum: true,
    description: '고시 원값(원/unit, 소수 넷째 자리까지)',
  })
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 4 },
    { message: '숫자(소수 넷째 자리까지)여야 합니다.' },
  )
  @IsPositive({ message: '0보다 커야 합니다.' })
  @Max(FX_MANUAL_RATE_MAX, { message: '99,999,999.9999 이하여야 합니다.' })
  rateValue!: number;

  @ApiProperty({ type: 'integer', enum: FX_UNITS, description: 'USD는 1만' })
  @IsIn(FX_UNITS, { message: '단위는 1 또는 100이어야 합니다.' })
  unit!: FxUnit;

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    maxLength: 200,
    description: '오너가 적는 출처 설명',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString({ message: '글자여야 합니다.' })
  @MaxLength(200, { message: '200자 이내여야 합니다.' })
  sourceNote?: string | null;

  @ApiProperty({ format: 'date-time', description: '기준 시각' })
  @IsISO8601(
    { strict: true },
    { message: 'ISO 8601 날짜·시각이어야 합니다(예 2026-09-30T11:00:00+09:00).' },
  )
  @Matches(DATE_TIME_WITH_OFFSET, {
    message: '시각과 시간대까지 넣어 주세요(예 2026-09-30T11:00:00+09:00).',
  })
  referenceAt!: string;
}

// ── 응답 ─────────────────────────────────────────────────────────────────

/** 05-2 components.schemas.FxRateRecord(raw_response는 빼고 준다) */
export class FxRateRecordDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ enum: FX_RATE_KINDS })
  rateKind!: FxRateKind;

  @ApiProperty({ enum: FX_CURRENCIES })
  currency!: FxCurrency;

  @ApiProperty({
    type: 'number',
    minimum: 0,
    exclusiveMinimum: true,
    description: '고시 원값(원/unit, numeric 12,4). 계산용 = rateValue / unit',
  })
  rateValue!: number;

  @ApiProperty({ type: 'integer', enum: FX_UNITS })
  unit!: FxUnit;

  @ApiProperty({ enum: FX_SOURCES })
  source!: FxSource;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 200 })
  sourceNote!: string | null;

  @ApiProperty({ format: 'date-time' })
  referenceAt!: string;

  @ApiProperty({ format: 'date-time' })
  collectedAt!: string;
}

/** 05-2 components.schemas.FxRateWarning */
export class FxRateWarningDto {
  @ApiProperty({ enum: FX_WARNING_CODES, description: '05-3 §5.2 경고 코드' })
  code!: FxWarningCode;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional({ enum: FX_RATE_KINDS, nullable: true })
  rateKind?: FxRateKind | null;

  @ApiPropertyOptional({ enum: FX_CURRENCIES, nullable: true })
  currency?: FxCurrency | null;
}

/** 05-2 components.schemas.FxRateLatestSet */
export class FxRateLatestSetDto {
  @ApiProperty({
    type: [FxRateRecordDto],
    description: '종류·통화별 최신 행(COST/JPY, CUSTOMS/JPY, CUSTOMS/USD)',
  })
  items!: FxRateRecordDto[];

  @ApiProperty({ type: [FxRateWarningDto] })
  warnings!: FxRateWarningDto[];
}

/** 05-2 components.schemas.FxRatePage */
export class FxRatePageDto {
  @ApiProperty({ type: [FxRateRecordDto] })
  content!: FxRateRecordDto[];

  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;
}
