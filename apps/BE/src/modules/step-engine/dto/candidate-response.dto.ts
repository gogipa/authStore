import { ApiProperty } from '@nestjs/swagger';
import { PageMetaDto } from '../../../common/paging/page-query.dto.js';
import { CANDIDATE_STATUSES, STEP_FLOW, STEP_STATUSES } from '../domain/steps.js';
import type {
  CandidateExcludedReason,
  CandidateStatus,
  CandidateStatusReason,
  StepCode,
  StepFailureKind,
  StepStatus,
} from '../domain/steps.js';
import { CREATION_PATHS, type CreationPath } from './candidate-request.dto.js';

/**
 * step-engine 후보 응답(05-2 components.schemas 필드 그대로). 시각은 ISO 8601 문자열.
 * 구현 명세(@nestjs/swagger)는 OpenAPI 3.0이라 null 허용은 nullable로 적었다(06-2 §9-5).
 */

const EXCLUDED_REASONS = [
  'ANCHOR_NO_MATCH',
  'INSUFFICIENT_STOCK',
  'NOT_SALE_CANDIDATE',
  'OWNER_EXCLUDED',
];
const STATUS_REASONS = [
  'CREATED',
  'TEMP_LINKED',
  'ANCHOR_NO_MATCH',
  'INSUFFICIENT_STOCK',
  'NOT_SALE_CANDIDATE',
  'OWNER_EXCLUDED',
  'REOPENED',
  'READY_FOR_APPROVAL',
  'STEP_NOT_CURRENT',
  'GATE_FINGERPRINT_CHANGED',
  'REFETCH_G2_UNCHANGED',
  'G4_APPROVED_BLOCKED',
  'BLOCK_SWITCH_OFF',
  'G4_APPROVED',
  'REGISTER_SUCCEEDED',
  'REGISTER_4XX',
  'REGISTER_UNKNOWN',
  'APP_RESTART',
  'RESTART_REVERTED',
  'SELLER_CODE_FOUND',
  'SELLER_CODE_NOT_FOUND',
];
const FAILURE_KINDS = ['EXTERNAL_API', 'AI', 'INPUT_VALIDATION', 'INTERRUPTED'];

const nullableString = (description?: string, maxLength?: number) =>
  ApiProperty({ type: 'string', nullable: true, description, maxLength });
const nullableDateTime = (description?: string) =>
  ApiProperty({ type: 'string', format: 'date-time', nullable: true, description });
const dateTime = (description?: string) =>
  ApiProperty({ type: 'string', format: 'date-time', description });

/** 05-2 CandidateWarning */
export class CandidateWarningDto {
  @ApiProperty({ pattern: '^[A-Z][A-Z0-9_]*$', description: '경고 코드(ANCHOR_KEY_DUPLICATE 등)' })
  code!: string;

  @ApiProperty({ description: '화면에 그대로 보여 줄 한국어 문구' })
  message!: string;
}

/** 05-2 CandidateStepBrief */
export class CandidateStepBriefDto {
  @ApiProperty({ enum: STEP_FLOW })
  stepCode!: StepCode;

  @ApiProperty({ enum: STEP_STATUSES })
  status!: StepStatus;
}

/** 05-2 CandidateSummary(목록 한 줄) */
export class CandidateSummaryDto {
  @ApiProperty({ type: 'integer' })
  id!: number;

  @ApiProperty({ enum: CREATION_PATHS })
  creationPath!: CreationPath;

  @ApiProperty({ enum: CANDIDATE_STATUSES })
  status!: CandidateStatus;

  @dateTime()
  statusChangedAt!: string;

  @ApiProperty({ enum: EXCLUDED_REASONS, nullable: true })
  excludedReason!: CandidateExcludedReason | null;

  @nullableString('후보 표시명(현재 ② 선택 상품명 · 선택 색상). 소싱 선택 전에는 검색어 또는 null')
  displayName!: string | null;

