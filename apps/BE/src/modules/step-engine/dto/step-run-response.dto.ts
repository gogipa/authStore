import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageMetaDto } from '../../../common/paging/page-query.dto.js';
import { STEP_FLOW, STEP_STATUSES, type StepCode, type StepStatus } from '../domain/steps.js';
import { CandidateWarningDto } from './candidate-response.dto.js';

/**
 * 단계 실행 응답(05-2 components.schemas 필드 그대로, P1-05). 시각은 ISO 8601 문자열.
 * 구현 명세(@nestjs/swagger)는 OpenAPI 3.0이라 null 허용은 nullable로 적었다(06-2 §9-5).
 */

const RUN_STATUSES = ['RUNNING', 'WAITING_INPUT', 'COMPLETED', 'FAILED', 'RERUN_REQUIRED'];
const EXECUTION_MODES = ['STEP', 'CHAIN', 'BATCH', 'CLI', 'OWNER_EDIT'];
const OWNER_ACTIONS = ['EDIT', 'KEEP_AS_IS', 'RESTORE_VERSION'];
const FAILURE_KINDS = ['EXTERNAL_API', 'AI', 'INPUT_VALIDATION', 'INTERRUPTED'];
const SOURCE_TYPES = ['PREV_STEP', 'OWNER_INPUT', 'SETTINGS'];
const AI_ENGINES = ['CLAUDE', 'AGY', 'CODEX'];

export type StepRunStatusValue = Exclude<StepStatus, 'NOT_RUN'>;
export type StepExecutionModeValue = 'STEP' | 'CHAIN' | 'BATCH' | 'CLI' | 'OWNER_EDIT';
export type StepOwnerActionValue = 'EDIT' | 'KEEP_AS_IS' | 'RESTORE_VERSION';
export type StepFailureKindValue = 'EXTERNAL_API' | 'AI' | 'INPUT_VALIDATION' | 'INTERRUPTED';
export type StepInputSourceTypeValue = 'PREV_STEP' | 'OWNER_INPUT' | 'SETTINGS';
export type AiEngineValue = 'CLAUDE' | 'AGY' | 'CODEX';

const nullableInt = (description?: string) =>
  ApiProperty({ type: 'integer', nullable: true, description });
const nullableString = (description?: string, maxLength?: number) =>
  ApiProperty({ type: 'string', nullable: true, description, maxLength });
const nullableDateTime = (description?: string) =>
  ApiProperty({ type: 'string', format: 'date-time', nullable: true, description });

/** 05-2 StepRunInputItem */
export class StepRunInputItemDto {
  @ApiProperty({
    maxLength: 64,
    description: '입력 이름(예 candidate.gender, owner.domesticPrice)',
  })
  inputKey!: string;

  @ApiProperty({ enum: SOURCE_TYPES })
  sourceType!: StepInputSourceTypeValue;

  @nullableInt('PREV_STEP일 때 읽은 앞 단계 버전')
  sourceStepRunId!: number | null;

  @ApiProperty({ description: 'true=시작 조건(지문 포함), false=실행 중 오너 입력' })
  isStartCondition!: boolean;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  valueHash!: string;
}

/** 05-2 StepRunSummary */
export class StepRunSummaryDto {
  @ApiProperty({ type: 'integer', description: 'stepRunId' })
  id!: number;

  @ApiProperty({ type: 'integer' })
  candidateId!: number;

  @ApiProperty({ enum: STEP_FLOW })
  stepCode!: StepCode;

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number;

  @ApiProperty({ enum: EXECUTION_MODES })
  executionMode!: StepExecutionModeValue;

  @ApiProperty({ enum: OWNER_ACTIONS, nullable: true })
  ownerAction!: StepOwnerActionValue | null;

  @nullableInt('바탕 버전(오너 수정·그대로 유지·다시 고른 버전)')
  baseStepRunId!: number | null;

  @nullableInt('연속 실행 묶음(CHAIN일 때)')
  stepChainId!: number | null;

  @ApiProperty({ type: 'integer' })
  settingsSnapshotId!: number;

  @ApiProperty({ enum: AI_ENGINES, nullable: true, description: '실행 시작 때 고정한 AI 엔진' })
  aiEngine!: AiEngineValue | null;

