import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { PageMetaDto } from '../../../common/paging/page-query.dto.js';
import { REGISTRATION_OPTION_TYPES } from '../draft/approval-inputs.js';

/** 05-2 registration ⑨ 등록 스키마(P4-03). 모양은 05-2 그대로다(응답 문서용 — 05-2 `Registration*`) */

const REGISTRATION_STATUSES = [
  'VALIDATED',
  'REGISTERING',
  'RESULT_CHECK_REQUIRED',
  'REGISTERED',
] as const;
const DISPLAY_STATUS_TYPES = ['SUSPENSION', 'ON'] as const;
const FAILURE_KINDS = ['INVALID_INPUT_4XX', 'NOT_FOUND_ON_CHECK'] as const;
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

/** 05-2 RegistrationCreateRequest(문서용 — 값 검사는 `parseApprovalBody`가 Idempotency-Key 검사 뒤에 한다) */
export class RegistrationCreateRequestDto {
  @ApiProperty({ enum: REGISTRATION_OPTION_TYPES })
  optionType!: 'COMBINATION' | 'STANDARD';

  @ApiProperty({ type: 'integer', minimum: 1 })
  expectedUploadResultId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  expectedPriceJudgementId!: number;
}

/** 05-2 RegistrationAccepted(202) */
export class RegistrationAcceptedDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  registrationId!: number;

  @ApiProperty({ type: 'integer', minimum: 1, description: '함께 만든 ⑨ 실행 기록' })
  stepRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({
    enum: ['VALIDATED', 'REGISTERING'],
    description: 'VALIDATED=드라이런 저장, REGISTERING=등록 요청 중',
  })
  status!: 'VALIDATED' | 'REGISTERING';

  @ApiProperty({ maxLength: 200 })
  sellerManagementCode!: string;

  @ApiProperty({ enum: DISPLAY_STATUS_TYPES })
  displayStatusType!: 'SUSPENSION' | 'ON';

  @ApiProperty({ format: 'date-time', description: 'G4 승인 시각' })
  approvedAt!: string;
}

/** 05-2 RegistrationSummary */
export class RegistrationSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  registrationId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  stepRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1, description: '⑨ 버전(step_run.version)' })
  stepRunVersion!: number;

  @ApiProperty({ enum: REGISTRATION_STATUSES })
  status!: (typeof REGISTRATION_STATUSES)[number];

  @ApiProperty({ maxLength: 200 })
  sellerManagementCode!: string;

  @ApiProperty({ enum: REGISTRATION_OPTION_TYPES })
  optionType!: 'COMBINATION' | 'STANDARD';

  @ApiProperty({ enum: DISPLAY_STATUS_TYPES })
  displayStatusType!: 'SUSPENSION' | 'ON';

  @ApiProperty({ format: 'date-time' })
  approvedAt!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  registeredAt?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^[0-9]+$', maxLength: 20 })
  originProductNo?: string | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  httpStatus?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  errorCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: '한국어로 풀어 쓴 오류' })
  errorMessage?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  failedAt?: string | null;

  @ApiPropertyOptional({ enum: FAILURE_KINDS, nullable: true })
  failureKind?: (typeof FAILURE_KINDS)[number] | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** 05-2 RegistrationSummaryPage */
export class RegistrationSummaryPageDto {
  @ApiProperty({ type: [RegistrationSummaryDto] })
  content!: RegistrationSummaryDto[];

  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;
}

/** 05-2 RegistrationDetail(request_json 제외) */
export class RegistrationDetailDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  registrationId!: number;

  @ApiProperty({ type: 'integer', minimum: 1, description: 'step_run으로 이어 계산' })
  candidateId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  stepRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  priceJudgementId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  uploadResultId!: number;

  @ApiProperty({ enum: REGISTRATION_STATUSES })
  status!: (typeof REGISTRATION_STATUSES)[number];

  @ApiProperty({ maxLength: 128 })
  itemCode!: string;

  @ApiProperty({ maxLength: 128 })
  selectedColor!: string;

  @ApiProperty({ maxLength: 64 })
  colorCode!: string;

  @ApiProperty({ maxLength: 200 })
  sellerManagementCode!: string;

  @ApiProperty({ enum: DISPLAY_STATUS_TYPES })
  displayStatusType!: 'SUSPENSION' | 'ON';

  @ApiProperty({ enum: REGISTRATION_OPTION_TYPES })
  optionType!: 'COMBINATION' | 'STANDARD';

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: '승인 직전 RG-08 사전 검증 결과(checks[] 등)',
  })
  validationResult!: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  approvedAt!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  requestSentAt?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  responseReceivedAt?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastResultCheckAt?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  registeredAt?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^[0-9]+$', maxLength: 20 })
  originProductNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^[0-9]+$', maxLength: 20 })
  channelProductNo?: string | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  httpStatus?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  errorCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  errorMessage?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: '4xx invalidInputs 원문',
    oneOf: [{ type: 'array', items: {} }, { type: 'object' }],
  })
  invalidInputs?: unknown;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 100,
    description: 'GNCP-GW-Trace-ID',
  })
  traceId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  failedAt?: string | null;

  @ApiPropertyOptional({ enum: FAILURE_KINDS, nullable: true })
  failureKind?: (typeof FAILURE_KINDS)[number] | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    description: 'P4-03(Proposed): 스마트스토어센터 상품 화면 주소(상품 번호가 있을 때)',
  })
  smartstoreProductUrl?: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/** 05-2 RegistrationResultCheck */
export class RegistrationResultCheckDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  registrationId!: number;

  @ApiProperty({ description: 'SELLER_CODE 조회로 상품을 찾았는지' })
  found!: boolean;

  @ApiProperty({ enum: REGISTRATION_STATUSES })
  status!: (typeof REGISTRATION_STATUSES)[number];

  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^[0-9]+$', maxLength: 20 })
  originProductNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^[0-9]+$', maxLength: 20 })
  channelProductNo?: string | null;

  @ApiProperty({ format: 'date-time' })
  lastResultCheckAt!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  failedAt?: string | null;

  @ApiPropertyOptional({ enum: FAILURE_KINDS, nullable: true })
  failureKind?: (typeof FAILURE_KINDS)[number] | null;

  @ApiProperty({ enum: CANDIDATE_STATUSES })
  candidateStatus!: (typeof CANDIDATE_STATUSES)[number];
}

/** 05-2 RegistrationSwitchState */
export class RegistrationSwitchStateDto {
  @ApiProperty({ description: 'true면 등록 API 차단(드라이런)' })
  apiBlocked!: boolean;

  @ApiProperty({ format: 'date-time' })
  changedAt!: string;
}

/** 05-2 RegistrationSwitchUpdateRequest. 정의 밖 칸·불리언 아님은 422 VALIDATION_FAILED */
export class RegistrationSwitchUpdateRequestDto {
  @ApiProperty()
  @IsBoolean({ message: 'true·false 중 하나여야 합니다.' })
  apiBlocked!: boolean;
}

/** 05-2 RegistrationSwitchChanged */
export class RegistrationSwitchChangedDto extends RegistrationSwitchStateDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'integer' },
    description: '스위치를 꺼서 VALIDATED → AWAITING_APPROVAL로 되돌린 후보',
  })
  revertedCandidateIds!: number[];
}
