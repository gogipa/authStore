/**
 * SSE 진행 알림(05-1 §3) M1 이벤트 22개의 이름과 data 타입.
 * 05-2 components.schemas.ProgressEventFrame oneOf(M1)와 각 *Event 스키마를 그대로 옮겼다.
 * 이벤트는 '무엇이 바뀌었는지'만 알린다. 비밀정보·로컬 경로를 넣지 않는다.
 */

// ── 공통 코드(05-2 components.schemas) ──────────────────────────────────────

/** 05-2 StepCode */
export type StepCode =
  | 'SOURCING'
  | 'PRICING'
  | 'CATEGORY'
  | 'THUMBNAIL'
  | 'COPY'
  | 'NOTICE_RAW'
  | 'NOTICE_HTML'
  | 'TAGS'
  | 'UPLOAD'
  | 'REGISTER';

/** 05-2 StepStatus */
export type StepStatus =
  'NOT_RUN' | 'RUNNING' | 'WAITING_INPUT' | 'COMPLETED' | 'FAILED' | 'RERUN_REQUIRED';

/** 05-2 StepRunStatus */
export type StepRunStatus = Exclude<StepStatus, 'NOT_RUN'>;

/** 05-2 StepExecutionMode */
export type StepExecutionMode = 'STEP' | 'CHAIN' | 'BATCH' | 'CLI' | 'OWNER_EDIT';

/** 05-2 StepFailureKind */
export type StepFailureKind = 'EXTERNAL_API' | 'AI' | 'INPUT_VALIDATION' | 'INTERRUPTED';

/** 05-2 CandidateStatus */
export type CandidateStatus =
  | 'TEMP'
  | 'WORKING'
  | 'EXCLUDED'
  | 'AWAITING_APPROVAL'
  | 'VALIDATED'
  | 'REGISTERING'
  | 'RESULT_CHECK_REQUIRED'
  | 'REGISTERED';

/** 05-2 CandidateStatusReason */
export type CandidateStatusReason =
  | 'CREATED'
  | 'TEMP_LINKED'
  | 'ANCHOR_NO_MATCH'
  | 'INSUFFICIENT_STOCK'
  | 'NOT_SALE_CANDIDATE'
  | 'OWNER_EXCLUDED'
  | 'REOPENED'
  | 'READY_FOR_APPROVAL'
  | 'STEP_NOT_CURRENT'
  | 'GATE_FINGERPRINT_CHANGED'
  | 'REFETCH_G2_UNCHANGED'
  | 'G4_APPROVED_BLOCKED'
  | 'BLOCK_SWITCH_OFF'
  | 'G4_APPROVED'
  | 'REGISTER_SUCCEEDED'
  | 'REGISTER_4XX'
  | 'REGISTER_UNKNOWN'
  | 'APP_RESTART'
  | 'RESTART_REVERTED'
  | 'SELLER_CODE_FOUND'
  | 'SELLER_CODE_NOT_FOUND';

/** 05-2 CandidateExcludedReason */
export type CandidateExcludedReason =
  'ANCHOR_NO_MATCH' | 'INSUFFICIENT_STOCK' | 'NOT_SALE_CANDIDATE' | 'OWNER_EXCLUDED';

/** 05-2 StepChainKind */
export type StepChainKind = 'FROM_HERE' | 'RERUN_STALE';

/** 05-2 StepChainStopReason */
export type StepChainStopReason =
  'AWAIT_G2' | 'AWAIT_G3' | 'AWAIT_G4' | 'NO_RUNNABLE_STEP' | 'APP_RESTART';

/** 05-2 CallLogTarget(ERD ck_call_log_target) */
export type CallLogTargetCode =
  | 'COMMERCE_API'
  | 'RAKUTEN_API'
  | 'RAKUTEN_PAGE'
  | 'DATALAB'
  | 'FX_KOREAEXIM'
  | 'FX_CUSTOMS'
  | 'NOTICE_MONITOR'
  | 'UPDATE_CHECK'
  | 'AI_CLAUDE_CLI'
  | 'AI_AGY_CLI'
  | 'AI_CODEX_CLI'
  | 'AI_GEMINI_API'
  | 'AI_OPENAI_API';

/** 05-2 AiEngineCode */
export type AiEngineCodeValue = 'CLAUDE' | 'AGY' | 'CODEX';

// ── 이벤트 data(05-2 *Event 스키마) ─────────────────────────────────────────

/** step-run.status-changed */
export interface StepRunStatusChangedEvent {
  stepRunId: number;
  candidateId: number;
  stepCode: StepCode;
  version: number;
  executionMode: StepExecutionMode;
  stepChainId: number | null;
  status: StepRunStatus;
  waitingReasonCode?: string | null;
  pendingInputs?: string[];
  rerunReasonInputs?: string[];
  failureKind?: StepFailureKind | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** 외부 쉼(24시간)이 끝나는 시각 */
  blockedUntil?: string | null;
  occurredAt: string;
}