  @nullableString('실행 시작 때 쓴 모델', 100)
  aiModel!: string | null;

  @nullableString('실행 시작 때 CLI 버전', 40)
  aiCliVersion!: string | null;

  @ApiProperty({ enum: RUN_STATUSES })
  status!: StepRunStatusValue;

  @ApiProperty({ enum: FAILURE_KINDS, nullable: true })
  failureKind!: StepFailureKindValue | null;

  @nullableString(undefined, 100)
  errorCode!: string | null;

  @nullableString('한국어 안내 문구(비밀정보 없음)')
  errorMessage!: string | null;

  @ApiProperty({
    type: [String],
    description: '끝날 때 지문이 달라 RERUN_REQUIRED가 된 경우 바뀐 입력 이름',
  })
  rerunReasonInputs!: string[];

  @nullableDateTime('현재 입력 대기 시작 시각')
  waitingSince!: string | null;

  @ApiProperty({ type: 'integer', minimum: 0, description: '입력 대기 누적 초' })
  waitSecondsTotal!: number;

  @ApiProperty({ type: 'string', format: 'date-time' })
  startedAt!: string;

  @nullableDateTime()
  endedAt!: string | null;
}

/** 05-2 StepRunVersionItem */
export class StepRunVersionItemDto extends StepRunSummaryDto {
  @ApiProperty({ description: 'candidate_step.current_step_run_id와 같은가' })
  isCurrent!: boolean;
}

/** 05-2 StepRunVersionPage */
export class StepRunVersionPageDto {
  @ApiProperty({ type: [StepRunVersionItemDto] })
  content!: StepRunVersionItemDto[];

  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;
}

/** 05-2 StepRunDetail */
export class StepRunDetailDto extends StepRunSummaryDto {
  @ApiProperty()
  isCurrent!: boolean;

  @ApiProperty({ type: [StepRunInputItemDto] })
  inputs!: StepRunInputItemDto[];
}

/** 05-2 CandidateBlockReason */
export class CandidateBlockReasonDto {
  @ApiProperty({ pattern: '^[A-Z][A-Z0-9_]*$', description: '같은 동작 API의 409·422 코드' })
  code!: string;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  details?: Record<string, unknown>;
}

/** 05-2 StepActionState */
export class StepActionStateDto {
  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ type: CandidateBlockReasonDto, nullable: true })
  disabledReason!: CandidateBlockReasonDto | null;
}

/** 05-2 CandidateStepActions */
export class CandidateStepActionsDto {
  @ApiProperty({ type: StepActionStateDto })
  run!: StepActionStateDto;

  @ApiProperty({ type: StepActionStateDto })
  continuousRun!: StepActionStateDto;

  @ApiProperty({ type: StepActionStateDto })
  edit!: StepActionStateDto;
}

/** 05-2 CandidateStepRailItem */
export class CandidateStepRailItemDto {
  @ApiProperty({ type: 'integer', description: 'candidate_step.id' })
  id!: number;

  @ApiProperty({ enum: STEP_FLOW })
  stepCode!: StepCode;

  @ApiProperty({ enum: STEP_STATUSES })
  status!: StepStatus;

  @nullableInt('현재 버전. NOT_RUN이면 null')
  currentStepRunId!: number | null;

  @ApiProperty({ type: 'integer', minimum: 0 })
  lastVersion!: number;

  @ApiProperty({ type: [String], description: '재실행 필요 사유 = 바뀐 입력 이름' })
  staleInputs!: string[];

  @nullableDateTime()
  staleSince!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: StepRunSummaryDto, nullable: true, description: '현재 버전 실행' })
  currentRun!: StepRunSummaryDto | null;

  @ApiProperty({ type: [StepRunInputItemDto], description: '현재 버전의 입력 출처' })
  inputs!: StepRunInputItemDto[];

  @ApiProperty({ type: CandidateStepActionsDto })
  actions!: CandidateStepActionsDto;

  @ApiProperty({
    type: [CandidateWarningDto],
    description: 'G2 전 AI 비용 경고(PRE_G2_AI_COST) 등',
  })
  warnings!: CandidateWarningDto[];
}

