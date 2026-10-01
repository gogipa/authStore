import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  REGISTRATION_OPTION_TYPES,
  type RegistrationDisplayStatusType,
  type RegistrationOptionType,
} from '../draft/approval-inputs.js';
import {
  PRE_VALIDATION_CHECK_CODES,
  type PreValidationCheckCode,
  type PreValidationGateCode,
  type PreValidationSeverity,
} from '../pre-validation/pre-validation.types.js';

/** 05-2 registration G4 스키마(P4-02). 모양은 05-2 그대로다(응답 문서용 — 05-2 `ApprovalPreview` 등) */

const CANDIDATE_STATUSES = [
  'TEMP',
  'WORKING',
  'EXCLUDED',
  'AWAITING_APPROVAL',
  'VALIDATED',
  'REGISTERING',
  'RESULT_CHECK_REQUIRED',
  'REGISTERED',
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
const IMAGE_ROLES = ['REPRESENTATIVE', 'ADDITIONAL'] as const;
const DISPLAY_STATUS_TYPES = ['SUSPENSION', 'ON'] as const;
const GATE_CODES = ['G1', 'G2', 'G3', 'G4'] as const;
const UNSELLABLE_REASONS = ['TAXABLE', 'P_MIN_OVER_REF', 'MODE_B_NEGATIVE'] as const;
const OPTION_TYPE_MESSAGE = 'COMBINATION·STANDARD 중 하나여야 합니다.';

/** 05-2 PreValidationRequest(body 선택). 정의 밖 값이면 422 VALIDATION_FAILED */
export class PreValidationRequestDto {
  @ApiPropertyOptional({
    enum: REGISTRATION_OPTION_TYPES,
    description: '사이즈 옵션 방식. 없으면 COMBINATION(조합형)',
  })
  @IsOptional()
  @IsIn(REGISTRATION_OPTION_TYPES, { message: OPTION_TYPE_MESSAGE })
  optionType?: RegistrationOptionType;
}

/** 05-2 PreValidationCheck */
export class PreValidationCheckDto {
  @ApiProperty({ enum: PRE_VALIDATION_CHECK_CODES })
  checkCode!: PreValidationCheckCode;

  @ApiProperty()
  passed!: boolean;

  @ApiProperty({ enum: ['BLOCK', 'WARN'], description: 'BLOCK이 실패면 승인 불가' })
  severity!: PreValidationSeverity;

  @ApiPropertyOptional({ type: String, nullable: true, description: '실패 사유(한국어)' })
  reason?: string | null;

  @ApiPropertyOptional({ enum: STEP_CODES, nullable: true, description: '고칠 단계' })
  stepCode?: (typeof STEP_CODES)[number] | null;

  @ApiPropertyOptional({ enum: GATE_CODES, nullable: true, description: '관련 게이트' })
  gateCode?: PreValidationGateCode | null;
}

/** 05-2 ApprovalWarning */
export class ApprovalWarningDto {
  @ApiProperty({ pattern: '^[A-Z][A-Z0-9_]*$' })
  code!: string;

  @ApiProperty()
  message!: string;
}

/** 05-2 ApprovalDuplicateInfo */
export class ApprovalDuplicateInfoDto {
  @ApiProperty()
  duplicated!: boolean;

  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 1 })
  existingRegistrationId?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^[0-9]+$' })
  originProductNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^[0-9]+$' })
  channelProductNo?: string | null;

  @ApiPropertyOptional({
    enum: ['LOCAL', 'COMMERCE_API'],
    nullable: true,
    description: 'P4-03: 찾은 곳(이 앱 등록 기록 / 커머스API SELLER_CODE 조회)',
  })
  source?: 'LOCAL' | 'COMMERCE_API' | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: "P4-03: 이 앱 기록이 '등록됨'이 된 시각",
  })
  registeredAt?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    description: 'P4-03(Proposed): 스마트스토어센터 상품 화면 주소(새 창)',
  })
  smartstoreProductUrl?: string | null;
}

