import {
  candidateDetail,
  candidateSummary,
  continuousRun,
  disabled,
  ENABLED,
  gateState,
  statusCounts,
  stepBriefs,
  stepRunSummary,
  versionItem,
} from '@/test/fixtures/stepEngine';
import type { DemoWorld } from '../demoWorld';
import { DEMO_IDS, STORY } from '../sample/story';
import type { Ok, Schema } from '../sample/types';
import { fakeSha256, pageOf } from '../sample/util';
import {
  continuousBlock,
  currentRun,
  editBlock,
  gateValid,
  resumeStepCode,
  runBlock,
} from './engine';
import { STEP_LABEL, STEP_STATUS_TEXT, withSubject, type DemoHttpError } from './errors';
import { readInputs, sourceTypeOf, startKeys } from './graph';
import { STEP_FLOW, type StepCode } from './steps';
import type { CandidateRec, ChainRec, GateRec, RunRec } from './state';

type RailItem = Schema<'CandidateStepRailItem'>;
type StepRunSummary = Schema<'StepRunSummary'>;
type StepActionState = Schema<'StepActionState'>;
type StepInput = Schema<'StepRunInputItem'>;

const iso = (ms: number): string => new Date(ms).toISOString();
const isoOrNull = (ms: number | null): string | null => (ms === null ? null : iso(ms));

// ── 단계마다 실행이 읽은 입력(step_run_input — 입력 출처 칸) ─────────────────────

function input(
  w: DemoWorld,
  inputKey: string,
  sourceType: StepInput['sourceType'],
  options: { from?: StepCode; start?: boolean } = {},
): StepInput {
  return {
    inputKey,
    sourceType,
    sourceStepRunId: options.from ? (currentRun(w, options.from)?.id ?? null) : null,
    isStartCondition: options.start ?? false,
    valueHash: fakeSha256(inputKey),
  };
}

/** 단계마다 읽은 입력(체험 예시). 읽는 앞 단계 실행 id는 그때의 현재 실행이다 */
function stepInputs(w: DemoWorld, code: StepCode): StepInput[] {
  const i = (
    key: string,
    type: StepInput['sourceType'],
    opts?: { from?: StepCode; start?: boolean },
  ) => input(w, key, type, opts);
  switch (code) {
    case 'SOURCING':
      return [
        i('candidate.rakutenQuery', 'OWNER_INPUT', { start: true }),
        i('candidate.seedKeyword', 'OWNER_INPUT'),
        i('settings.sourcing.targetSizeMm', 'SETTINGS'),
        i('settings.sourcing.minSizeCount', 'SETTINGS'),
      ];
    case 'PRICING':
      return [
        i('sourcing.targetSkus', 'PREV_STEP', { from: 'SOURCING', start: true }),
        i('owner.domesticPrice', 'OWNER_INPUT', { start: true }),
        i('fx.costJpy', 'SETTINGS'),
        i('fx.customsJpy', 'SETTINGS'),
        i('fx.customsUsd', 'SETTINGS'),
        i('forwarder.rateTable', 'SETTINGS'),
        i('settings.costs', 'SETTINGS'),
      ];
    case 'CATEGORY':
      return [
        i('sourcing.genre', 'PREV_STEP', { from: 'SOURCING', start: true }),
        i('candidate.gender', 'OWNER_INPUT'),
        i('settings.category.leafMapping', 'SETTINGS'),
      ];
    case 'THUMBNAIL':
      return [
        i('sourcing.images', 'PREV_STEP', { from: 'SOURCING' }),
        i('owner.referenceSelection', 'OWNER_INPUT'),
        i('settings.thumbnail.promptTemplate', 'SETTINGS', { start: true }),
        i('settings.thumbnail.faceOptionDefault', 'SETTINGS', { start: true }),
      ];
    case 'COPY':
      return [
        i('sourcing.itemText', 'PREV_STEP', { from: 'SOURCING', start: true }),
        i('sourcing.skuAttributes', 'PREV_STEP', { from: 'SOURCING', start: true }),
      ];
    case 'NOTICE_RAW':
      return [
        i('sourcing.attributes', 'PREV_STEP', { from: 'SOURCING', start: true }),
        i('sourcing.selectedColor', 'PREV_STEP', { from: 'SOURCING', start: true }),
        i('settings.content.originCountries', 'SETTINGS'),
      ];
    case 'NOTICE_HTML':
      return [
        i('copy.draft', 'PREV_STEP', { from: 'COPY', start: true }),
        i('noticeRaw.facts', 'PREV_STEP', { from: 'NOTICE_RAW', start: true }),
        i('pricing.saleSizes', 'PREV_STEP', { from: 'PRICING', start: true }),
        i('category.leafPath', 'PREV_STEP', { from: 'CATEGORY' }),
        i('profile.importer', 'SETTINGS'),
      ];
    case 'TAGS':
      return [
        i('candidate.seedKeyword', 'OWNER_INPUT'),
        i('category.leafPath', 'PREV_STEP', { from: 'CATEGORY' }),
        i('owner.competitorTags', 'OWNER_INPUT'),
      ];
    case 'UPLOAD':
      return [
        i('thumbnail.selection', 'PREV_STEP', { from: 'THUMBNAIL', start: true }),
        i('noticeHtml.html', 'PREV_STEP', { from: 'NOTICE_HTML', start: true }),
      ];
    case 'REGISTER':
      return [
        i('pricing.judgement', 'PREV_STEP', { from: 'PRICING', start: true }),
        i('upload.result', 'PREV_STEP', { from: 'UPLOAD', start: true }),
        i('tags.final', 'PREV_STEP', { from: 'TAGS', start: true }),
      ];
  }
}