/** 05-2 CandidateStepRail */
export class CandidateStepRailDto {
  @ApiProperty({ type: [CandidateStepRailItemDto], minItems: 10, maxItems: 10 })
  items!: CandidateStepRailItemDto[];
}

/** 05-2 StepRunAccepted */
export class StepRunAcceptedDto {
  @ApiProperty({ type: 'integer', description: '곧바로 만든 실행' })
  stepRunId!: number;

  @ApiProperty({ type: [Number], description: '이번 요청으로 만든 실행 id(⑥ 묶음은 첫 실행만)' })
  stepRunIds!: number[];

  @ApiProperty({ type: 'integer' })
  candidateId!: number;

  @ApiProperty({ enum: STEP_FLOW })
  stepCode!: StepCode;

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number;

  @ApiProperty({
    enum: EXECUTION_MODES,
    description: '단계 실행은 STEP, 태그 오너 수정은 OWNER_EDIT',
  })
  executionMode!: StepExecutionModeValue;

  @ApiProperty({ enum: AI_ENGINES, nullable: true })
  aiEngine!: AiEngineValue | null;

  @nullableString(undefined, 100)
  aiModel!: string | null;

  @nullableString(undefined, 40)
  aiCliVersion!: string | null;

  @ApiProperty({ enum: ['RUNNING'] })
  status!: 'RUNNING';

  @ApiProperty({ type: [CandidateWarningDto] })
  warnings!: CandidateWarningDto[];
}

/** 05-2 StepStaleInputDiff */
export class StepStaleInputDiffDto {
  @ApiProperty({ maxLength: 64 })
  inputKey!: string;

  @ApiProperty({ enum: SOURCE_TYPES })
  sourceType!: StepInputSourceTypeValue;

  @ApiProperty()
  changed!: boolean;

  @nullableInt('쓴 앞 단계 버전(PREV_STEP)')
  usedSourceStepRunId!: number | null;

  @nullableInt('지금 앞 단계 버전(PREV_STEP)')
  currentSourceStepRunId!: number | null;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  usedValueHash!: string;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  currentValueHash!: string;
}

/** 05-2 StepStaleDiff */
export class StepStaleDiffDto {
  @ApiProperty({ type: 'integer' })
  candidateId!: number;

  @ApiProperty({ enum: STEP_FLOW })
  stepCode!: StepCode;

  @ApiProperty({ enum: STEP_STATUSES })
  status!: StepStatus;

  @ApiProperty({ type: 'integer', description: '재실행 필요가 된 현재 버전' })
  stepRunId!: number;

  @ApiProperty({ type: [String] })
  staleInputs!: string[];

  @nullableDateTime()
  staleSince!: string | null;

  @ApiProperty({ description: 'COPY일 때만 true' })
  keepAsIsAllowed!: boolean;

  @ApiProperty({ type: [StepStaleInputDiffDto] })
  inputs!: StepStaleInputDiffDto[];
}

/** 05-2 StepOwnerEditResult */
export class StepOwnerEditResultDto {
  @ApiProperty({ type: 'integer' })
  stepRunId!: number;

  @ApiProperty({ type: 'integer' })
  candidateId!: number;

  @ApiProperty({ enum: STEP_FLOW })
  stepCode!: StepCode;

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number;

  @ApiProperty({ enum: ['OWNER_EDIT'] })
  executionMode!: 'OWNER_EDIT';

  @ApiProperty({ enum: OWNER_ACTIONS })
  ownerAction!: StepOwnerActionValue;

  @ApiProperty({ type: 'integer' })
  baseStepRunId!: number;

  @ApiProperty({ enum: RUN_STATUSES })
  status!: StepRunStatusValue;

  @ApiProperty({
    enum: STEP_FLOW,
    isArray: true,
    description: '이번 수정으로 재실행 필요가 된 뒷단계',
  })
  staleDownstreamSteps!: StepCode[];

  @ApiProperty({
    enum: STEP_FLOW,
    isArray: true,
    description:
      'RESTORE_VERSION이 전파해 재실행 필요가 된 뒷단계(그 밖 동작은 빈 배열, P1-05 Proposed)',
  })
  propagatedSteps!: StepCode[];

  @ApiProperty({ type: [CandidateWarningDto] })
  warnings!: CandidateWarningDto[];
}
