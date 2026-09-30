import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PageMetaDto, PageQueryDto } from '../../../common/paging/page-query.dto.js';

const STEP_STATUSES = [
  'NOT_RUN',
  'RUNNING',
  'WAITING_INPUT',
  'COMPLETED',
  'FAILED',
  'RERUN_REQUIRED',
] as const;
export type PricingStepStatus = (typeof STEP_STATUSES)[number];
const SOURCE_KINDS = ['MANUAL', 'SELLAFINDER'] as const;

/**
 * POST /candidates/{id}/domestic-prices 본문(05-2 DomesticPriceCreateRequest). 모양은 class-validator가(422
 * VALIDATION_FAILED), M1에서 받지 않는 셀라파인더(SELLAFINDER·domesticPriceImportRowId)는 서비스가 422로 막는다(Proposed).
 */
export class CreateDomesticPriceDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 2_147_483_647,
    description: '국내 기준가 총액(원)',
  })
  @IsInt({ message: '정수여야 합니다.' })
  @Min(1, { message: '0보다 커야 합니다.' })
  @Max(2_147_483_647, { message: '2,147,483,647 이하여야 합니다.' })
  pRefKrw!: number;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 100 })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString({ message: '글자여야 합니다.' })
  @MaxLength(100, { message: '100자 이내여야 합니다.' })
  sourceLabel?: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, format: 'uri', maxLength: 2048 })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString({ message: '글자여야 합니다.' })
  @MaxLength(2048, { message: '2048자 이내여야 합니다.' })
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'], require_tld: false },
    { message: 'http(s) 주소여야 합니다.' },
  )
  sourceUrl?: string | null;

  @ApiPropertyOptional({ enum: SOURCE_KINDS, default: 'MANUAL', description: 'SELLAFINDER는 M2' })
  @IsOptional()
  @IsIn(SOURCE_KINDS, { message: 'MANUAL 또는 SELLAFINDER여야 합니다.' })
  sourceKind?: (typeof SOURCE_KINDS)[number];

  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 1, description: '(M2)' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt({ message: '정수여야 합니다.' })
  @Min(1, { message: '1 이상이어야 합니다.' })
  domesticPriceImportRowId?: number | null;
}

/** 05-2 DomesticPriceEntry */
export class DomesticPriceEntryDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  pRefKrw!: number;

  @ApiProperty({ enum: SOURCE_KINDS })
  sourceKind!: (typeof SOURCE_KINDS)[number];

  @ApiProperty({ type: 'string', nullable: true, maxLength: 100 })
  sourceLabel!: string | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 2048 })
  sourceUrl!: string | null;

  @ApiProperty({ format: 'date-time' })
  enteredAt!: string;

  @ApiPropertyOptional({ type: 'integer', nullable: true, description: '(M2)' })
  domesticPriceImportRowId?: number | null;
}

/** 05-2 DomesticPriceCreated */
export class DomesticPriceCreatedDto extends DomesticPriceEntryDto {
  @ApiProperty({ enum: STEP_STATUSES, description: '입력 뒤 ③ 단계 상태' })
  pricingStepStatus!: PricingStepStatus;
}

/** 05-2 DomesticPricePage */
export class DomesticPricePageDto {
  @ApiProperty({ type: [DomesticPriceEntryDto] })
  content!: DomesticPriceEntryDto[];

  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;
}

/** GET …/domestic-prices 쿼리(page·size·sort = enteredAt) */
export class ListDomesticPricesQueryDto extends PageQueryDto {}

/** 05-2 NaverShoppingLink */
export class NaverShoppingLinkDto {
  @ApiProperty({ enum: ['SOURCE_KEYWORD', 'MODEL_CODE'] })
  kind!: 'SOURCE_KEYWORD' | 'MODEL_CODE';

  @ApiProperty({ description: '검색어' })
  query!: string;

  @ApiProperty({ format: 'uri', description: '네이버쇼핑 검색 URL' })
  url!: string;
}

/** 05-2 NaverShoppingLinkList */
export class NaverShoppingLinkListDto {
  @ApiProperty({ type: [NaverShoppingLinkDto] })
  items!: NaverShoppingLinkDto[];
}
