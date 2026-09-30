import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageMetaDto, PageQueryDto } from '../../../../common/paging/page-query.dto.js';
import { SHOE_GENDERS, type ShoeGender } from '../commerce-meta.constants.js';

/** 쿼리 불리언: 'true'·'false' 글자만 받는다(그 밖은 그대로 두어 IsBoolean이 422로 막는다) */
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

// ── 요청 쿼리 ─────────────────────────────────────────────────────────────

/** GET /commerce-categories 쿼리(05-2 listCommerceCategories). q는 M2라 받지 않는다(422) */
export class ListCommerceCategoriesQueryDto extends PageQueryDto {
  @ApiProperty({ enum: SHOE_GENDERS, description: '후보 성별(성별 경로 필터)' })
  @IsIn(SHOE_GENDERS, { message: 'gender는 MALE 또는 FEMALE이어야 합니다.' })
  gender!: ShoeGender;
}

/** GET /commerce-origin-areas 쿼리(05-2 listCommerceOriginAreas) */
export class ListCommerceOriginAreasQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ maxLength: 100, description: '이름·코드 부분 일치' })
  @IsOptional()
  @IsString({ message: '글자여야 합니다.' })
  @MaxLength(100, { message: '100자 이내여야 합니다.' })
  q?: string;

  @ApiPropertyOptional({ maxLength: 20, description: '상위 코드(sub-origin-areas 계층)' })
  @IsOptional()
  @IsString({ message: '글자여야 합니다.' })
  @MaxLength(20, { message: '20자 이내여야 합니다.' })
  parentCode?: string;
}

/** GET /commerce-addressbooks 쿼리(05-2 listCommerceAddressbooks) */
export class ListCommerceAddressbooksQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    type: 'boolean',
    description:
      'true면 해외 출고지(overseasAddress)만, false면 국내 주소록만(Proposed). 없으면 모두',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'true 또는 false여야 합니다.' })
  overseas?: boolean;

  @ApiPropertyOptional({
    type: 'boolean',
    default: false,
    description: 'true면 최신 동기화에서 사라진 행도 포함',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'true 또는 false여야 합니다.' })
  includeRemoved?: boolean;
}

/** GET /commerce-return-delivery-companies 쿼리(05-2 listCommerceReturnDeliveryCompanies) */
export class ListCommerceReturnDeliveryCompaniesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ type: 'boolean', default: false, description: 'true면 사라진 행도 포함' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'true 또는 false여야 합니다.' })
  includeRemoved?: boolean;
}

// ── 응답 ─────────────────────────────────────────────────────────────────

/** 05-2 components.schemas.CommerceCategoryEntry */
export class CommerceCategoryEntryDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ maxLength: 20, description: '네이버 리프 카테고리 ID' })
  categoryId!: string;

  @ApiProperty({ maxLength: 100 })
  name!: string;

  @ApiProperty({ maxLength: 500, description: '전체 경로(예 패션잡화>남성신발>…)' })
  wholeCategoryName!: string;

  @ApiProperty({
    type: [String],
    description: '예외 유형(CHILD_CERTIFICATION, KC_CERTIFICATION 등 외부 값)',
  })
  exceptionalCategories!: string[];

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  detailSyncedAt!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  syncedAt!: string;
}

export class CommerceCategoryEntryPageDto {
  @ApiProperty({ type: [CommerceCategoryEntryDto] })
  content!: CommerceCategoryEntryDto[];

  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;
}

/** 05-2 components.schemas.CommerceOriginAreaEntry */
export class CommerceOriginAreaEntryDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ maxLength: 20 })
  originAreaCode!: string;

  @ApiProperty({ maxLength: 100 })
  name!: string;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 20 })
  parentCode!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  syncedAt!: string;
}

export class CommerceOriginAreaEntryPageDto {
  @ApiProperty({ type: [CommerceOriginAreaEntryDto] })
  content!: CommerceOriginAreaEntryDto[];

  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;
}

/** 05-2 components.schemas.CommerceAddressbookEntry(응답 원문 raw는 주지 않는다) */
export class CommerceAddressbookEntryDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ pattern: '^[0-9]+$', maxLength: 20 })
  addressBookNo!: string;

  @ApiProperty({ maxLength: 100 })
  name!: string;

  @ApiProperty({
    type: 'string',
    nullable: true,
    maxLength: 40,
    description: '주소 유형 원문(외부 값)',
  })
  addressType!: string | null;

  @ApiProperty()
  isOverseas!: boolean;

  @ApiProperty({
    type: 'string',
    nullable: true,
    maxLength: 500,
    description: '화면 표시용 한 줄 주소',
  })
  addressSummary!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  syncedAt!: string;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  removedAt!: string | null;
}

export class CommerceAddressbookEntryPageDto {
  @ApiProperty({ type: [CommerceAddressbookEntryDto] })
  content!: CommerceAddressbookEntryDto[];

  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;
}

/** 05-2 components.schemas.CommerceReturnDeliveryCompanyEntry */
export class CommerceReturnDeliveryCompanyEntryDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ maxLength: 40 })
  code!: string;

  @ApiProperty({ maxLength: 100 })
  name!: string;

  @ApiProperty({ type: 'string', format: 'date-time' })
  syncedAt!: string;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  removedAt!: string | null;
}

export class CommerceReturnDeliveryCompanyEntryPageDto {
  @ApiProperty({ type: [CommerceReturnDeliveryCompanyEntryDto] })
  content!: CommerceReturnDeliveryCompanyEntryDto[];

  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;
}