// ── 실행 요약 ───────────────────────────────────────────────────────────────

/** 글을 AI로 만드는 단계(실행 기록에 AI 엔진·모델·버전을 남긴다) */
const AI_STEPS: readonly StepCode[] = ['COPY', 'NOTICE_RAW'];

export function runSummary(code: StepCode, run: RunRec): StepRunSummary {
  const ai = AI_STEPS.includes(code);
  return stepRunSummary({
    id: run.id,
    stepCode: code,
    candidateId: DEMO_IDS.candidate,
    version: run.version,
    executionMode: run.executionMode,
    stepChainId: run.stepChainId,
    settingsSnapshotId: DEMO_IDS.settingsSnapshot,
    aiEngine: ai ? 'CLAUDE' : null,
    aiModel: ai ? 'sonnet' : null,
    aiCliVersion: ai ? '2.1.269' : null,
    status: run.status,
    rerunReasonInputs: run.rerunReasonInputs ?? [],
    waitingSince: isoOrNull(run.waitingSince),
    waitSecondsTotal: run.waitSeconds,
    startedAt: iso(run.startedAt),
    endedAt: isoOrNull(run.endedAt),
  });
}

function actionOf(error: DemoHttpError | null): StepActionState {
  if (!error) return ENABLED;
  const state = disabled(error.code, error.message);
  if (error.extra.details && state.disabledReason) {
    state.disabledReason.details = error.extra.details;
  }
  return state;
}

/** 단계 레일 경고(BE `step-warnings`): G2 전 AI 비용, ④ 전 태그 */
function warningsOf(w: DemoWorld, code: StepCode): Schema<'CandidateWarning'>[] {
  const beforeG2 = {
    THUMBNAIL: '썸네일을 만들면',
    COPY: '카피를 만들면',
    NOTICE_RAW: '원산지·소재를 뽑으면',
  } as const;
  if (code in beforeG2 && !gateValid(w, 'G2')) {
    return [
      {
        code: 'PRE_G2_AI_COST',
        message: `판정(G2) 전에 ${beforeG2[code as keyof typeof beforeG2]} 팔지 않을 상품에도 AI 사용량이 듭니다. 실행은 막지 않습니다.`,
      },
    ];
  }
  if (code === 'TAGS' && w.s.steps.CATEGORY.status !== 'COMPLETED') {
    return [
      {
        code: 'CATEGORY_UNDECIDED',
        message: '④ 카테고리 전이라 카테고리 필터 없이 태그를 뽑습니다.',
      },
    ];
  }
  return [];
}

/** 재실행 필요가 된 이유(바뀐 입력 키) — 단계에 적어 둔 그대로(BE `candidate_step.stale_inputs`) */
export function staleInputsOf(w: DemoWorld, code: StepCode): string[] {
  const rec = w.s.steps[code];
  return rec.status === 'RERUN_REQUIRED' ? [...rec.staleInputs] : [];
}

