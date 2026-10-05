import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * P2-03 요청·응답 모양(05-2 SourcingAnchorRequest·SourcingComparisonRowPatch·SourcingManualRowRequest·
 * SourcingSelectionRequest·SourcingJobAccepted·SourcingSelectionResult). 문서(openapi:export)용이다 — 본문 검사는
 * sourcing-requests.ts가 한다(앵커는 anchorInputMethod로 가르는 oneOf라 class-validator로 표현하지 않는다).
 */

export class SourcingAnchorRequestDto {
  @ApiProperty({ enum: ['SEARCH_PICK', 'CODE_ENTRY'] })
  anchorInputMethod!: 'SEARCH_PICK' | 'CODE_ENTRY';

  @ApiPropertyOptional({
    maxLength: 128,
    description: 'SEARCH_PICK: 앵커로 고른 행의 itemCode(필수)',
  })
  anchorItemCode?: string;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 128,
    description: 'CODE_ENTRY: 型番 원문(필수, 서버가 정규화)',
  })
  anchorModelCode?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 64,
    description: '색상 코드(선택, §7-27)',
  })
  anchorColorCode?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 128,
    description: '색상 원문 라벨',
  })
  anchorColorLabel?: string | null;
}

export class SourcingJobAcceptedDto {
  @ApiProperty({ type: 'integer', minimum: 1 }) candidateId!: number;
  @ApiProperty({ type: 'integer', minimum: 1 }) sourcingComparisonId!: number;
  @ApiProperty({ type: 'integer', minimum: 1, description: '이 비교표의 ② 실행 기록' })
  stepRunId!: number;
  @ApiProperty({ description: '② 실행 상태(StepStatus)' }) stepStatus!: string;
  @ApiProperty({ type: 'integer', nullable: true, description: '재고 확인한 행. 앵커 요청은 null' })
  rowId!: number | null;
}

export class SourcingComparisonRowPatchDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 0, description: '행별 쿠폰 금액(엔)' })
  couponYen?: number;

  @ApiPropertyOptional({ minimum: 0, description: '샵·이벤트 포인트 배율(배)' })
  shopEventMultiplier?: number;

  @ApiPropertyOptional({
    enum: ['MATCH', 'NO_MATCH'],
    nullable: true,
    description: '동일 상품 오너 최종 판단',
  })
  ownerMatchDecision?: 'MATCH' | 'NO_MATCH' | null;
}

export class SourcingManualRowRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: 'POST /rakuten-items로 읽은 스냅샷' })
  rakutenItemId!: number;
}

export class SourcingSelectionRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: '고를 검증 행' })
  rowId!: number;
}

export class SourcingSelectionResultDto {
  @ApiProperty({ type: 'integer', minimum: 1 }) candidateId!: number;
  @ApiProperty({ type: 'integer', minimum: 1 }) sourcingComparisonId!: number;
  @ApiProperty({ type: 'integer', minimum: 1 }) stepRunId!: number;
  @ApiProperty({ description: '② 실행 상태(StepStatus)' }) stepStatus!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) selectedRowId!: number;
  @ApiProperty({ maxLength: 128, description: '후보에 반영한 itemCode' }) itemCode!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 128 }) selectedColor!: string | null;
  @ApiProperty({ description: '다른 샵으로 바꿔 G2를 다시 통과해야 하면 true' })
  g2Invalidated!: boolean;
  @ApiProperty({ type: [String], description: '재실행 필요로 바뀐 뒷단계' })
  staleDownstreamSteps!: string[];
}

/** 05-2 SourcingSearchMoreResult(검색 결과 더 보기 `loadMoreSourcingSearchRows`) */
export class SourcingSearchMoreResultDto {
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: '새로 더한 행 수(이미 있는 상품·아동용 단어 행은 뺀 수)',
  })
  addedRowCount!: number;
  @ApiProperty({
    type: Boolean,
    description: '다음 페이지가 더 있을 수 있는가(받은 페이지가 가득 찼고 새 행이 있었으면 true)',
  })
  hasMore!: boolean;
}