  @nullableString(undefined, 128)
  rakutenQuery!: string | null;

  @nullableString(undefined, 128)
  anchorModelCode!: string | null;

  @nullableString(undefined, 128)
  itemCode!: string | null;

  @nullableString(undefined, 128)
  selectedColor!: string | null;

  @ApiProperty({ enum: ['MALE', 'FEMALE'], nullable: true })
  gender!: 'MALE' | 'FEMALE' | null;

  @ApiProperty({
    enum: STEP_FLOW,
    nullable: true,
    description: '이어 할 단계(계산값). 없으면 null',
  })
  resumeStepCode!: StepCode | null;

  @ApiProperty({ type: [CandidateStepBriefDto], description: '단계 10개의 상태 요약' })
  steps!: CandidateStepBriefDto[];

  @dateTime()
  createdAt!: string;

  @dateTime()
  updatedAt!: string;
}

/** 05-2 CandidatePage */
export class CandidatePageDto {
  @ApiProperty({ type: [CandidateSummaryDto] })
  content!: CandidateSummaryDto[];

  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;
}

/** 05-2 CandidateStatusCount */
export class CandidateStatusCountDto {
  @ApiProperty({ enum: CANDIDATE_STATUSES })
  status!: CandidateStatus;

  @ApiProperty({ type: 'integer', minimum: 0 })
  count!: number;
}

/** 05-2 CandidateStatusCountList */
export class CandidateStatusCountListDto {
  @ApiProperty({ type: [CandidateStatusCountDto] })
  items!: CandidateStatusCountDto[];
}

/** 05-2 CandidateResumeTarget */
export class CandidateResumeTargetDto {
  @ApiProperty({ type: 'integer' })
  candidateId!: number;

  @ApiProperty({ enum: CANDIDATE_STATUSES })
  candidateStatus!: CandidateStatus;

  @ApiProperty({ enum: STEP_FLOW, nullable: true })
  stepCode!: StepCode | null;

  @ApiProperty({ enum: STEP_STATUSES, nullable: true })
  stepStatus!: StepStatus | null;

  @ApiProperty({ enum: ['G2', 'G3', 'G4'], nullable: true, description: '대기 중인 게이트' })
  gate!: 'G2' | 'G3' | 'G4' | null;
}

/** 05-2 CandidateGateValidity */
export class CandidateGateValidityDto {
  @ApiProperty({ enum: ['G2', 'G3'] })
  gate!: 'G2' | 'G3';

  @ApiProperty({ type: 'integer', nullable: true })
  gatePassId!: number | null;

  @nullableDateTime()
  passedAt!: string | null;

  @ApiProperty({ description: '지금 유효한가. 통과 기록이 없으면 false' })
  valid!: boolean;
}

/** 05-2 ContinuousRunSummary */
export class ContinuousRunSummaryDto {
  @ApiProperty({ type: 'integer', description: 'stepChainId' })
  id!: number;

  @ApiProperty({ type: 'integer' })
  candidateId!: number;

  @ApiProperty({ enum: ['FROM_HERE', 'RERUN_STALE'] })
  kind!: string;

  @ApiProperty({ enum: STEP_FLOW, nullable: true })
  startStepCode!: StepCode | null;

  @dateTime()
  startedAt!: string;

  @nullableDateTime('진행 중이면 null')
  endedAt!: string | null;

  @ApiProperty({
    enum: ['AWAIT_G2', 'AWAIT_G3', 'AWAIT_G4', 'NO_RUNNABLE_STEP', 'APP_RESTART'],
    nullable: true,
  })
  stopReason!: string | null;

  @ApiProperty({ enum: STEP_FLOW, nullable: true })
  stopStepCode!: StepCode | null;
}

/** 05-2 CandidateDetail(+ resumeStepCode, P1-04에서 명세에 더함) */
export class CandidateDetailDto {
  @ApiProperty({ type: 'integer' })
  id!: number;

