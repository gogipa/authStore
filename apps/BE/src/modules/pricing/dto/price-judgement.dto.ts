import { ApiProperty } from '@nestjs/swagger';
import { FxRateRecordDto } from '../fx/dto/fx-rate.dto.js';

const STEP_STATUSES = [
  'NOT_RUN',
  'RUNNING',
  'WAITING_INPUT',
  'COMPLETED',
  'FAILED',
  'RERUN_REQUIRED',
] as const;
const UNSELLABLE_REASONS = ['TAXABLE', 'P_MIN_OVER_REF', 'MODE_B_NEGATIVE'] as const;
const PRICING_RULES = [
  'REF_MINUS_1PCT',
  'REF_MINUS_100',
  'MAX_SKU_SINGLE',
  'OPTION_PRICE',
] as const;
export const UNJUDGED_STOCK_STATUSES = ['SOLD_OUT', 'BACK_ORDER', 'NONE'] as const;
export type UnjudgedStockStatus = (typeof UNJUDGED_STOCK_STATUSES)[number];

/** 05-2 PriceJudgementSizeBreakdown(price_judgement_size) */
export class PriceJudgementSizeBreakdownDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  sizeMm!: number;

  @ApiProperty({ type: 'integer', nullable: true })
  rakutenSkuId!: number | null;

  @ApiProperty({ type: 'integer', minimum: 0, description: 'Y_item_i(쿠폰 전)' })
  skuPriceYen!: number;

  @ApiProperty({ type: 'integer', description: '상품원가' })
  cGoodsKrw!: number;

  @ApiProperty({ type: 'number', description: '면세 판정 달러 금액(numeric 10,2, 쿠폰 전)' })
  vUsd!: number;

  @ApiProperty()
  isDutyFree!: boolean;

  @ApiProperty({ description: '2켤레 주문 시 과세 전환' })
  twoPairTaxable!: boolean;

  @ApiProperty({ description: "150달러 경계 ±5% '경계' 배지" })
  isBoundary!: boolean;

  @ApiProperty({ type: 'integer', nullable: true })
  customsValueKrw!: number | null;

  @ApiProperty({ type: 'integer', minimum: 0 })
  cTaxKrw!: number;

  @ApiProperty({ type: 'integer', nullable: true, description: '최소 판매가 P_min_i' })
  pMinKrw!: number | null;

  @ApiProperty({ type: 'integer', minimum: 0 })
  optionPriceKrw!: number;

  @ApiProperty({ type: 'integer', nullable: true })
  sizeSalePriceKrw!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, description: '판매수수료 + Npay 수수료' })
  cMktKrw!: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  vatAKrw!: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  vatBKrw!: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  profitAKrw!: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  profitBKrw!: number | null;

  @ApiProperty({ type: 'number', nullable: true, description: '마진율(모드 A, numeric 7,4)' })
  marginRateA!: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  pointsReferencePt!: number | null;

  @ApiProperty()
  isSellable!: boolean;

  @ApiProperty({ enum: UNSELLABLE_REASONS, nullable: true })
  unsellableReason!: (typeof UNSELLABLE_REASONS)[number] | null;
}

/** 05-2 PriceJudgementUnjudgedSize(P2-05 Proposed): 판정하지 않은 목표 사이즈(② 재고 칸) */
export class PriceJudgementUnjudgedSizeDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  sizeMm!: number;

  @ApiProperty({ enum: UNJUDGED_STOCK_STATUSES, description: '품절·取り寄せ·없음' })
  stockStatus!: UnjudgedStockStatus;
}

/** 05-2 PriceJudgementDetail */
export class PriceJudgementDetailDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  stepRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({ type: 'integer', minimum: 1, description: '③ 버전 번호' })
  version!: number;

  @ApiProperty({ enum: STEP_STATUSES })
  stepStatus!: (typeof STEP_STATUSES)[number];

  @ApiProperty()
  isCurrent!: boolean;

  @ApiProperty({ enum: ['STEP2', 'OWNER_INPUT'] })
  skuPriceSource!: 'STEP2' | 'OWNER_INPUT';

  @ApiProperty({ type: 'integer', nullable: true })
  rakutenItemId!: number | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: '판정에 쓴 라쿠텐 페이지 수집 시각',
  })
  rakutenPageCollectedAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'rakutenPageCollectedAt + 설정 6시간(계산)',
  })
  pageValidUntil!: string | null;

  @ApiProperty({ type: 'integer', minimum: 1 })
  domesticPriceId!: number;

  @ApiProperty({ type: 'integer', minimum: 1, description: '판정에 쓴 국내 기준가' })
  pRefKrw!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  couponYen!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  shippingYen!: number;

  @ApiProperty({ description: "'송료 추정' 가정값 배지" })
  shippingEstimated!: boolean;

  @ApiProperty({ type: FxRateRecordDto })
  costFxRate!: FxRateRecordDto;

  @ApiProperty({ type: FxRateRecordDto })
  customsJpyFxRate!: FxRateRecordDto;

  @ApiProperty({ type: FxRateRecordDto })
  customsUsdFxRate!: FxRateRecordDto;

  @ApiProperty({ type: 'integer', nullable: true })
  forwarderRateTableId!: number | null;

  @ApiProperty({ type: 'number', nullable: true, description: '청구무게(numeric 6,3)' })
  chargeableWeightKg!: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  cShipIntlKrw!: number | null;

  @ApiProperty({ type: 'integer', minimum: 0 })
  cFwdKrw!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  fwdCouponKrw!: number;

  @ApiProperty({ description: "'가정값' 배지" })
  fwdAssumed!: boolean;

  @ApiProperty({ type: 'integer', nullable: true, description: '면세가 끝나는 엔화 경계값' })
  dutyFreeLimitYen!: number | null;

  @ApiProperty({ enum: ['A', 'B', 'C'] })
  vatMode!: 'A' | 'B' | 'C';

  @ApiProperty({ enum: PRICING_RULES })
  pricingRule!: (typeof PRICING_RULES)[number];

  @ApiProperty({ type: 'number', minimum: 0, description: '목표 마진(numeric 7,4)' })
  targetMarginRate!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  minProfitKrw!: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  params!: Record<string, unknown>;

  @ApiProperty()
  isSaleCandidate!: boolean;

  @ApiProperty({ type: 'integer', minimum: 0 })
  sellableSizeCount!: number;

  @ApiProperty({ type: 'integer', nullable: true })
  salePriceKrw!: number | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 500 })
  exclusionReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  judgedAt!: string;

  @ApiProperty({ type: [PriceJudgementSizeBreakdownDto] })
  sizes!: PriceJudgementSizeBreakdownDto[];

  @ApiProperty({
    type: [PriceJudgementUnjudgedSizeDto],
    description: '판정하지 않은 목표 사이즈(② 재고 칸 품절·取り寄せ·없음). P2-05 Proposed',
  })
  unjudgedSizes!: PriceJudgementUnjudgedSizeDto[];
}