export function railItem(w: DemoWorld, code: StepCode): RailItem {
  const rec = w.s.steps[code];
  const run = currentRun(w, code);
  return {
    id: STEP_FLOW.indexOf(code) + 1,
    stepCode: code,
    status: rec.status,
    currentStepRunId: run?.id ?? null,
    lastVersion: rec.runs.length,
    staleInputs: staleInputsOf(w, code),
    staleSince: rec.status === 'RERUN_REQUIRED' ? isoOrNull(rec.staleSince) : null,
    updatedAt: iso(rec.updatedAt ?? w.s.candidate?.createdAt ?? w.s.startedAt),
    currentRun: run ? runSummary(code, run) : null,
    inputs: run ? stepInputs(w, code) : [],
    actions: {
      run: actionOf(runBlock(w, code, 'run')),
      continuousRun: actionOf(continuousBlock(w, code)),
      edit: actionOf(editBlock(w, code)),
    },
    warnings: warningsOf(w, code),
  };
}

export const candidateSteps = (w: DemoWorld): Ok<'/candidates/{candidateId}/steps'> => ({
  items: STEP_FLOW.map((code) => railItem(w, code)),
});

/** 단계별 버전 이력(최신 버전이 앞). 현재 실행에 isCurrent */
export function stepRunVersions(w: DemoWorld, code: StepCode): Schema<'StepRunVersionItem'>[] {
  const current = currentRun(w, code);
  return [...w.s.steps[code].runs].reverse().map((run) =>
    versionItem({
      ...runSummary(code, run),
      id: run.id,
      version: run.version,
      stepCode: code,
      isCurrent: run.id === current?.id,
    }),
  );
}

export function stepRunDetail(
  w: DemoWorld,
  stepRunId: number,
): Ok<'/step-runs/{stepRunId}'> | null {
  for (const code of STEP_FLOW) {
    const item = stepRunVersions(w, code).find((run) => run.id === stepRunId);
    if (item) return { ...item, inputs: stepInputs(w, code) };
  }
  return null;
}

// ── 여정 ────────────────────────────────────────────────────────────────────

function openChainSummary(chain: ChainRec | undefined) {
  if (!chain || chain.endedAt !== null) return null;
  return {
    id: chain.id,
    candidateId: DEMO_IDS.candidate,
    kind: chain.kind,
    startStepCode: chain.startStepCode,
    startedAt: iso(chain.startedAt),
    endedAt: null,
    stopReason: null,
    stopStepCode: null,
  };
}

function gateSummary(w: DemoWorld, gate: 'G2' | 'G3', rec: GateRec | null) {
  return {
    gate,
    gatePassId: rec?.gatePassId ?? null,
    passedAt: rec ? iso(rec.passedAt) : null,
    valid: gateValid(w, gate),
  };
}

export function candidateDetailOf(w: DemoWorld): Ok<'/candidates/{candidateId}'> {
  const c = w.s.candidate as CandidateRec;
  const approved = [...w.s.registration.records].sort((a, b) => b.approvedAt - a.approvedAt)[0];
  return candidateDetail({
    id: c.id,
    creationPath: 'KEYWORD',
    status: c.status,
    statusChangedAt: iso(c.statusChangedAt),
    excludedReason: null,
    displayName: c.displayName,
    sourceKeywordId: c.sourceKeywordId,
    sourceKeyword: c.sourceKeyword,
    rakutenQuery: c.rakutenQuery,
    sourceUrl: null,
    anchorModelCode: c.anchorModelCode,
    anchorItemCode: c.anchorItemCode,
    anchorColorCode: c.anchorColorCode,
    anchorFixedAt: isoOrNull(c.anchorFixedAt),
    itemCode: c.itemCode,
    selectedColor: c.selectedColor,
    gender: c.gender,
    genderSource: c.genderSource,
    genderRecheckRequired: false,
    leafCategoryId: c.leafCategoryId,
    wholeCategoryName: c.wholeCategoryName,
    noComparisonConfirmedAt: null,
    locked: ['REGISTERING', 'RESULT_CHECK_REQUIRED', 'REGISTERED'].includes(c.status),
    pageDataCollectedAt: isoOrNull(c.pageDataCollectedAt),
    pageDataStale: false,
    gates: [gateSummary(w, 'G2', w.s.gates.G2), gateSummary(w, 'G3', w.s.gates.G3)],
    approvedAt: approved ? iso(approved.approvedAt) : null,
    openContinuousRun: openChainSummary(w.s.chains[w.s.chains.length - 1]),
    resumeStepCode: resumeStepCode(w),
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  });
}