/** 05-2 SourcingComparisonRow.aiMatch(AI 보조 판정 참고값) */
export class SourcingAiMatchDto {
  @ApiPropertyOptional({ type: Boolean })
  match?: boolean;
  @ApiPropertyOptional({ type: Number })
  confidence?: number;
  @ApiPropertyOptional({ type: String })
  reason?: string;
}

/** 05-2 SourcingComparisonRow(응답 문서용 — 값은 sourcing-comparison.view.ts가 만든다) */
export class SourcingComparisonRowViewDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;
  @ApiProperty({ type: 'integer', minimum: 1 })
  sourcingComparisonId!: number;
  @ApiProperty({ enum: ['API', 'MANUAL'] })
  rowSource!: string;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  searchRank?: number | null;
  @ApiProperty({ type: String, maxLength: 128 })
  itemCode!: string;
  @ApiProperty({ type: String, maxLength: 64 })
  shopCode!: string;
  @ApiPropertyOptional({ type: String, maxLength: 255, nullable: true })
  shopName?: string | null;
  @ApiProperty({ type: String })
  itemName!: string;
  @ApiProperty({ type: String, maxLength: 2048 })
  itemUrl!: string;
  @ApiPropertyOptional({
    type: String,
    maxLength: 2048,
    nullable: true,
    description:
      '검색 결과의 대표 사진 주소(Item Search mediumImageUrls[0]). 없거나 수동 행이면 null',
  })
  imageUrl?: string | null;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  apiItemPriceYen?: number | null;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  apiItemPriceMin3Yen?: number | null;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  apiPointRate?: number | null;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  apiPostageFlag?: number | null;
  @ApiPropertyOptional({ type: 'integer', minimum: 0, nullable: true })
  reviewCount?: number | null;
  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 5, nullable: true })
  reviewAverage?: number | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true })
  shipOverseas?: boolean | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  apiCollectedAt?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  rakutenPageCollectedAt?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 128, nullable: true })
  modelCodeNorm?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 64, nullable: true })
  colorCode?: string | null;
  @ApiPropertyOptional({ enum: ['MATCH', 'NEEDS_REVIEW', 'NO_MATCH'], nullable: true })
  anchorMatch?: string | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true })
  janMatch?: boolean | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true })
  makerModelMatch?: boolean | null;
  @ApiPropertyOptional({ type: SourcingAiMatchDto, nullable: true })
  aiMatch?: SourcingAiMatchDto | null;
  @ApiPropertyOptional({ enum: ['MATCH', 'NO_MATCH'], nullable: true })
  ownerMatchDecision?: string | null;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  fetchOrder?: number | null;
  @ApiProperty({ type: Boolean })
  isVerified!: boolean;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  rakutenItemId?: number | null;
  @ApiProperty({ type: Boolean })
  manualCheckRequired!: boolean;
  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  manualCheckReason?: string | null;
  @ApiPropertyOptional({ type: 'integer', minimum: 0, nullable: true })
  inStockSizeCount?: number | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true })
  stockPass?: boolean | null;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  representativeRakutenSkuId?: number | null;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  representativePriceYen?: number | null;
  @ApiPropertyOptional({ type: 'integer', minimum: 0, nullable: true })
  shippingYen?: number | null;
  @ApiPropertyOptional({ enum: ['FREE', 'DEFAULT_ESTIMATE', 'OWNER_INPUT'], nullable: true })
  shippingSource?: string | null;
  @ApiProperty({ type: 'integer', minimum: 0 })
  couponYen!: number;
  @ApiProperty({ type: Number, minimum: 0 })
  shopEventMultiplier!: number;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  pointBaseAmountYen?: number | null;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  pointsBasePt?: number | null;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  pointsItemPt?: number | null;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  pointsShopEventPt?: number | null;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  pointsSpuPt?: number | null;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  pointsTotalPt?: number | null;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  effectivePriceYen?: number | null;
  @ApiProperty({ type: Boolean })
  isSelected!: boolean;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  saleStartsAt?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  saleEndsAt?: string | null;
  @ApiPropertyOptional({ type: Number, minimum: 0, nullable: true })
  couponPercent?: number | null;
  @ApiPropertyOptional({ type: 'integer', minimum: 0, nullable: true })
  couponMinAmountYen?: number | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true })
  couponCombinable?: boolean | null;
  @ApiPropertyOptional({ type: String, maxLength: 2048, nullable: true })
  couponPageUrl?: string | null;
  @ApiPropertyOptional({ type: [String] })
  riskFlags?: string[];
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** 05-2 SourcingComparisonDetail(응답 문서용 — 값은 sourcing-comparison.view.ts가 만든다) */
export class SourcingComparisonDetailDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;
  @ApiProperty({ type: 'integer', minimum: 1 })
  stepRunId!: number;
  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;
  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number;
  @ApiProperty({
    enum: ['NOT_RUN', 'RUNNING', 'WAITING_INPUT', 'COMPLETED', 'FAILED', 'RERUN_REQUIRED'],
  })
  stepStatus!: string;
  @ApiProperty({ type: Boolean })
  isCurrent!: boolean;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  baseSourcingComparisonId?: number | null;
  @ApiProperty({ enum: ['SEARCH_COMPARE', 'URL_CREATE', 'REFETCH'] })
  action!: string;
  @ApiPropertyOptional({ type: String, maxLength: 128, nullable: true })
  searchKeyword?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 2048, nullable: true })
  sourceUrl?: string | null;
  @ApiPropertyOptional({ enum: ['SEARCH_PICK', 'CODE_ENTRY', 'URL_ITEM'], nullable: true })
  anchorInputMethod?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 128, nullable: true })
  anchorItemCode?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 128, nullable: true })
  anchorModelCode?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 128, nullable: true })
  anchorModelCodeNorm?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 64, nullable: true })
  anchorColorCode?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 128, nullable: true })
  anchorColorLabel?: string | null;
  @ApiProperty({ type: Boolean })
  exploreMode!: boolean;
  @ApiProperty({ type: Boolean })
  comparisonPerformed!: boolean;
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  selectedRakutenItemId?: number | null;
  @ApiPropertyOptional({ type: 'integer', minimum: 0, nullable: true })
  shippingYen?: number | null;
  @ApiPropertyOptional({ enum: ['FREE', 'DEFAULT_ESTIMATE', 'OWNER_INPUT'], nullable: true })
  shippingSource?: string | null;
  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE'], nullable: true })
  detectedGender?: string | null;
  @ApiPropertyOptional({ enum: ['KEYWORD_CID', 'GENRE_PATH', 'ITEM_NAME'], nullable: true })
  genderBasis?: string | null;
  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE'], nullable: true })
  ownerGender?: string | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true })
  childSizeSuspect?: boolean | null;
  @ApiPropertyOptional({ enum: ['IN_SCOPE', 'OUT_OF_SCOPE', 'NOT_FOUND'], nullable: true })
  genreScope?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  adultProductConfirmedAt?: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true })
  params!: Record<string, unknown>;
  @ApiProperty({ type: String })
  creditText!: string;
  @ApiProperty({ type: [SourcingComparisonRowViewDto] })
  rows!: SourcingComparisonRowViewDto[];
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** 05-2 SourcingRowRecalculation(행 수정 응답) */
export class SourcingRowRecalculationDto {
  @ApiProperty({ type: SourcingComparisonRowViewDto })
  row!: SourcingComparisonRowViewDto;
  @ApiProperty({ type: 'integer', isArray: true, description: '실질가 순서(행 id)' })
  rankedRowIds!: number[];
}
