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