export function candidateSummaryOf(w: DemoWorld): Schema<'CandidateSummary'> {
  const detail = candidateDetailOf(w);
  return candidateSummary({
    id: detail.id,
    creationPath: detail.creationPath,
    status: detail.status,
    statusChangedAt: detail.statusChangedAt,
    excludedReason: null,
    displayName: detail.displayName,
    rakutenQuery: detail.rakutenQuery,
    anchorModelCode: detail.anchorModelCode,
    itemCode: detail.itemCode,
    selectedColor: detail.selectedColor,
    gender: detail.gender,
    resumeStepCode: detail.resumeStepCode,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    steps: stepBriefs(Object.fromEntries(STEP_FLOW.map((code) => [code, w.s.steps[code].status]))),
  });
}

/** 기본 목록에서는 제외·등록됨이 빠진다 */
const DEFAULT_LIST_STATUSES = [
  'TEMP',
  'WORKING',
  'AWAITING_APPROVAL',
  'VALIDATED',
  'REGISTERING',
  'RESULT_CHECK_REQUIRED',
];

const listOf = (query: URLSearchParams, name: string): string[] =>
  query
    .getAll(name)
    .flatMap((v) => v.split(','))
    .filter(Boolean);

export function listCandidates(w: DemoWorld, query: URLSearchParams): Ok<'/candidates'> {
  const statuses = listOf(query, 'status');
  const allowed = statuses.length > 0 ? statuses : DEFAULT_LIST_STATUSES;
  const runnableStep = query.get('runnableStep');
  const q = query.get('q')?.trim().toLowerCase() ?? '';
  const page = Number(query.get('page') ?? 0) || 0;
  const size = Number(query.get('size') ?? 20) || 20;
  const candidate = w.s.candidate;
  if (!candidate) return pageOf([], page, size);
  const summary = candidateSummaryOf(w);
  const visible =
    allowed.includes(summary.status) &&
    (runnableStep === null || runBlock(w, runnableStep as StepCode, 'chain') === null) &&
    (q === '' ||
      [summary.displayName, summary.rakutenQuery, summary.itemCode, summary.anchorModelCode].some(
        (text) => text?.toLowerCase().includes(q),
      ));
  return pageOf(visible ? [summary] : [], page, size);
}

export function candidateStatusCounts(w: DemoWorld): Ok<'/candidates/status-counts'> {
  const status = w.s.candidate?.status;
  return statusCounts(status ? { [status]: 1 } : {});
}

/** 이어서 할 곳(BE `resumeTarget`): 진행 중 여정의 첫 이어 할 단계 또는 대기 게이트. 없으면 null */
export function resumeTargetOf(w: DemoWorld): Ok<'/candidates/resume-target'> | null {
  const c = w.s.candidate;
  if (!c || !DEFAULT_LIST_STATUSES.includes(c.status)) return null;
  const open = (code: StepCode) =>
    ['WAITING_INPUT', 'NOT_RUN', 'FAILED', 'RERUN_REQUIRED'].includes(w.s.steps[code].status);
  const at = (stepCode: StepCode | null, gate: 'G2' | 'G3' | 'G4' | null) => ({
    candidateId: c.id,
    candidateStatus: c.status,
    stepCode,
    stepStatus: stepCode ? w.s.steps[stepCode].status : null,
    gate,
  });
  for (const code of ['SOURCING', 'PRICING'] as const) if (open(code)) return at(code, null);
  if (isDone(w, 'PRICING') && !gateValid(w, 'G2')) return at(null, 'G2');
  for (const code of [
    'CATEGORY',
    'THUMBNAIL',
    'COPY',
    'NOTICE_RAW',
    'NOTICE_HTML',
    'TAGS',
  ] as const) {
    if (open(code)) return at(code, null);
  }
  if (isDone(w, 'THUMBNAIL') && !gateValid(w, 'G3')) return at(null, 'G3');
  if (open('UPLOAD')) return at('UPLOAD', null);
  if (STEP_FLOW.slice(0, 9).every((code) => isDone(w, code)) && !isDone(w, 'REGISTER')) {
    return at(null, 'G4');
  }
  return null;
}