/** candidate-step.changed */
export interface CandidateStepChangedEvent {
  candidateId: number;
  stepCode: StepCode;
  status: StepStatus;
  currentStepRunId: number | null;
  staleInputs: string[];
  staleSince: string | null;
}

/** candidate.status-changed */
export interface CandidateStatusChangedEvent {
  candidateId: number;
  fromStatus: CandidateStatus | null;
  toStatus: CandidateStatus;
  reason: CandidateStatusReason;
  excludedReason: CandidateExcludedReason | null;
  changedAt: string;
}

/** gate.passed */
export interface GatePassedEvent {
  candidateId: number;
  gate: 'G2' | 'G3';
  gatePassId: number;
  passedAt: string;
}

/** gate.invalidated */
export interface GateInvalidatedEvent {
  candidateId: number;
  gate: 'G2' | 'G3';
  previousGatePassId: number;
  changedBasisKeys: string[];
}

/** continuous-run.stopped */
export interface ContinuousRunStoppedEvent {
  stepChainId: number;
  candidateId: number;
  kind: StepChainKind;
  stopReason: StepChainStopReason;
  stopStepCode: StepCode | null;
  endedAt: string;
}

/** keyword-collection.progress */
export interface KeywordCollectionProgressEvent {
  keywordSnapshotId: number;
  cid: string;
  page: number;
  pagesPerCid: number;
  requestsDone: number;
  requestsTotal: number;
}

/** keyword-collection.completed */
export interface KeywordCollectionCompletedEvent {
  keywordSnapshotId: number;
  keywordCount: number;
  excludedCount: number;
  rangeMatched: boolean | null;
}

/** keyword-collection.aborted */
export interface KeywordCollectionAbortedEvent {
  keywordSnapshotId: number;
  abortReason:
    | 'NO_RANKS_KEY'
    | 'HTTP_404'
    | 'NOT_JSON'
    | 'RETURN_CODE'
    | 'COUNT_MISMATCH'
    | 'HTTP_403'
    | 'HTTP_418'
    | 'HTTP_429'
    // P2-01 Proposed(이상 응답이 아닌 중단, 구조 변경 의심 아님)
    | 'NETWORK_ERROR'
    | 'APP_RESTART'
    | 'INTERRUPTED';
  httpStatus: number | null;
  structureChangeSuspected: boolean;
  blockedUntil: string | null;
}

/** sourcing.search-completed */
export interface SourcingSearchCompletedEvent {
  candidateId: number;
  sourcingComparisonId: number;
  stepRunId: number;
  rowCount: number;
  exploreMode: boolean;
}

/** sourcing.row-updated — data에 후보 id가 없다. 후보별로 거르려면 publish의 candidateId를 준다 */
export interface SourcingRowUpdatedEvent {
  sourcingComparisonId: number;
  rowId: number;
  isVerified: boolean;
  stockPass: boolean | null;
  inStockSizeCount: number | null;
  effectivePriceYen: number | null;
  manualCheckRequired: boolean;
}

/** sourcing.page-fetch-finished — data에 후보 id가 없다(sourcing.row-updated와 같음) */
export interface SourcingPageFetchFinishedEvent {
  sourcingComparisonId: number;
  fetchedCount: number;
  passedCount: number;
  stopReason: 'ENOUGH_CANDIDATES' | 'PAGE_CAP' | 'DAILY_LIMIT' | 'BLOCKED';
}

/** call-usage.changed(05-2 CallUsageChangedEvent) */
export interface CallUsageChangedEvent {
  target: CallLogTargetCode;
  kstDate: string;
  count: number;
  dailyLimit: number | null;
  remaining: number | null;
  limitReached: boolean;
  blockedUntil: string | null;
  httpStatus: number | null;
}

/** generation-run.updated */
export interface GenerationRunUpdatedEvent {
  candidateId: number;
  stepRunId: number;
  generationRunId: number;
  slotNo: number;
  attemptNo: number;
  triggerType: 'INITIAL' | 'OWNER_RETRY' | 'AUTO_RETRY';
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'REFUSED';
  refusalReason?: string | null;
  errorMessage?: string | null;
  resultImageAssetId?: number | null;
}

/** content-field.recheck-flagged */
export interface ContentFieldRecheckFlaggedEvent {
  candidateId: number;
  stepCode: 'NOTICE_RAW' | 'NOTICE_HTML';
  stepRunId: number;
  fieldKeys: string[];
  recheckReason: 'ITEM_CODE_CHANGED' | 'SALE_SIZES_CHANGED' | 'NOTICE_RAW_CHANGED';
}

/** registration.status-changed */
export interface RegistrationStatusChangedEvent {
  registrationId: number;
  candidateId: number;
  stepRunId: number;
  status: 'VALIDATED' | 'REGISTERING' | 'RESULT_CHECK_REQUIRED' | 'REGISTERED';
  originProductNo: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  traceId: string | null;
  failureKind: 'INVALID_INPUT_4XX' | 'NOT_FOUND_ON_CHECK' | null;
  candidateStatus: CandidateStatus;
}

