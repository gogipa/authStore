import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageMetaDto, PageQueryDto } from '../../../../common/paging/page-query.dto.js';
import { RATE_TABLE_CURRENCIES, type RateTableCurrency } from '../rate-table-csv.parser.js';

/** 쿼리 불리언: 'true'·'false' 글자만 받는다(그 밖은 그대로 두어 IsBoolean이 422 INVALID_QUERY_PARAMETER로 막는다) */
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

// ── 요청 ─────────────────────────────────────────────────────────────────

/** GET /forwarder-rate-tables 쿼리(05-2 listForwarderRateTables) */
export class ListForwarderRateTablesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ type: 'boolean', description: 'true면 활성 버전만' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'true 또는 false여야 합니다.' })
  active?: boolean;
}

/** POST /forwarder-rate-tables multipart 글자 칸(05-2 ForwarderRateTableImportRequest). `file`은 FileInterceptor가 받는다 */
export class ImportForwarderRateTableFieldsDto {
  @ApiPropertyOptional({ maxLength: 100, description: '배대지 이름(표시용)' })
  @IsOptional()
  @IsString({ message: '글자여야 합니다.' })
  @MaxLength(100, { message: '100자 이내여야 합니다.' })
  forwarderName?: string;
}

// ── 응답 ─────────────────────────────────────────────────────────────────

/** 05-2 components.schemas.ForwarderRateTier */
export class ForwarderRateTierDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({
    type: 'number',
    minimum: 0,
    exclusiveMinimum: true,
    description: '구간 상한 무게(kg, numeric(6,3))',
  })
  weightMaxKg!: number;

  @ApiProperty({ type: 'integer', minimum: 0, description: '요금(최소 단위 정수, currency 기준)' })
  fee!: number;

  @ApiProperty({ enum: RATE_TABLE_CURRENCIES })
  currency!: RateTableCurrency;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 0, exclusiveMinimum: true })
  volumetricDivisor!: number | null;

  @ApiProperty({
    type: 'string',
    nullable: true,
    maxLength: 200,
    description: '부피무게 적용 조건(ALWAYS·NEVER·SUM_CM>n, Proposed)',
  })
  volumetricAppliesWhen!: string | null;
}

/** 05-2 components.schemas.ForwarderRateTableSummary(원본 CSV 경로는 주지 않는다) */
export class ForwarderRateTableSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 100 })
  forwarderName!: string | null;

  @ApiProperty({ maxLength: 255 })
  sourceFileName!: string;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  sourceFileSha256!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  rowCount!: number;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  importedAt!: string;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  activatedAt!: string | null;
}

/** 05-2 components.schemas.ForwarderRateTableDetail */
export class ForwarderRateTableDetailDto extends ForwarderRateTableSummaryDto {
  @ApiProperty({ type: [ForwarderRateTierDto], description: 'weightMaxKg 오름차순' })
  tiers!: ForwarderRateTierDto[];
}

/** 05-2 components.schemas.ForwarderRateTablePage */
export class ForwarderRateTablePageDto {
  @ApiProperty({ type: [ForwarderRateTableSummaryDto] })
  content!: ForwarderRateTableSummaryDto[];

  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;
}

/** 05-2 components.schemas.ForwarderRateTableImportResult */
export class ForwarderRateTableImportResultDto {
  @ApiProperty({ type: ForwarderRateTableDetailDto })
  rateTable!: ForwarderRateTableDetailDto;

  @ApiProperty({ description: 'true면 같은 파일 해시의 기존 버전을 다시 활성화' })
  reused!: boolean;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: '활성 변경으로 재실행 필요가 된 ③ 단계 수',
  })
  rerunRequiredStepCount!: number;
}