/** 05-2 PreValidationResult */
export class PreValidationResultDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({ description: 'BLOCK 항목이 모두 통과했는지' })
  approvable!: boolean;

  @ApiProperty({ type: [PreValidationCheckDto] })
  checks!: PreValidationCheckDto[];

  @ApiProperty({ format: 'date-time' })
  checkedAt!: string;

  @ApiProperty({ type: [ApprovalWarningDto] })
  warnings!: ApprovalWarningDto[];

  @ApiPropertyOptional({
    type: ApprovalDuplicateInfoDto,
    description: 'P4-03: 로컬 등록 기록 + SELLER_CODE 교차 조회로 본 중복(기존 상품 보기)',
  })
  duplicate?: ApprovalDuplicateInfoDto;
}

/** 05-2 ApprovalSizeOption: 사이즈 한 줄과 마진 분해 */
export class ApprovalSizeOptionDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  sizeMm!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  skuPriceYen!: number;

  @ApiProperty({ type: 'integer' })
  cGoodsKrw!: number;

  @ApiPropertyOptional({ type: Number })
  vUsd?: number;

  @ApiProperty()
  isDutyFree!: boolean;

  @ApiPropertyOptional()
  isBoundary?: boolean;

  @ApiProperty({ type: 'integer', minimum: 0 })
  cTaxKrw!: number;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  pMinKrw?: number | null;

  @ApiProperty({ type: 'integer', minimum: 0 })
  optionPriceKrw!: number;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  sizeSalePriceKrw?: number | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  cMktKrw?: number | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  vatAKrw?: number | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  vatBKrw?: number | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  profitAKrw?: number | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  profitBKrw?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  marginRateA?: number | null;

  @ApiProperty()
  isSellable!: boolean;

  @ApiPropertyOptional({ enum: UNSELLABLE_REASONS, nullable: true })
  unsellableReason?: (typeof UNSELLABLE_REASONS)[number] | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 0 })
  stockQuantity?: number | null;
}

/** 05-2 ApprovalMarginBreakdown */
export class ApprovalMarginBreakdownDto {
  @ApiProperty({ type: 'integer', minimum: 0 })
  couponYen!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  shippingYen!: number;

  @ApiProperty()
  shippingEstimated!: boolean;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  cShipIntlKrw?: number | null;

  @ApiProperty({ type: 'integer', minimum: 0 })
  cFwdKrw!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  fwdCouponKrw!: number;

  @ApiProperty()
  fwdAssumed!: boolean;

  @ApiProperty({ enum: ['A', 'B', 'C'] })
  vatMode!: 'A' | 'B' | 'C';

  @ApiProperty({ enum: ['REF_MINUS_1PCT', 'REF_MINUS_100', 'MAX_SKU_SINGLE', 'OPTION_PRICE'] })
  pricingRule!: string;

  @ApiProperty({ type: Number, minimum: 0 })
  targetMarginRate!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  minProfitKrw!: number;

  @ApiProperty({ type: [ApprovalSizeOptionDto] })
  sizes!: ApprovalSizeOptionDto[];
}

/** 05-2 ApprovalImageItem */
export class ApprovalImageItemDto {
  @ApiProperty({ enum: IMAGE_ROLES })
  role!: (typeof IMAGE_ROLES)[number];

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 9 })
  sortOrder!: number;

  @ApiProperty({ maxLength: 500 })
  url!: string;
}

/** 05-2 ApprovalDisabledReason */
export class ApprovalDisabledReasonDto {
  @ApiProperty({
    pattern: '^[A-Z][A-Z0-9_]*$',
    description: '승인 API가 돌려줄 409·422 코드와 같은 값',
  })
  code!: string;

  @ApiProperty()
  message!: string;
}

