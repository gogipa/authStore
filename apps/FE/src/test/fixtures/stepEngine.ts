import type { components } from '@/shared/api/schema';

type CandidateSummary = components['schemas']['CandidateSummary'];
type CandidateDetail = components['schemas']['CandidateDetail'];
type CandidateStepBrief = components['schemas']['CandidateStepBrief'];
type StepCode = components['schemas']['StepCode'];
type StepStatus = components['schemas']['StepStatus'];
type CandidateStatus = components['schemas']['CandidateStatus'];
type AttentionItem = components['schemas']['CandidateStepAttentionItem'];
type ResumeTarget = components['schemas']['CandidateResumeTarget'];

const STEP_CODES: StepCode[] = [
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
];

const AT = '2026-09-28T05:02:00.000Z';

/** 단계 10개(주지 않은 단계는 NOT_RUN) */
export function stepBriefs(
  statuses: Partial<Record<StepCode, StepStatus>> = {},
): CandidateStepBrief[] {
  return STEP_CODES.map((stepCode) => ({ stepCode, status: statuses[stepCode] ?? 'NOT_RUN' }));
}

/** 필수 9단계 완료(⑨ 미실행) */
export function requiredDone(extra: Partial<Record<StepCode, StepStatus>> = {}) {
  const map: Partial<Record<StepCode, StepStatus>> = {};
  for (const code of STEP_CODES) if (code !== 'REGISTER') map[code] = 'COMPLETED';
  return stepBriefs({ ...map, ...extra });
}

/** 목록 한 줄(05-2 CandidateSummary). 예시 값은 화면시안_명세 §4 */
export function candidateSummary(
  patch: Partial<CandidateSummary> & { id: number },
): CandidateSummary {
  const steps = patch.steps ?? stepBriefs();
  return {
    creationPath: 'SEARCH_QUERY',
    status: 'WORKING',
    statusChangedAt: AT,
    excludedReason: null,
    displayName: null,
    rakutenQuery: 'アシックス ゲルカヤノ14',
    anchorModelCode: null,
    itemCode: null,
    selectedColor: null,
    gender: null,
    resumeStepCode: 'SOURCING',
    createdAt: AT,
    updatedAt: AT,
    ...patch,
    steps,
  };
}

/** 후보 상세(05-2 CandidateDetail) */
export function candidateDetail(patch: Partial<CandidateDetail> & { id: number }): CandidateDetail {
  return {
    creationPath: 'SEARCH_QUERY',
    status: 'WORKING' as CandidateStatus,
    statusChangedAt: AT,
    excludedReason: null,
    displayName: '뉴발란스 530 · 화이트/실버',
    sourceKeywordId: 3,
    sourceKeyword: '뉴발란스 530',
    rakutenQuery: 'ニューバランス 530',
    sourceUrl: null,
    anchorModelCode: 'MR530SG',
    anchorItemCode: null,
    anchorColorCode: 'SG',
    anchorFixedAt: AT,
    itemCode: 'shop-b:20000456',
    selectedColor: '화이트/실버',
    gender: 'MALE',
    genderSource: 'STEP2',
    genderRecheckRequired: false,
    leafCategoryId: null,
    wholeCategoryName: null,
    noComparisonConfirmedAt: null,
    locked: false,
    pageDataCollectedAt: null,
    pageDataStale: false,
    gates: [
      { gate: 'G2', gatePassId: null, passedAt: null, valid: false },
      { gate: 'G3', gatePassId: null, passedAt: null, valid: false },
    ],
    approvedAt: null,
    openContinuousRun: null,
    resumeStepCode: 'PRICING',
    createdAt: AT,
    updatedAt: AT,
    ...patch,
  };
}

export function page<T>(content: T[], totalElements = content.length) {
  return {
    content,
    page: { number: 0, size: 20, totalElements, totalPages: totalElements === 0 ? 0 : 1 },
  };
}

/** 상태별 후보 수(상태 8개) */
export function statusCounts(counts: Partial<Record<CandidateStatus, number>> = {}) {
  const statuses: CandidateStatus[] = [
    'TEMP',
    'WORKING',
    'EXCLUDED',
    'AWAITING_APPROVAL',
    'VALIDATED',
    'REGISTERING',
    'RESULT_CHECK_REQUIRED',
    'REGISTERED',
  ];
  return { items: statuses.map((status) => ({ status, count: counts[status] ?? 0 })) };
}

