import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** POST /rakuten-query-validations body(05-2 RakutenQueryValidationRequest). 빠지면 422 VALIDATION_FAILED */
export class RakutenQueryValidationRequestDto {
  @ApiProperty({ minLength: 1, description: '검사할 라쿠텐 검색어(candidate.rakuten_query)' })
  @IsString({ message: '글자여야 합니다.' })
  @MinLength(1, { message: '비울 수 없습니다.' })
  rakutenQuery!: string;
}

/** 05-2 RakutenQueryViolation */
export class RakutenQueryViolationDto {
  @ApiProperty({ enum: ['TOO_LONG', 'WORD_TOO_SHORT'] })
  rule!: 'TOO_LONG' | 'WORD_TOO_SHORT';

  @ApiPropertyOptional({ type: String, nullable: true, description: '걸린 단어(WORD_TOO_SHORT)' })
  word?: string | null;

  @ApiProperty({ description: '화면 문구(한국어)' })
  message!: string;
}

/** 05-2 RakutenQueryValidation(저장 없는 계산) */
export class RakutenQueryValidationDto {
  @ApiProperty()
  rakutenQuery!: string;

  @ApiProperty()
  valid!: boolean;

  @ApiProperty({ type: 'integer', minimum: 0, description: '반각 환산 길이(화면 32/128자)' })
  halfWidthLength!: number;

  @ApiProperty({ type: 'integer', enum: [128] })
  maxHalfWidthLength!: 128;

  @ApiProperty({ type: [RakutenQueryViolationDto] })
  violations!: RakutenQueryViolationDto[];

  @ApiProperty({ type: 'integer', description: '검색에 붙는 설정 장르(靴) genreId' })
  genreId!: number;

  @ApiProperty({
    type: [String],
    description: '검색에 붙는 제외어(中古·キッズ·ジュニア·ベビー 등)',
  })
  ngKeywords!: string[];
}

/** POST /rakuten-items body(05-2 RakutenItemFetchRequest). 라쿠텐 상품 주소가 아니면 422 RAKUTEN_URL_INVALID */
export class RakutenItemFetchRequestDto {
  @ApiProperty({ format: 'uri', maxLength: 2048, description: '붙여 넣은 라쿠텐 상품 URL' })
  @IsString({ message: '글자여야 합니다.' })
  @MinLength(1, { message: '비울 수 없습니다.' })
  @MaxLength(2048, { message: '2048자 이내여야 합니다.' })
  sourceUrl!: string;
}

/** 05-2 RakutenSkuVariant */
export class RakutenSkuVariantDto {
  @ApiProperty({ type: 'integer', minimum: 1 }) id!: number;
  @ApiProperty({ maxLength: 64 }) variantId!: string;
  @ApiProperty({ type: String, nullable: true }) colorLabel!: string | null;
  @ApiProperty({ type: String, nullable: true }) colorCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) sizeLabel!: string | null;
  @ApiProperty({ type: 'integer', nullable: true }) sizeMm!: number | null;
  @ApiProperty({ type: String, nullable: true }) widthLabel!: string | null;
  @ApiProperty({ type: 'integer', nullable: true }) taxIncludedPriceYen!: number | null;
  @ApiProperty({ type: 'integer', nullable: true }) quantity!: number | null;
  @ApiProperty() hidden!: boolean;
  @ApiProperty({ type: Boolean, nullable: true }) backOrder!: boolean | null;
  @ApiProperty({ type: String, nullable: true }) stockCondition!: string | null;
  @ApiProperty({ type: String, nullable: true }) articleNumber!: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) postageIncluded!: boolean | null;
  @ApiProperty({ type: Boolean, nullable: true }) singleItemShipping!: boolean | null;
  @ApiProperty({ description: 'selectorValues 원문' }) selectorValues!: unknown;
  @ApiProperty({ nullable: true, description: 'SKU attributes 원문' }) attributes!: unknown;
}

/** 05-2 RakutenItemSnapshot(설명 HTML·원본 파일 경로는 뺀다) */
export class RakutenItemSnapshotDto {
  @ApiProperty({ type: 'integer', minimum: 1 }) id!: number;
  @ApiProperty({ description: '샵코드:상품ID' }) itemCode!: string;
  @ApiProperty() shopCode!: string;
  @ApiProperty({ type: String, nullable: true }) shopName!: string | null;
  @ApiProperty() itemName!: string;
  @ApiProperty() itemUrl!: string;
  @ApiProperty({ type: String, nullable: true }) modelCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) modelCodeNorm!: string | null;
  @ApiProperty({ enum: ['API', 'MANUAL'] }) entrySource!: string;
  @ApiProperty({ enum: ['SOURCING', 'URL_ENTRY', 'STOCK_CHECK', 'REFETCH', 'SYNC'] })
  fetchReason!: string;
  @ApiProperty({ format: 'date-time' }) collectedAt!: string;
  @ApiProperty({ type: 'integer', nullable: true }) genreId!: number | null;
  @ApiProperty({ enum: ['API', 'PAGE_JSON', 'ITEM_SEARCH', 'NOT_FOUND'] }) genreSource!: string;
  @ApiProperty({ type: String, nullable: true }) genrePath!: string | null;
  @ApiProperty({ type: String, nullable: true }) productType!: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) backOrderFlag!: boolean | null;
  @ApiProperty({ type: Boolean, nullable: true }) unlimitedInventory!: boolean | null;
  @ApiProperty({ type: Boolean, nullable: true }) allSkuSamePrice!: boolean | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) saleStartsAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) saleEndsAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) descriptionText!: string | null;
  @ApiProperty({ nullable: true }) attributes!: unknown;
  @ApiProperty({ nullable: true }) variantSelectors!: unknown;
  @ApiProperty({ type: [String] }) imageUrls!: string[];
  @ApiProperty() manualCheckRequired!: boolean;
  @ApiProperty({ type: String, nullable: true }) manualCheckNote!: string | null;
  @ApiProperty({ type: [RakutenSkuVariantDto] }) skus!: RakutenSkuVariantDto[];
}

/** 05-2 RakutenItemEntryChecks */
export class RakutenItemEntryChecksDto {
  @ApiProperty({ type: [String] }) excludedWords!: string[];
  @ApiProperty({ enum: ['IN_SCOPE', 'OUT_OF_SCOPE', 'NOT_FOUND'] }) genreScope!: string;
  @ApiProperty() childSizeSuspect!: boolean;
  @ApiProperty() adultConfirmationRequired!: boolean;
}

/** 05-2 RakutenItemFetchResult */
export class RakutenItemFetchResultDto {
  @ApiProperty({ type: RakutenItemSnapshotDto }) rakutenItem!: RakutenItemSnapshotDto;
  @ApiProperty({ type: RakutenItemEntryChecksDto }) checks!: RakutenItemEntryChecksDto;
}

/** 05-2 AdultProductConfirmation */
export class AdultProductConfirmationDto {
  @ApiProperty({ type: 'integer', minimum: 1 }) sourcingComparisonId!: number;
  @ApiProperty({ type: 'integer', minimum: 1 }) stepRunId!: number;
  @ApiProperty({ format: 'date-time' }) adultProductConfirmedAt!: string;
  @ApiProperty({
    enum: ['NOT_RUN', 'RUNNING', 'WAITING_INPUT', 'COMPLETED', 'FAILED', 'RERUN_REQUIRED'],
  })
  stepStatus!: string;
}