/** registration-switch.changed */
export interface RegistrationSwitchChangedEvent {
  apiBlocked: boolean;
  changedAt: string;
  revertedCandidateIds: number[];
}

/** commerce-meta-sync.completed */
export interface CommerceMetaSyncCompletedEvent {
  runId: number;
  target:
    | 'CATEGORY'
    | 'CATEGORY_DETAIL'
    | 'STANDARD_OPTIONS'
    | 'PRODUCT_ATTRIBUTES'
    | 'ORIGIN_AREA'
    | 'ADDRESSBOOK'
    | 'PROVIDED_NOTICE'
    | 'RETURN_DELIVERY_COMPANY';
  status: 'SUCCEEDED' | 'FAILED';
  finishedAt: string;
  itemCount: number | null;
  errorMessage: string | null;
}

/** settings.reloaded */
export interface SettingsReloadedEvent {
  settingsSnapshotId: number | null;
  changedKeys: string[];
  valid: boolean;
  errors: string[];
  rerunRequiredStepCount: number;
}

/** fx-rate.updated */
export interface FxRateUpdatedEvent {
  rateKind: 'COST' | 'CUSTOMS';
  currency: 'JPY' | 'USD';
  fxRateId: number | null;
  warningCode: 'FX_FETCH_FAILED' | 'FX_DIVERGENCE' | null;
}

/** auth.failed */
export interface AuthFailedEvent {
  target: 'COMMERCE_API';
  errorCode: string;
  causeCategory:
    'DORMANT_AUTH' | 'SECRET_CHANGED' | 'STORE_SUSPENDED' | 'IP_NOT_ALLOWED' | 'UNKNOWN';
  occurredAt: string;
}

/** ai-cli-check.completed */
export interface AiCliCheckCompletedEvent {
  engineCode: AiEngineCodeValue;
  installed: boolean;
  cliVersion: string | null;
  authStatus: 'OK' | 'NOT_LOGGED_IN' | 'UNKNOWN';
  smokeStatus: 'PASSED' | 'FAILED' | 'SKIPPED';
  latencyMs: number | null;
  errorCode: string | null;
}

// ── 이름 ↔ data ──────────────────────────────────────────────────────────────

/** 이벤트 이름별 data 타입(05-2 ProgressEventFrame oneOf의 M1 항목, 순서도 같다) */
export interface ProgressEventDataMap {
  'step-run.status-changed': StepRunStatusChangedEvent;
  'candidate-step.changed': CandidateStepChangedEvent;
  'candidate.status-changed': CandidateStatusChangedEvent;
  'gate.passed': GatePassedEvent;
  'gate.invalidated': GateInvalidatedEvent;
  'continuous-run.stopped': ContinuousRunStoppedEvent;
  'keyword-collection.progress': KeywordCollectionProgressEvent;
  'keyword-collection.completed': KeywordCollectionCompletedEvent;
  'keyword-collection.aborted': KeywordCollectionAbortedEvent;
  'sourcing.search-completed': SourcingSearchCompletedEvent;
  'sourcing.row-updated': SourcingRowUpdatedEvent;
  'sourcing.page-fetch-finished': SourcingPageFetchFinishedEvent;
  'call-usage.changed': CallUsageChangedEvent;
  'generation-run.updated': GenerationRunUpdatedEvent;
  'content-field.recheck-flagged': ContentFieldRecheckFlaggedEvent;
  'registration.status-changed': RegistrationStatusChangedEvent;
  'registration-switch.changed': RegistrationSwitchChangedEvent;
  'commerce-meta-sync.completed': CommerceMetaSyncCompletedEvent;
  'settings.reloaded': SettingsReloadedEvent;
  'fx-rate.updated': FxRateUpdatedEvent;
  'auth.failed': AuthFailedEvent;
  'ai-cli-check.completed': AiCliCheckCompletedEvent;
}

/** M1 이벤트 이름(05-1 §3) */
export type ProgressEventName = keyof ProgressEventDataMap;

/** M1 이벤트 이름 목록(22개, 05-2 oneOf 순서) */
export const PROGRESS_EVENT_NAMES = [
  'step-run.status-changed',
  'candidate-step.changed',
  'candidate.status-changed',
  'gate.passed',
  'gate.invalidated',
  'continuous-run.stopped',
  'keyword-collection.progress',
  'keyword-collection.completed',
  'keyword-collection.aborted',
  'sourcing.search-completed',
  'sourcing.row-updated',
  'sourcing.page-fetch-finished',
  'call-usage.changed',
  'generation-run.updated',
  'content-field.recheck-flagged',
  'registration.status-changed',
  'registration-switch.changed',
  'commerce-meta-sync.completed',
  'settings.reloaded',
  'fx-rate.updated',
  'auth.failed',
  'ai-cli-check.completed',
] as const satisfies readonly ProgressEventName[];

/** SSE 프레임 한 개의 논리 구조(05-2 ProgressEventFrame). id는 숫자 문자열 */
export type ProgressEventFrame = {
  [N in ProgressEventName]: { id: string; event: N; data: ProgressEventDataMap[N] };
}[ProgressEventName];