const isDone = (w: DemoWorld, code: StepCode): boolean => w.s.steps[code].status === 'COMPLETED';

/** 재실행 필요·멈춘 단계 모아 보기: 입력 대기와 재실행 필요 단계가 보인다(체험에는 실패가 없다) */
export function attentionSteps(w: DemoWorld, query: URLSearchParams): Ok<'/candidate-steps'> {
  const statuses = listOf(query, 'status');
  const wanted = statuses.length > 0 ? statuses : ['RERUN_REQUIRED', 'FAILED', 'WAITING_INPUT'];
  const page = Number(query.get('page') ?? 0) || 0;
  const size = Number(query.get('size') ?? 20) || 20;
  const c = w.s.candidate;
  if (!c || c.status === 'REGISTERED' || c.status === 'EXCLUDED') return pageOf([], page, size);
  const items = STEP_FLOW.filter((code) => wanted.includes(w.s.steps[code].status)).map((code) => {
    const run = currentRun(w, code);
    return {
      id: STEP_FLOW.indexOf(code) + 1,
      candidateId: c.id,
      candidateStatus: c.status,
      stepCode: code,
      status: w.s.steps[code].status,
      currentStepRunId: run?.id ?? null,
      staleInputs: staleInputsOf(w, code),
      staleSince:
        w.s.steps[code].status === 'RERUN_REQUIRED' ? isoOrNull(w.s.steps[code].staleSince) : null,
      updatedAt: iso(w.s.steps[code].updatedAt ?? c.updatedAt),
      failureKind: null,
      errorMessage: null,
      waitingSince: isoOrNull(run?.waitingSince ?? null),
    } satisfies Schema<'CandidateStepAttentionItem'>;
  });
  return pageOf(items, page, size);
}

// ── 게이트 ──────────────────────────────────────────────────────────────────

/**
 * 통과 때와 달라진 게이트 구성값 이름(BE `changedBasisKeys`). G2는 사이즈별 판매가(`salePrices.{mm}`) — ③을 다시 실행해 판매가가 달라졌을
 * 때만 생긴다. G3은 통과와 함께만 바뀌어 늘 비어 있다.
 */
export function changedBasisKeysOf(w: DemoWorld, gate: 'G2' | 'G3'): string[] {
  if (gate !== 'G2') return [];
  const snapshot = w.s.pricing.judgement;
  const status = w.s.steps.PRICING.status;
  if (!snapshot || (status !== 'COMPLETED' && status !== 'RERUN_REQUIRED')) return [];
  if (w.s.pricing.g2SalePriceKrw === null || w.s.pricing.g2SalePriceKrw === snapshot.salePriceKrw) {
    return [];
  }
  return STORY.saleSizesMm.map((mm) => `salePrices.${mm}`);
}

function g2g3State(w: DemoWorld, gate: 'G2' | 'G3') {
  const rec = w.s.gates[gate];
  const basis = gate === 'G2' ? 'PRICING' : 'THUMBNAIL';
  const valid = gateValid(w, gate);
  const status = w.s.steps[basis].status;
  // G3는 ⑤가 입력 대기여도 고를 수 있다(⑤는 G3를 통과해야 끝난다) — 아직 시작 전·실행 중일 때만 막힌 이유가 있다
  const blocked =
    gate === 'G3' ? status === 'NOT_RUN' || status === 'RUNNING' : status !== 'COMPLETED';
  const blockedReasons: Schema<'CandidateBlockReason'>[] = !blocked
    ? []
    : [
        {
          code: 'STEP_NOT_COMPLETED',
          message: `${withSubject(STEP_LABEL[basis])} 아직 완료되지 않았습니다(지금: ${STEP_STATUS_TEXT[status]}).`,
          details: { stepCode: basis, status },
        },
      ];
  return gateState({
    gate,
    passed: valid,
    gatePassId: rec?.gatePassId ?? null,
    passedAt: rec ? iso(rec.passedAt) : null,
    basisStepRunId: rec?.basisStepRunId ?? null,
    fingerprintValid: valid,
    changedBasisKeys: rec ? changedBasisKeysOf(w, gate) : [],
    blockedReasons,
  });
}