/** 05-2 FinalTagItem */
export class ApprovalTagItemDto {
  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^[0-9]+$' })
  code?: string | null;

  @ApiProperty({ maxLength: 100 })
  text!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 10 })
  finalOrder!: number;
}

/** 05-2 ApprovalSourcingMethod(P4-02 추가): 소싱 방식(비교함 / 비교 없이 확정) */
export class ApprovalSourcingMethodDto {
  @ApiProperty({ enum: ['COMPARED', 'NO_COMPARISON_CONFIRMED', 'NOT_CONFIRMED'] })
  method!: 'COMPARED' | 'NO_COMPARISON_CONFIRMED' | 'NOT_CONFIRMED';

  @ApiProperty({ enum: ['KEYWORD', 'SEARCH_QUERY', 'RAKUTEN_URL'] })
  creationPath!: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  noComparisonConfirmedAt?: string | null;

  @ApiProperty({ maxLength: 128, description: '고른 라쿠텐 상품(샵코드:상품ID)' })
  itemCode!: string;
}

/** 05-2 ApprovalPreview */
export class ApprovalPreviewDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({ enum: CANDIDATE_STATUSES })
  candidateStatus!: (typeof CANDIDATE_STATUSES)[number];

  @ApiProperty({ enum: REGISTRATION_OPTION_TYPES })
  optionType!: RegistrationOptionType;

  @ApiProperty()
  apiBlocked!: boolean;

  @ApiProperty({ maxLength: 255 })
  productName!: string;

  @ApiProperty({ type: 'integer', minimum: 0 })
  salePriceKrw!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  priceJudgementId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  uploadResultId!: number;

  @ApiProperty({ format: 'date-time' })
  judgedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  rakutenPageCollectedAt?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  judgementExpiresAt?: string | null;

  @ApiProperty({ type: ApprovalMarginBreakdownDto })
  marginBreakdown!: ApprovalMarginBreakdownDto;

  @ApiProperty({ type: [ApprovalImageItemDto] })
  images!: ApprovalImageItemDto[];

  @ApiProperty()
  detailContent!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  noticeFields!: Record<string, string>;

  @ApiProperty({ maxLength: 20 })
  originAreaCode!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  originAreaContent?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  originLabel?: string | null;

  @ApiProperty({ maxLength: 100 })
  importer!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 20 })
  leafCategoryId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  wholeCategoryName?: string | null;

  @ApiProperty({ type: [ApprovalTagItemDto] })
  tags!: ApprovalTagItemDto[];

  @ApiPropertyOptional({ type: ApprovalSourcingMethodDto, nullable: true })
  sourcingMethod?: ApprovalSourcingMethodDto | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  requestJsonDraft!: Record<string, unknown>;

  @ApiProperty({ maxLength: 200 })
  sellerManagementCode!: string;

  @ApiProperty({ enum: DISPLAY_STATUS_TYPES })
  displayStatusType!: RegistrationDisplayStatusType;

  @ApiProperty({ type: ApprovalDuplicateInfoDto })
  duplicate!: ApprovalDuplicateInfoDto;

  @ApiProperty()
  approveEnabled!: boolean;

  @ApiPropertyOptional({ type: ApprovalDisabledReasonDto, nullable: true })
  approveDisabledReason?: ApprovalDisabledReasonDto | null;

  @ApiProperty({ type: [ApprovalWarningDto] })
  warnings!: ApprovalWarningDto[];

  @ApiPropertyOptional({
    description: "P4-03: ④ 리프가 표준형 옵션을 지원하는지('표준형으로 바꾸기' 보이기, F-AP-41)",
  })
  standardOptionSupported?: boolean;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    description: "P4-03: 처음 N건 셈(진행 중·등록됨, failed_at 없음 — '(3/10)')",
  })
  liveRegistrationCount?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    description: 'P4-03: 설정 registration.initialSuspensionCount(처음 N건)',
  })
  initialSuspensionCount?: number;
}