export function attentionItem(
  patch: Partial<AttentionItem> & { id: number; candidateId: number },
): AttentionItem {
  return {
    candidateStatus: 'WORKING',
    stepCode: 'THUMBNAIL',
    status: 'RERUN_REQUIRED',
    currentStepRunId: 40,
    staleInputs: [],
    staleSince: AT,
    updatedAt: AT,
    failureKind: null,
    errorMessage: null,
    waitingSince: null,
    ...patch,
  };
}

export function resumeTarget(patch: Partial<ResumeTarget> & { candidateId: number }): ResumeTarget {
  return { candidateStatus: 'WORKING', stepCode: null, stepStatus: null, gate: null, ...patch };
}

// ── 단계 실행(P1-05) ────────────────────────────────────────────────────────
type RailItem = components['schemas']['CandidateStepRailItem'];
type StepRunSummary = components['schemas']['StepRunSummary'];
type StepRunVersionItem = components['schemas']['StepRunVersionItem'];
type StepActionState = components['schemas']['StepActionState'];

export const ENABLED: StepActionState = { enabled: true, disabledReason: null };

export function disabled(code: string, message: string): StepActionState {
  return { enabled: false, disabledReason: { code, message } };
}

/** 단계 실행 한 번(05-2 StepRunSummary) */
export function stepRunSummary(
  patch: Partial<StepRunSummary> & { id: number; stepCode: StepCode },
): StepRunSummary {
  return {
    candidateId: 13,
    version: 1,
    executionMode: 'STEP',
    ownerAction: null,
    baseStepRunId: null,
    stepChainId: null,
    settingsSnapshotId: 1,
    aiEngine: null,
    aiModel: null,
    aiCliVersion: null,
    status: 'COMPLETED',
    failureKind: null,
    errorCode: null,
    errorMessage: null,
    rerunReasonInputs: [],
    waitingSince: null,
    waitSecondsTotal: 0,
    startedAt: '2026-09-28T04:38:00.000Z',
    endedAt: '2026-09-28T04:40:00.000Z',
    ...patch,
  };
}

/** 레일 한 칸(05-2 CandidateStepRailItem). 상태가 미실행이 아니면 현재 실행 v1을 붙인다 */
export function railItem(
  patch: Partial<RailItem> & { stepCode: StepCode },
  runPatch: Partial<StepRunSummary> = {},
): RailItem {
  const status = patch.status ?? 'NOT_RUN';
  const index = STEP_CODES.indexOf(patch.stepCode);
  const runId = 100 + index;
  const currentRun =
    status === 'NOT_RUN'
      ? null
      : stepRunSummary({
          id: runId,
          stepCode: patch.stepCode,
          status: status === 'RERUN_REQUIRED' ? 'COMPLETED' : status,
          endedAt:
            status === 'RUNNING' || status === 'WAITING_INPUT' ? null : '2026-09-28T04:40:00.000Z',
          waitingSince: status === 'WAITING_INPUT' ? '2026-09-28T04:40:00.000Z' : null,
          ...runPatch,
        });
  return {
    id: index + 1,
    status,
    currentStepRunId: currentRun?.id ?? null,
    lastVersion: currentRun ? 1 : 0,
    staleInputs: [],
    staleSince: status === 'RERUN_REQUIRED' ? AT : null,
    updatedAt: AT,
    currentRun,
    inputs: [],
    actions: {
      run: ENABLED,
      continuousRun: ENABLED,
      edit: disabled('INVALID_STEP_CODE', '이 단계는 값을 직접 고칠 수 없습니다.'),
    },
    warnings: [],
    ...patch,
  };
}

/** 단계 레일 10칸(주지 않은 단계는 미실행·실행 가능) */
export function stepRail(items: Partial<Record<StepCode, Partial<RailItem>>> = {}) {
  return {
    items: STEP_CODES.map((stepCode) => railItem({ stepCode, ...(items[stepCode] ?? {}) })),
  };
}

/** 버전 이력 한 줄 */
export function versionItem(
  patch: Partial<StepRunVersionItem> & { id: number; version: number; stepCode: StepCode },
): StepRunVersionItem {
  return { ...stepRunSummary(patch), isCurrent: false, ...patch };
}