export function candidateGates(w: DemoWorld): Ok<'/candidates/{candidateId}/gates'> {
  const selected = w.s.candidate ? w.s.keywords.selected[w.s.candidate.sourceKeywordId] : undefined;
  const record = [...w.s.registration.records].sort((a, b) => b.approvedAt - a.approvedAt)[0];
  const g4Passed =
    record !== undefined &&
    ['VALIDATED', 'REGISTERING', 'RESULT_CHECK_REQUIRED', 'REGISTERED'].includes(
      w.s.candidate?.status ?? '',
    );
  return {
    items: [
      gateState({
        gate: 'G1',
        passed: selected !== undefined,
        passedAt: selected === undefined ? null : iso(selected),
      }),
      g2g3State(w, 'G2'),
      g2g3State(w, 'G3'),
      gateState({
        gate: 'G4',
        passed: g4Passed,
        passedAt: record ? iso(record.approvedAt) : null,
        registrationId: record?.id ?? null,
      }),
    ],
  };
}

// ── 이력 ────────────────────────────────────────────────────────────────────

export function candidateStatusHistory(w: DemoWorld): Schema<'CandidateStatusHistoryItem'>[] {
  const c = w.s.candidate as CandidateRec;
  return [...c.history].reverse().map((row) => ({
    id: row.id,
    candidateId: c.id,
    fromStatus: row.from,
    toStatus: row.to,
    reason: row.reason,
    stepRunId: row.stepRunId,
    gatePassId: null,
    registrationId: row.registrationId,
    changedAt: iso(row.at),
  }));
}

export function continuousRunView(
  w: DemoWorld,
  chainId: number,
): Ok<'/continuous-runs/{stepChainId}'> | null {
  const chain = w.s.chains.find((c) => c.id === chainId);
  if (!chain) return null;
  const runs = chain.runIds.flatMap((id) => {
    const code = STEP_FLOW.find((step) => w.s.steps[step].runs.some((run) => run.id === id));
    const run = code ? w.s.steps[code].runs.find((r) => r.id === id) : undefined;
    return code && run ? [runSummary(code, run)] : [];
  });
  return continuousRun({
    id: chain.id,
    candidateId: DEMO_IDS.candidate,
    kind: chain.kind,
    startStepCode: chain.startStepCode,
    startedAt: iso(chain.startedAt),
    endedAt: isoOrNull(chain.endedAt),
    stopReason: chain.stopReason,
    stopStepCode: chain.stopStepCode,
    stepRuns: runs,
    skippedStepCodes: chain.skipped,
  });
}

/**
 * `GET …/stale-diff`: 재실행 필요인 단계의 입력 비교(BE `StaleDiffService`). 시작 조건 입력을 쓴 값 ↔ 지금 값으로 견주고, 바뀐 것만
 * `changed`다(키 사전순). 재실행 필요가 아니면 null(409는 부르는 쪽).
 */
export function staleDiffOf(
  w: DemoWorld,
  code: StepCode,
): Ok<'/candidates/{candidateId}/steps/{stepCode}/stale-diff'> | null {
  const rec = w.s.steps[code];
  const run = currentRun(w, code);
  if (rec.status !== 'RERUN_REQUIRED' || !run) return null;
  const current = readInputs(w, code);
  const keys = [...new Set([...startKeys(code), ...rec.staleInputs])].sort();
  const hash = (key: string, sig: string | null) => fakeSha256(`${key}:${sig ?? 'null'}`);
  return {
    candidateId: DEMO_IDS.candidate,
    stepCode: code,
    status: rec.status,
    stepRunId: run.id,
    staleInputs: [...rec.staleInputs],
    staleSince: isoOrNull(rec.staleSince),
    keepAsIsAllowed: code === 'COPY',
    inputs: keys.map((inputKey) => {
      const used = run.inputs?.[inputKey];
      const now = current[inputKey];
      const usedSig = used?.sig ?? null;
      const nowSig = now?.sig ?? null;
      return {
        inputKey,
        sourceType: sourceTypeOf(code, inputKey),
        changed: usedSig !== nowSig,
        usedSourceStepRunId: used?.sourceRunId ?? null,
        currentSourceStepRunId: now?.sourceRunId ?? null,
        usedValueHash: hash(inputKey, usedSig),
        currentValueHash: hash(inputKey, nowSig),
      };
    }),
  };
}