  @ApiProperty({ enum: CREATION_PATHS })
  creationPath!: CreationPath;

  @ApiProperty({ enum: CANDIDATE_STATUSES })
  status!: CandidateStatus;

  @dateTime()
  statusChangedAt!: string;

  @ApiProperty({ enum: EXCLUDED_REASONS, nullable: true })
  excludedReason!: CandidateExcludedReason | null;

  @nullableString('후보 표시명. 소싱 선택 전에는 검색어 또는 null')
  displayName!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, description: '출처 키워드(G1에서 고른 keyword)' })
  sourceKeywordId!: number | null;

  @nullableString('출처 키워드 글자(정보로만 표시)', 100)
  sourceKeyword!: string | null;

  @nullableString(undefined, 128)
  rakutenQuery!: string | null;

  @nullableString("'URL로 만들기'에 붙여 넣은 라쿠텐 상품 URL", 2048)
  sourceUrl!: string | null;

  @nullableString('앵커 型番 정규화값', 128)
  anchorModelCode!: string | null;

  @nullableString('型番이 없을 때의 앵커 itemCode', 128)
  anchorItemCode!: string | null;

  @nullableString(undefined, 64)
  anchorColorCode!: string | null;

  @nullableDateTime('앵커 키 확정 시각. 있으면 앵커를 바꿀 수 없다')
  anchorFixedAt!: string | null;

  @nullableString('소싱 선택 itemCode', 128)
  itemCode!: string | null;

  @nullableString(undefined, 128)
  selectedColor!: string | null;

  @ApiProperty({ enum: ['MALE', 'FEMALE'], nullable: true })
  gender!: 'MALE' | 'FEMALE' | null;

  @ApiProperty({ enum: ['STEP2', 'OWNER'], nullable: true })
  genderSource!: 'STEP2' | 'OWNER' | null;

  @ApiProperty({ description: '② 판단이 오너 입력 성별과 다를 때 true' })
  genderRecheckRequired!: boolean;

  @nullableString(undefined, 20)
  leafCategoryId!: string | null;

  @nullableString(undefined, 500)
  wholeCategoryName!: string | null;

  @nullableDateTime("'비교 없이 확정' 체크 시각")
  noComparisonConfirmedAt!: string | null;

  @ApiProperty({
    description: '등록 진행 잠금(REGISTERING·RESULT_CHECK_REQUIRED·REGISTERED면 true)',
  })
  locked!: boolean;

  @nullableDateTime('현재 ② 버전 rakuten_item.collected_at')
  pageDataCollectedAt!: string | null;

  @ApiProperty({
    description: '페이지 데이터 오래됨(collectedAt + 설정 시간 지남). 재실행 필요로 바꾸지 않는다',
  })
  pageDataStale!: boolean;

  @ApiProperty({ type: [CandidateGateValidityDto], description: 'G2·G3 유효성' })
  gates!: CandidateGateValidityDto[];

  @nullableDateTime('G4 승인 시각(최신 registration.approved_at, 읽기만)')
  approvedAt!: string | null;

  @ApiProperty({
    type: ContinuousRunSummaryDto,
    nullable: true,
    description: '열린 연속 실행. 없으면 null',
  })
  openContinuousRun!: ContinuousRunSummaryDto | null;

  @ApiProperty({
    enum: STEP_FLOW,
    nullable: true,
    description: '이어 할 단계(목록과 같은 계산). 없으면 null',
  })
  resumeStepCode!: StepCode | null;

  @dateTime()
  createdAt!: string;

  @dateTime()
  updatedAt!: string;
}

/** 05-2 CandidateStatusHistoryItem */
export class CandidateStatusHistoryItemDto {
  @ApiProperty({ type: 'integer' })
  id!: number;

  @ApiProperty({ type: 'integer' })
  candidateId!: number;

  @ApiProperty({ enum: CANDIDATE_STATUSES, nullable: true, description: '생성 기록이면 null' })
  fromStatus!: CandidateStatus | null;

  @ApiProperty({ enum: CANDIDATE_STATUSES })
  toStatus!: CandidateStatus;

  @ApiProperty({ enum: STATUS_REASONS })
  reason!: CandidateStatusReason;

  @ApiProperty({ type: 'integer', nullable: true })
  stepRunId!: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  gatePassId!: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  registrationId!: number | null;

  @dateTime()
  changedAt!: string;
}

/** 05-2 CandidateStatusHistoryPage */
export class CandidateStatusHistoryPageDto {
  @ApiProperty({ type: [CandidateStatusHistoryItemDto] })
  content!: CandidateStatusHistoryItemDto[];

  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;
}

/** 05-2 CandidateStatusChangeResult(제외·다시 작업) */
export class CandidateStatusChangeResultDto {
  @ApiProperty({ type: 'integer' })
  candidateId!: number;

  @ApiProperty({ enum: CANDIDATE_STATUSES })
  status!: CandidateStatus;

  @ApiProperty({ enum: EXCLUDED_REASONS, nullable: true })
  excludedReason!: CandidateExcludedReason | null;

  @dateTime()
  statusChangedAt!: string;

  @ApiProperty({ type: CandidateStatusHistoryItemDto, description: '이 상태가 된 전이 기록' })
  history!: CandidateStatusHistoryItemDto;

  @ApiProperty({ type: [CandidateWarningDto], description: '다시 작업의 ANCHOR_KEY_DUPLICATE 등' })
  warnings!: CandidateWarningDto[];
}

/** 05-2 CandidateGenderResult */
export class CandidateGenderResultDto {
  @ApiProperty({ type: 'integer' })
  candidateId!: number;

  @ApiProperty({ enum: ['MALE', 'FEMALE'] })
  gender!: 'MALE' | 'FEMALE';

  @ApiProperty({ enum: ['OWNER'] })
  genderSource!: 'OWNER';

  @ApiProperty()
  genderRecheckRequired!: boolean;

  @ApiProperty({ description: '값이 바뀌었는가(같은 값이면 false, 전파 없음)' })
  changed!: boolean;

  @ApiProperty({
    enum: STEP_FLOW,
    isArray: true,
    description: '재실행 필요가 된 단계(PRICING·NOTICE_HTML·TAGS 중)',
  })
  affectedSteps!: StepCode[];

  @ApiProperty({ type: [Number], description: '성별을 넘겨 이어 간 열린 ②·④ 실행' })
  resumedStepRunIds!: number[];
}

/** 05-2 CandidateStepAttentionItem */
export class CandidateStepAttentionItemDto {
  @ApiProperty({ type: 'integer', description: 'candidate_step.id' })
  id!: number;

  @ApiProperty({ type: 'integer' })
  candidateId!: number;

  @ApiProperty({ enum: CANDIDATE_STATUSES })
  candidateStatus!: CandidateStatus;

  @ApiProperty({ enum: STEP_FLOW })
  stepCode!: StepCode;

  @ApiProperty({ enum: STEP_STATUSES })
  status!: StepStatus;

  @ApiProperty({ type: 'integer', nullable: true })
  currentStepRunId!: number | null;

  @ApiProperty({ type: [String] })
  staleInputs!: string[];

  @nullableDateTime()
  staleSince!: string | null;

  @dateTime()
  updatedAt!: string;

  @ApiProperty({ enum: FAILURE_KINDS, nullable: true })
  failureKind!: StepFailureKind | null;

  @nullableString()
  errorMessage!: string | null;

  @nullableDateTime()
  waitingSince!: string | null;
}

/** 05-2 CandidateStepAttentionPage */
export class CandidateStepAttentionPageDto {
  @ApiProperty({ type: [CandidateStepAttentionItemDto] })
  content!: CandidateStepAttentionItemDto[];

  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;
}
