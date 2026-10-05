import type { StepCode } from '@/shared/lib/steps';
import type { DemoWorld } from '../demoWorld';
import type { StartBody, DelayKind } from './runner';
import {
  candidateNotFound,
  httpError,
  STEP_LABEL,
  STEP_STATUS_TEXT,
  withSubject,
  type DemoHttpError,
} from './errors';
import {
  changedKeys,
  directReaders,
  outputsOf,
  readInputs,
  readsOf,
  startKeys,
  STEP_INPUTS,
} from './graph';
import { REQUIRED_STEPS, STEP_FLOW } from './steps';
import {
  type CandidateRec,
  type CandidateStatus,
  type CandidateStatusReason,
  type ChainRec,
  type RunRec,
  type StepChainStopReason,
  type StepRec,
} from './state';

/**
 * 단계 엔진(D-32): 실제 BE의 step-engine 규칙을 메모리에서 되풀이한다 — 단계 상태·버전, 시작 조건, 실행 잠금, 연속 실행, 게이트,
 * 여정 상태. 단계 고유의 일(국내 기준가·카테고리 후보·썸네일 생성·콘텐츠 …)은 `world/domains/*`가 한다.
 * 근거: BE `modules/step-engine/{domain,execution,rail,continuous,gates}`.
 */

// ── 단계 그래프 ─────────────────────────────────────────────────────────────

interface Requirement {
  /** 빠진 입력 이름(BE `input-keys.ts` 라벨) */
  label: string;
  /** 오류 칸 이름(step_run_input.input_key) */
  key: string;
  /** 이 단계가 COMPLETED여야 채워진다 */
  step?: StepCode;
  /** 여정 성별이 있어야 채워진다 */
  gender?: true;
}

const GENDER: Requirement = { label: '성별', key: 'candidate.gender', gender: true };

/** 시작 조건(BE `STEP_GRAPH`). 앞 단계는 현재 버전이 COMPLETED여야 한다 */
const REQUIREMENTS: Readonly<Record<StepCode, readonly Requirement[]>> = {
  SOURCING: [],
  PRICING: [
    { label: '② 목표 사이즈 SKU가·재고', key: 'sourcing.targetSkus', step: 'SOURCING' },
    GENDER,
  ],
  CATEGORY: [{ label: '② 장르·상품유형', key: 'sourcing.genre', step: 'SOURCING' }, GENDER],
  THUMBNAIL: [{ label: '② 소싱 선택', key: 'sourcing.selection', step: 'SOURCING' }],
  COPY: [
    { label: '② 상품명·설명', key: 'sourcing.itemText', step: 'SOURCING' },
    { label: '② SKU 속성', key: 'sourcing.skuAttributes', step: 'SOURCING' },
  ],
  NOTICE_RAW: [
    { label: '② 소싱 선택', key: 'sourcing.selection', step: 'SOURCING' },
    { label: '② 속성·설명·스펙 이미지', key: 'sourcing.attributes', step: 'SOURCING' },
    { label: '② 선택 색상', key: 'sourcing.selectedColor', step: 'SOURCING' },
  ],
  NOTICE_HTML: [
    { label: '② 모델명·상품유형', key: 'sourcing.modelInfo', step: 'SOURCING' },
    { label: '⑥-1 카피', key: 'copy.draft', step: 'COPY' },
    { label: '⑥-2 원산지·소재', key: 'noticeRaw.facts', step: 'NOTICE_RAW' },
    { label: '③ 판매 사이즈', key: 'pricing.saleSizes', step: 'PRICING' },
    GENDER,
  ],
  TAGS: [{ label: '② 모델명·상품유형', key: 'sourcing.modelInfo', step: 'SOURCING' }, GENDER],
  UPLOAD: [
    { label: '⑤ 선택본', key: 'thumbnail.selection', step: 'THUMBNAIL' },
    { label: '⑥-3 HTML', key: 'noticeHtml.html', step: 'NOTICE_HTML' },
  ],
  REGISTER: [],
};

/** 시작 조건 표가 완료를 요구하는 앞 단계(그래프 `graph.ts`의 필수 앞 단계와 같아야 한다 — 시험이 대조한다) */
export const requirementSteps = (code: StepCode): StepCode[] =>
  REQUIREMENTS[code].flatMap((req) => (req.step ? [req.step] : []));

/** 직간접으로 읽는 앞 단계 */
function upstreamOf(code: StepCode): Set<StepCode> {
  const out = new Set<StepCode>();
  const queue = [...readsOf(code)];
  while (queue.length > 0) {
    const next = queue.pop()!;
    if (out.has(next)) continue;
    out.add(next);
    queue.push(...readsOf(next));
  }
  return out;
}

/** 이 단계와 잠금으로 얽힌 단계(앞 단계 + 이 단계를 읽는 뒤 단계) */
function relatedSteps(code: StepCode): StepCode[] {
  return STEP_FLOW.filter(
    (other) => other !== code && (upstreamOf(code).has(other) || upstreamOf(other).has(code)),
  );
}

// ── 읽기 도우미 ─────────────────────────────────────────────────────────────

export const stepOf = (w: DemoWorld, code: StepCode): StepRec => w.s.steps[code];

export function currentRun(w: DemoWorld, code: StepCode): RunRec | null {
  const runs = w.s.steps[code].runs;
  return runs[runs.length - 1] ?? null;
}

export const isCompleted = (w: DemoWorld, code: StepCode): boolean =>
  w.s.steps[code].status === 'COMPLETED';

const LOCKED_STATUSES: readonly CandidateStatus[] = [
  'REGISTERING',
  'RESULT_CHECK_REQUIRED',
  'REGISTERED',
];

export const isLocked = (candidate: CandidateRec): boolean =>
  LOCKED_STATUSES.includes(candidate.status);

export type GateCode = 'G2' | 'G3';
const GATE_BASIS: Record<GateCode, StepCode> = { G2: 'PRICING', G3: 'THUMBNAIL' };

/**
 * G2·G3가 지금 유효한가(BE `GateValidityService.inspect`): 최신 통과 기록이 있고, 근거 단계(③·⑤)의 현재 버전이 산출물을 가지고(완료 —
 * '재실행 필요'여도 그 버전의 산출물은 그대로다) 그 산출물의 지문이 통과 때의 지문과 같다.
 * - G2: ③ 판정의 지문(판매 사이즈·사이즈별 판매가). 국내 기준가만 바꿔 '재실행 필요'가 된 동안은 옛 판정이 그대로라 G2도 유효하고,
 *   다시 실행해 판매가가 달라지면 무효(MISMATCH)가 된다. 다시 실행 중·입력 대기에는 산출물이 없어 무효(PENDING)다
 * - G3: ⑤ 선택본. 선택은 통과와 함께만 바뀌므로(통과 = 새 지문) 근거 ⑤가 완료이면 유효하다
 */
export function gateValid(w: DemoWorld, gate: GateCode): boolean {
  const record = w.s.gates[gate];
  if (record === null) return false;
  if (gate === 'G3') return isCompleted(w, 'THUMBNAIL');
  const status = w.s.steps.PRICING.status;
  if (status !== 'COMPLETED' && status !== 'RERUN_REQUIRED') return false;
  const snapshot = w.s.pricing.judgement;
  return snapshot !== null && w.s.pricing.g2Fingerprint === snapshot.fingerprint;
}

/** 통과 기록은 있는데 근거 단계가 산출물을 내지 않은(다시 실행 중·입력 대기) '확인 중' 상태 */
export const gatePending = (w: DemoWorld, gate: GateCode): boolean => {
  if (w.s.gates[gate] === null) return false;
  const status = w.s.steps[GATE_BASIS[gate]].status;
  return status !== 'COMPLETED' && status !== 'RERUN_REQUIRED';
};

// ── 실행 가능 검사(BE `checkStepRunnable`) ────────────────────────────────────

/** 'run' = 단계 [실행] · 'chain' = 연속 실행이 고른 단계(입력 대기여도 막지 않는다) */
export type RunCheckMode = 'run' | 'chain';

export function runBlock(
  w: DemoWorld,
  code: StepCode,
  mode: RunCheckMode = 'run',
): DemoHttpError | null {
  const candidate = w.s.candidate;
  if (!candidate) return candidateNotFound();
  if (code === 'REGISTER') {
    return httpError(422, 'INVALID_STEP_CODE', '최종 승인(G4)에서만 등록합니다.', {
      details: { stepCode: 'REGISTER', reason: 'NOT_RUNNABLE' },
    });
  }
  if (!w.runners[code]) {
    return httpError(422, 'INVALID_STEP_CODE', '이 단계는 아직 준비 중이라 실행할 수 없습니다.', {
      details: { stepCode: code, reason: 'NO_RUNNER' },
    });
  }
  const lockBlock = candidateLockBlock(candidate);
  if (lockBlock) return lockBlock;

  const rec = w.s.steps[code];
  if (rec.status === 'RUNNING') {
    return httpError(409, 'STEP_ALREADY_RUNNING', '이 단계가 이미 실행 중입니다.', {
      details: { stepCode: code, status: 'RUNNING' },
    });
  }
  if (rec.status === 'WAITING_INPUT' && mode === 'run') {
    return httpError(
      409,
      'STEP_ALREADY_RUNNING',
      '이 단계가 입력을 기다리고 있습니다. 입력을 마치면 이어서 실행됩니다.',
      { details: { stepCode: code, status: 'WAITING_INPUT' } },
    );
  }
  const running = relatedSteps(code).find((other) => w.s.steps[other].status === 'RUNNING');
  if (running) {
    return httpError(
      409,
      'STEP_LOCKED_BY_RUNNING_STEP',
      `${withSubject(STEP_LABEL[running])} 실행 중이라 지금은 할 수 없습니다. 끝난 뒤 다시 해 주세요.`,
      { details: { stepCode: running } },
    );
  }
  const missing = REQUIREMENTS[code].filter((req) => {
    if (req.step) return !isCompleted(w, req.step);
    if (req.gender) return candidate.gender === null;
    return false;
  });
  if (missing.length > 0) {
    return httpError(
      409,
      'STEP_START_CONDITION_UNMET',
      `시작에 필요한 값이 없습니다: ${missing.map((req) => req.label).join(', ')}.`,
      {
        details: { stepCode: code },
        fieldErrors: missing.map((req) => ({
          field: req.key,
          message: `${req.label} 값이 필요합니다.`,
        })),
      },
    );
  }
  if (code === 'UPLOAD' && !gateValid(w, 'G3')) {
    return httpError(409, 'GATE_NOT_PASSED', 'G3 썸네일 선택을 먼저 통과해 주세요.', {
      details: { stepCode: 'UPLOAD', gate: 'G3' },
    });
  }
  return null;
}

/** 여정 잠금(등록 진행·끝) */
export function candidateLockBlock(candidate: CandidateRec): DemoHttpError | null {
  if (isLocked(candidate)) {
    return httpError(
      409,
      'CANDIDATE_LOCKED',
      '등록을 진행 중이거나 끝난 여정이라 바꿀 수 없습니다.',
      {
        details: { status: candidate.status },
      },
    );
  }
  return null;
}

export function openChain(w: DemoWorld): ChainRec | null {
  return w.s.chains.find((chain) => chain.endedAt === null) ?? null;
}

/** 연속 실행 버튼 검사(BE `stepActions().continuousRun`) */
export function continuousBlock(w: DemoWorld, code: StepCode): DemoHttpError | null {
  const candidate = w.s.candidate;
  if (!candidate) return candidateNotFound();
  if (code === 'REGISTER') return runBlock(w, code);
  const lockBlock = candidateLockBlock(candidate);
  if (lockBlock) return lockBlock;
  const open = openChain(w);
  if (open) {
    return httpError(
      409,
      'CONTINUOUS_RUN_ALREADY_OPEN',
      '이 여정의 연속 실행이 이미 진행 중입니다.',
      {
        details: { stepChainId: open.id },
      },
    );
  }
  if (!gateValid(w, 'G2') && code !== 'SOURCING' && code !== 'PRICING') {
    return httpError(
      409,
      'CONTINUOUS_RUN_BEFORE_G2',
      '소싱 확정(G2) 전에는 ②·③부터만 연속 실행할 수 있습니다. 다른 단계는 하나씩 실행해 주세요.',
    );
  }
  return runBlock(w, code, 'run');
}

const EDITABLE_STEPS: readonly StepCode[] = ['COPY', 'NOTICE_RAW', 'NOTICE_HTML', 'TAGS'];

/** 값 직접 고치기 검사(BE `checkStepEditable`) */
export function editBlock(w: DemoWorld, code: StepCode): DemoHttpError | null {
  const candidate = w.s.candidate;
  if (!candidate) return candidateNotFound();
  if (!EDITABLE_STEPS.includes(code)) {
    return httpError(
      422,
      'INVALID_STEP_CODE',
      '이 단계는 값을 직접 고칠 수 없습니다. 이전 버전 다시 고르기만 됩니다.',
      { details: { stepCode: code, reason: 'NOT_EDITABLE' } },
    );
  }
  const lockBlock = candidateLockBlock(candidate);
  if (lockBlock) return lockBlock;
  const rec = w.s.steps[code];
  if (rec.status === 'RUNNING' || rec.status === 'WAITING_INPUT') {
    return httpError(
      409,
      'STEP_ALREADY_RUNNING',
      rec.status === 'RUNNING'
        ? '이 단계가 이미 실행 중입니다.'
        : '이 단계가 입력을 기다리고 있습니다. 입력을 마치면 이어서 실행됩니다.',
      { details: { stepCode: code, status: rec.status } },
    );
  }
  const readerRunning = STEP_FLOW.find(
    (other) => upstreamOf(other).has(code) && w.s.steps[other].status === 'RUNNING',
  );
  if (readerRunning) {
    return httpError(
      409,
      'STEP_LOCKED_BY_RUNNING_STEP',
      `${withSubject(STEP_LABEL[readerRunning])} 실행 중이라 지금은 할 수 없습니다. 끝난 뒤 다시 해 주세요.`,
      { details: { stepCode: readerRunning } },
    );
  }
  if (rec.status !== 'COMPLETED' && rec.status !== 'RERUN_REQUIRED') {
    return httpError(
      409,
      'STEP_NOT_COMPLETED',
      `${withSubject(STEP_LABEL[code])} 아직 완료되지 않았습니다(지금: ${STEP_STATUS_TEXT[rec.status]}).`,
      { details: { stepCode: code, status: rec.status } },
    );
  }
  return null;
}

// ── 실행 수명주기 ───────────────────────────────────────────────────────────

/** 단계가 시작·끝날 때 이야기 시각표에 남기는 마일스톤(시계가 '몇 분 전' 값을 실제 시각으로 바꾼다) */
const BEGIN_MARK: Partial<
  Record<StepCode, 'sourcingStarted' | 'categoryStarted' | 'thumbnailStarted'>
> = {
  SOURCING: 'sourcingStarted',
  CATEGORY: 'categoryStarted',
  THUMBNAIL: 'thumbnailStarted',
};
const END_MARK = {
  SOURCING: 'sourcingDone',
  PRICING: 'judged',
  CATEGORY: 'categoryDecided',
  THUMBNAIL: 'g3Passed',
  COPY: 'copyDone',
  NOTICE_RAW: 'noticeRawDone',
  NOTICE_HTML: 'noticeHtmlDone',
  TAGS: 'tagsDone',
  UPLOAD: 'uploadDone',
} as const;

/**
 * 단계 실행 기록을 새 버전·RUNNING으로 연다(상태 확인·실행기·여정 상태 재평가 없이). 단계 실행기가 없는 ⑨(승인이 연다)가 쓴다.
 * 끝낼 때는 `closeStepRun`.
 */
export function openStepRun(
  w: DemoWorld,
  code: StepCode,
  mode: RunRec['executionMode'] = 'STEP',
  chain: ChainRec | null = null,
): RunRec {
  const rec = w.s.steps[code];
  const now = w.now();
  const run: RunRec = {
    id: w.s.next.run++,
    version: rec.runs.length + 1,
    status: 'RUNNING',
    executionMode: mode,
    stepChainId: chain?.id ?? null,
    startedAt: now,
    endedAt: null,
    waitingSince: null,
    waitSeconds: 0,
    waitingReasonCode: null,
    pendingInputs: [],
    // 시작 때 읽은 입력(BE 시작 지문). 끝날 때 다시 읽어 견준다(`closeStepRun`)
    inputs: readInputs(w, code),
  };
  rec.runs.push(run);
  rec.status = 'RUNNING';
  rec.updatedAt = now;
  // 새 실행은 지금 값으로 다시 읽으므로 '재실행 필요' 이유를 비운다
  rec.staleInputs = [];
  rec.staleSince = null;
  if (chain) {
    chain.runIds.push(run.id);
    if (!chain.ran.includes(code)) chain.ran.push(code);
  }
  const mark = BEGIN_MARK[code];
  if (mark) w.mark(mark);
  return run;
}

/**
 * 단계 실행을 시작한다(`POST …/runs`, 연속 실행의 한 단계): 검사 → 새 버전 RUNNING → 지연 뒤 결과. 막히면 `DemoHttpError`.
 * 시작할 때 여정 상태를 다시 계산한다(승인대기였다면 작업중으로 — 이 단계가 최신이 아니다).
 */
export function startStep(
  w: DemoWorld,
  code: StepCode,
  body: StartBody = {},
  chain: ChainRec | null = null,
): RunRec {
  const block = runBlock(w, code, chain ? 'chain' : 'run');
  if (block) throw block;
  const runner = w.runners[code]!;
  runner.beforeStart?.(w, body);
  const run = openStepRun(w, code, chain ? 'CHAIN' : 'STEP', chain);
  runner.onStart?.(w, body);
  reevaluate(w, 'STEP_NOT_CURRENT');
  w.schedule(runner.delay, () => settleRun(w, code, run.id));
  return run;
}

/** 지연이 끝나 결과를 낸다(입력 대기 또는 완료). 이미 다른 실행으로 넘어갔거나 처음으로 돌아갔으면 아무것도 하지 않는다 */
function settleRun(w: DemoWorld, code: StepCode, runId: number): void {
  const run = currentRun(w, code);
  if (!run || run.id !== runId || run.status !== 'RUNNING') return;
  const runner = w.runners[code]!;
  const outcome = runner.outcome(w);
  if (outcome.status === 'WAITING_INPUT') {
    run.status = 'WAITING_INPUT';
    run.waitingSince = w.now();
    run.waitingReasonCode = outcome.reasonCode;
    run.pendingInputs = outcome.pendingInputs;
    w.s.steps[code].status = 'WAITING_INPUT';
  } else {
    closeStepRun(w, code, run);
  }
  w.s.steps[code].updatedAt = w.now();
  runner.onSettled?.(w, outcome);
  reevaluate(w);
  afterSettled(w, code, run);
}

/**
 * 현재 실행을 끝낸다(입력 대기였다면 기다린 시간을 더한다). 여정 상태 재평가·연속 실행 이어 가기는 하지 않는다.
 * 규칙 5(BE 끝 지문 비교): 시작 때 읽은 시작 조건 입력을 지금 값과 다시 견준다 — 실행하는 사이 앞 단계나 여정 값이 바뀌었으면
 * 이 실행은 '재실행 필요'로 끝나고(바뀐 입력이 이유), 뒤 단계 전파도 하지 않는다. 실행 중 오너 입력(③ 국내 기준가·⑤ 레퍼런스)은
 * 견주지 않고 끝날 때 값으로 맞춘다. 같으면 완료이고 산출물을 바로 읽는 뒤 단계가 낡았는지 견준다.
 */
export function closeStepRun(w: DemoWorld, code: StepCode, run: RunRec): void {
  const now = w.now();
  if (run.waitingSince !== null) {
    run.waitSeconds += Math.round((now - run.waitingSince) / 1000);
    run.waitingSince = null;
  }
  const atStart = run.inputs ?? {};
  const current = readInputs(w, code);
  const changed = changedKeys(atStart, current, startKeys(code));
  const finalStatus = changed.length > 0 ? 'RERUN_REQUIRED' : 'COMPLETED';
  // 시작 조건 입력은 시작 때 읽은 값 그대로(이 값으로 산출물을 냈다), 실행 중 오너 입력은 끝날 때 값
  const started = new Set(startKeys(code));
  run.inputs = Object.fromEntries(
    Object.entries(current).map(([key, value]) => [
      key,
      started.has(key) ? (atStart[key] ?? value) : value,
    ]),
  );
  run.outputs = outputsOf(w, code, run.inputs);
  run.status = finalStatus;
  run.rerunReasonInputs = changed;
  run.endedAt = now;
  run.waitingReasonCode = null;
  run.pendingInputs = [];
  const rec = w.s.steps[code];
  rec.status = finalStatus;
  rec.updatedAt = now;
  rec.staleInputs = changed;
  rec.staleSince = changed.length > 0 ? now : null;
  const mark = END_MARK[code as keyof typeof END_MARK];
  if (mark) w.mark(mark, now);
  if (finalStatus === 'COMPLETED') propagateFromStep(w, code);
}

// ── '재실행 필요' 전파 ───────────────────────────────────────────────────────

/** 재실행 필요로 바꿀 수 있는 단계 상태(현재 버전이 산출물을 가졌다: 실행 중·입력 대기·실패는 바꾸지 않는다) */
const STALEABLE: readonly StepRec['status'][] = ['COMPLETED', 'RERUN_REQUIRED'];

/**
 * 단계를 재실행 필요로 둔다(BE `PropagationService.markStale`): 완료 → 재실행 필요(이유 = 바뀐 입력), 이미 재실행 필요면 이유를 더한다
 * (시각은 그대로). 여정 상태 재평가는 부르는 쪽이 한다.
 */
export function markStale(w: DemoWorld, code: StepCode, keys: readonly string[]): void {
  const rec = w.s.steps[code];
  const now = w.now();
  const already = rec.status === 'RERUN_REQUIRED';
  rec.staleInputs = already
    ? [...rec.staleInputs, ...keys.filter((key) => !rec.staleInputs.includes(key))]
    : [...keys];
  rec.staleSince = already ? (rec.staleSince ?? now) : now;
  rec.status = 'RERUN_REQUIRED';
  rec.updatedAt = now;
}

/**
 * 규칙 6(BE `propagateFromStep`): `code`가 새 버전을 냈다(실행 끝·오너 수정·다시 고르기) → 그 산출물을 **바로** 읽는 단계만 지금 값을
 * 읽어 그 단계가 쓴 값과 견준다. 달라진 입력이 있으면 재실행 필요, 같으면 그대로. 자동으로 다시 실행하지 않는다. 새로 재실행 필요가
 * 된 단계를 돌려준다.
 */
export function propagateFromStep(w: DemoWorld, code: StepCode): StepCode[] {
  const changed: StepCode[] = [];
  for (const reader of directReaders(code)) {
    const run = currentRun(w, reader);
    if (!run || !STALEABLE.includes(w.s.steps[reader].status)) continue;
    const keys = changedKeys(run.inputs, readInputs(w, reader), startKeys(reader));
    if (keys.length === 0) continue;
    markStale(w, reader, keys);
    changed.push(reader);
  }
  return changed;
}

/**
 * 규칙 7(BE `ownerInputChanged`): 완료 뒤 오너 입력(③ 국내 기준가 …)이 바뀌었다 → 그 입력을 읽는 단계의 지금 값을 그 단계가 쓴 값과
 * 견줘 다르면 재실행 필요. 입력 대기·실행 중인 단계는 바꾸지 않는다(실행 중 오너 입력은 정상 입력이다). 여정 상태도 다시 평가한다.
 */
export function ownerInputChanged(w: DemoWorld, key: string): StepCode[] {
  const changed: StepCode[] = [];
  for (const code of STEP_FLOW) {
    if (!STEP_INPUTS[code].some((decl) => decl.key === key)) continue;
    const run = currentRun(w, code);
    if (!run || !STALEABLE.includes(w.s.steps[code].status)) continue;
    if (changedKeys(run.inputs, readInputs(w, code), [key]).length === 0) continue;
    markStale(w, code, [key]);
    changed.push(code);
  }
  if (changed.length > 0) reevaluate(w);
  return changed;
}

/**
 * 입력 대기(WAITING_INPUT)였던 현재 실행을 같은 실행·같은 버전으로 마친다 — 리프 고르기, 소싱 고르기, G3 통과가 부른다.
 * `delay`를 주면 먼저 RUNNING으로 두고 지연 뒤 마친다(국내 기준가를 넣으면 판정을 이어 계산하는 것처럼).
 */
export function resumeToComplete(w: DemoWorld, code: StepCode, delay?: DelayKind): void {
  const run = currentRun(w, code);
  if (!run || run.status !== 'WAITING_INPUT') return;
  const finish = () => {
    const now = currentRun(w, code);
    if (!now || now.id !== run.id) return;
    closeStepRun(w, code, run);
    w.runners[code]?.onSettled?.(w, { status: 'COMPLETED' });
    reevaluate(w);
    afterSettled(w, code, run);
  };
  if (delay === undefined) {
    finish();
    return;
  }
  if (run.waitingSince !== null) {
    run.waitSeconds += Math.round((w.now() - run.waitingSince) / 1000);
    run.waitingSince = null;
  }
  run.status = 'RUNNING';
  w.s.steps[code].status = 'RUNNING';
  w.s.steps[code].updatedAt = w.now();
  reevaluate(w, 'STEP_NOT_CURRENT');
  w.schedule(delay, finish);
}

// ── 연속 실행 · ⑥ 묶음 ───────────────────────────────────────────────────────

const BUNDLE_NEXT: Partial<Record<StepCode, StepCode>> = {
  COPY: 'NOTICE_RAW',
  NOTICE_RAW: 'NOTICE_HTML',
};

/** 단계 하나가 끝난 뒤: 그 실행이 속한 연속 실행을 이어 가고, ⑥ 묶음 실행이 남아 있으면 다음 단계를 시작한다 */
function afterSettled(w: DemoWorld, code: StepCode, run: RunRec): void {
  if (run.stepChainId !== null) {
    const chain = w.s.chains.find((c) => c.id === run.stepChainId);
    if (chain && chain.endedAt === null) advanceChain(w, chain);
    return;
  }
  if (w.s.bundle.length === 0) return;
  if (run.status === 'COMPLETED' && w.s.bundle[0] === BUNDLE_NEXT[code]) {
    // ⑥ 묶음: ⑥-1 → ⑥-2 → ⑥-3. 시작 조건·잠금에 걸리는 단계는 조용히 건너뛴다
    const next = w.s.bundle.shift()!;
    if (runBlock(w, next) === null) startStep(w, next, {});
    else w.s.bundle = [];
  } else if (run.status === 'WAITING_INPUT' || run.status === 'RERUN_REQUIRED') {
    // 입력 대기에서 멈추거나 재실행 필요로 끝나면 뒤 단계는 시작 조건 때문에 못 돈다 — 묶음을 접는다
    w.s.bundle = [];
  }
}

/** 연속 실행이 도는 단계(⑨ 제외) */
const CHAIN_STEPS: readonly StepCode[] = REQUIRED_STEPS;
/** G2 전에 연속 실행을 시작할 수 있는 단계(F-CW-15) */
const BEFORE_G2_CHAIN_STARTS: readonly StepCode[] = ['SOURCING', 'PRICING'];

const beforeG2Error = () =>
  httpError(
    409,
    'CONTINUOUS_RUN_BEFORE_G2',
    '소싱 확정(G2) 전에는 ②·③부터만 연속 실행할 수 있습니다. 다른 단계는 하나씩 실행해 주세요.',
  );
const noRerunError = () =>
  httpError(409, 'NO_RERUN_REQUIRED_STEPS', '다시 실행할 단계가 없습니다.');

/** 재실행 필요 단계 모두 실행 버튼 검사(BE `ContinuousRunService.start` + `checkChainStart` RERUN_STALE) */
export function rerunStaleBlock(w: DemoWorld): DemoHttpError | null {
  const candidate = w.s.candidate;
  if (!candidate) return candidateNotFound();
  const lockBlock = candidateLockBlock(candidate);
  if (lockBlock) return lockBlock;
  const open = openChain(w);
  if (open) {
    return httpError(
      409,
      'CONTINUOUS_RUN_ALREADY_OPEN',
      '이 여정의 연속 실행이 이미 진행 중입니다.',
      { details: { stepChainId: open.id } },
    );
  }
  const targets = CHAIN_STEPS.filter((code) => w.s.steps[code].status === 'RERUN_REQUIRED');
  if (targets.length === 0) return noRerunError();
  // G2 전에는 ②·③ 밖의 재실행 필요 단계만 남았으면 연속으로 돌지 않는다(G2에서 멈추는 규칙과 같다)
  if (!gateValid(w, 'G2') && targets.every((code) => !BEFORE_G2_CHAIN_STARTS.includes(code))) {
    return beforeG2Error();
  }
  return null;
}

/** 연속 실행 기록 하나를 새로 만든다(아직 `w.s.chains`에 넣지 않는다) */
function newChain(w: DemoWorld, start: StepCode | null): ChainRec {
  return {
    id: w.s.next.chain,
    kind: start ? 'FROM_HERE' : 'RERUN_STALE',
    startStepCode: start,
    startedAt: w.now(),
    endedAt: null,
    stopReason: null,
    stopStepCode: null,
    runIds: [],
    ran: [],
    skipped: [],
  };
}

/**
 * [재실행 필요 단계 모두 실행]을 지금 누르면 거절되는 이유(BE `ContinuousRunService.start`: 시작 검사 → 첫 행동이 실행이 아니면
 * `startRejection`). 눌러도 되면 null. 띠가 '다음에 할 일'을 정할 때 같은 검사를 쓴다 — 눌러도 거절될 버튼을 알리지 않는다.
 */
export function rerunStaleRefusal(w: DemoWorld): DemoHttpError | null {
  const block = rerunStaleBlock(w);
  if (block) return block;
  const chain = newChain(w, null);
  const plan = planChain(w, chain);
  return plan.kind === 'run' ? null : startRejection(w, chain, plan);
}

/**
 * 연속 실행을 연다(`POST …/continuous-runs`). `start`가 있으면 여기부터 연속 실행(FROM_HERE), 없으면 재실행 필요 단계 모두 실행
 * (RERUN_STALE). 첫 행동을 곧바로 정해 첫 단계를 시작한다 — 첫 행동이 실행이 아니면 묶음을 남기지 않고 거절한다(BE `startRejection`).
 */
export function startChain(w: DemoWorld, start: StepCode | null): { chain: ChainRec; run: RunRec } {
  const block = start ? continuousBlock(w, start) : rerunStaleBlock(w);
  if (block) throw block;
  const chain = newChain(w, start);
  w.s.chains.push(chain);
  try {
    const plan = planChain(w, chain);
    if (plan.kind !== 'run') throw startRejection(w, chain, plan);
    const run = startStep(w, plan.code, {}, chain);
    w.s.next.chain += 1;
    w.mark('chainStarted');
    return { chain, run };
  } catch (error) {
    w.s.chains.pop();
    throw error;
  }
}

/** 첫 행동이 실행이 아닐 때의 거절(BE `startRejection`): 첫 재실행 필요 단계를 못 도는 이유 → G2 앞 멈춤 → 돌릴 단계 없음 */
function startRejection(w: DemoWorld, chain: ChainRec, plan: ChainPlan): DemoHttpError {
  const first =
    chain.kind === 'RERUN_STALE'
      ? CHAIN_STEPS.find((code) => w.s.steps[code].status === 'RERUN_REQUIRED')
      : undefined;
  if (first) {
    const block = runBlock(w, first, 'run');
    if (block) return block;
  }
  if (plan.kind === 'stop' && plan.reason === 'AWAIT_G2') return beforeG2Error();
  return noRerunError();
}

type ChainPlan =
  | { kind: 'run'; code: StepCode }
  | { kind: 'wait' }
  | { kind: 'stop'; reason: StepChainStopReason; stepCode: StepCode | null };

/** 묶음이 도는 단계(FROM_HERE = 고른 단계부터, RERUN_STALE = 전부) */
function chainSegment(chain: ChainRec): StepCode[] {
  if (chain.kind === 'RERUN_STALE' || !chain.startStepCode) return [...CHAIN_STEPS];
  const index = CHAIN_STEPS.indexOf(chain.startStepCode);
  return index < 0 ? [] : CHAIN_STEPS.slice(index);
}

/** G2 자리에서 멈출 때: ②·③ 상태로 이유와 단계를 고른다(BE `stopAtG2`) */
function stopAtG2(w: DemoWorld): ChainPlan {
  const sourcing = w.s.steps.SOURCING.status;
  const pricing = w.s.steps.PRICING.status;
  if (sourcing === 'WAITING_INPUT')
    return { kind: 'stop', reason: 'AWAIT_G2', stepCode: 'SOURCING' };
  if (sourcing !== 'COMPLETED') {
    return { kind: 'stop', reason: 'NO_RUNNABLE_STEP', stepCode: 'SOURCING' };
  }
  if (pricing === 'COMPLETED' || pricing === 'WAITING_INPUT') {
    return { kind: 'stop', reason: 'AWAIT_G2', stepCode: 'PRICING' };
  }
  return { kind: 'stop', reason: 'NO_RUNNABLE_STEP', stepCode: 'PRICING' };
}

/** 끝까지 봤을 때: 필수 단계가 모두 완료면 남은 게이트(G2 → G3 → G4), 아니면 막힌 첫 단계(BE `stopAtEnd`) */
function stopAtEnd(w: DemoWorld): ChainPlan {
  const blocked = REQUIRED_STEPS.find((code) => !isCompleted(w, code));
  if (blocked) return { kind: 'stop', reason: 'NO_RUNNABLE_STEP', stepCode: blocked };
  if (!gateValid(w, 'G2')) return { kind: 'stop', reason: 'AWAIT_G2', stepCode: 'PRICING' };
  if (!gateValid(w, 'G3')) return { kind: 'stop', reason: 'AWAIT_G3', stepCode: 'THUMBNAIL' };
  return { kind: 'stop', reason: 'AWAIT_G4', stepCode: 'REGISTER' };
}

/**
 * 다음 행동 하나(BE `chain-planner.ts nextChainAction`). 완료·최신이라 건너뛰는 단계는 기록하고 다시 계획한다.
 * - FROM_HERE: 고른 단계는 상태와 관계없이 실행한다. 그 뒤 단계는 완료면 건너뛰고, 미실행·실패·재실행 필요면 시작 조건이 맞을 때 실행한다
 * - RERUN_STALE: 재실행 필요 단계만 흐름 순서로 실행하고, 그 사이 새로 재실행 필요가 된 단계도 잇는다(한 묶음에서 단계당 한 번)
 * - G2 자리(③ 뒤 ④ 앞): G2가 유효하지 않으면 멈춘다. G3 자리(⑧ 앞): ⑤가 완료인데 G3이 유효하지 않으면 멈춘다. 끝까지 가면 G4 앞에서 멈춘다
 * 6시간 규칙(판정에 쓴 라쿠텐 페이지가 오래됐으면 ② 재조회부터)은 체험 모델이 시간이 지나도 페이지를 다시 읽지 않아 두지 않았다.
 */
function planChain(w: DemoWorld, chain: ChainRec): ChainPlan {
  const status = (code: StepCode) => w.s.steps[code].status;
  const handled = (code: StepCode) => chain.ran.includes(code) || chain.skipped.includes(code);
  const fromHere = chain.kind === 'FROM_HERE';
  for (let guard = 0; guard <= CHAIN_STEPS.length + 1; guard += 1) {
    // 이 묶음이 연 실행이 아직 돈다 → 끝나면 다시 본다
    if (CHAIN_STEPS.some((code) => chain.ran.includes(code) && status(code) === 'RUNNING')) {
      return { kind: 'wait' };
    }
    const segment = chainSegment(chain);
    let skip: StepCode | null = null;
    for (const code of segment) {
      if (code === 'CATEGORY' && segment.includes('PRICING') && !gateValid(w, 'G2')) {
        return stopAtG2(w);
      }
      if (
        code === 'UPLOAD' &&
        !handled('UPLOAD') &&
        !gateValid(w, 'G3') &&
        status('THUMBNAIL') === 'COMPLETED' &&
        (fromHere || status('UPLOAD') === 'RERUN_REQUIRED')
      ) {
        return { kind: 'stop', reason: 'AWAIT_G3', stepCode: 'THUMBNAIL' };
      }
      if (handled(code)) continue;
      const current = status(code);
      const isStart = fromHere && code === chain.startStepCode;
      if (!(fromHere || current === 'RERUN_REQUIRED')) continue;
      if (fromHere && !isStart && current === 'COMPLETED') {
        skip = code;
        break;
      }
      if (current === 'RUNNING' || current === 'WAITING_INPUT') continue;
      if (runBlock(w, code, 'chain') === null) return { kind: 'run', code };
    }
    if (skip === null) return stopAtEnd(w);
    chain.skipped.push(skip);
  }
  return stopAtEnd(w);
}

function advanceChain(w: DemoWorld, chain: ChainRec): void {
  const plan = planChain(w, chain);
  if (plan.kind === 'wait') return;
  if (plan.kind === 'run') {
    try {
      startStep(w, plan.code, {}, chain);
      return;
    } catch {
      // 시작하지 못하면(실행기가 막음) 더 실행할 단계가 없는 것으로 닫는다
      closeChain(w, chain, 'NO_RUNNABLE_STEP', plan.code);
      return;
    }
  }
  closeChain(w, chain, plan.reason, plan.stepCode);
}

function closeChain(
  w: DemoWorld,
  chain: ChainRec,
  reason: StepChainStopReason,
  stepCode: StepCode | null,
): void {
  chain.endedAt = w.now();
  chain.stopReason = reason;
  chain.stopStepCode = stepCode;
}

// ── 게이트 · 여정 상태 ──────────────────────────────────────────────────────

/** 여정 상태를 바꾸고 이력에 남긴다(같은 상태면 아무것도 하지 않는다) */
export function setCandidateStatus(
  w: DemoWorld,
  to: CandidateStatus,
  reason: CandidateStatusReason,
  links: { stepRunId?: number | null; registrationId?: number | null } = {},
): void {
  const candidate = w.s.candidate;
  if (!candidate || candidate.status === to) return;
  const now = w.now();
  candidate.history.push({
    id: w.s.next.history++,
    from: candidate.status,
    to,
    reason,
    stepRunId: links.stepRunId ?? null,
    registrationId: links.registrationId ?? null,
    at: now,
  });
  candidate.status = to;
  candidate.statusChangedAt = now;
  candidate.updatedAt = now;
}

/** 승인 전 필수 값이 모두 있는가 */
function readyValues(candidate: CandidateRec): boolean {
  return (
    candidate.itemCode !== null &&
    candidate.anchorColorCode !== null &&
    candidate.gender !== null &&
    candidate.leafCategoryId !== null
  );
}

/**
 * 여정 상태 재평가(BE `reevaluate`): 필수 9단계 COMPLETED + G2·G3 유효 + 필수 값이면 작업중 → 승인대기, 반대로 승인대기·검증완료인데
 * 하나라도 어긋나면 작업중. 등록 쪽 상태(검증완료·등록요청중·등록됨)로 가는 것은 registration 도메인이 `setCandidateStatus`로 한다.
 */
export function reevaluate(
  w: DemoWorld,
  notCurrentReason: CandidateStatusReason = 'STEP_NOT_CURRENT',
): void {
  const candidate = w.s.candidate;
  if (!candidate) return;
  const allDone = REQUIRED_STEPS.every((code) => isCompleted(w, code));
  const gatesOk = gateValid(w, 'G2') && gateValid(w, 'G3');
  const ready = allDone && gatesOk && readyValues(candidate);
  if (candidate.status === 'WORKING' && ready) {
    setCandidateStatus(w, 'AWAITING_APPROVAL', 'READY_FOR_APPROVAL', {
      stepRunId: currentRun(w, 'UPLOAD')?.id ?? null,
    });
  } else if (
    (candidate.status === 'AWAITING_APPROVAL' || candidate.status === 'VALIDATED') &&
    !ready
  ) {
    setCandidateStatus(
      w,
      'WORKING',
      !allDone || !readyValues(candidate) ? notCurrentReason : 'GATE_FINGERPRINT_CHANGED',
    );
  }
}

/** 이어 할 단계(BE `resumeStepCode`): 입력 대기·미실행·실패·재실행 필요인 첫 단계. ⑨까지 끝나야 null */
export function resumeStepCode(w: DemoWorld): StepCode | null {
  const open = ['WAITING_INPUT', 'NOT_RUN', 'FAILED', 'RERUN_REQUIRED'];
  return STEP_FLOW.find((code) => open.includes(w.s.steps[code].status)) ?? null;
}

/** 지금 어떤 일이 돌고 있는가(체험 띠가 '잠시 기다려 주세요'를 보인다) */
export function isBusy(w: DemoWorld): boolean {
  return (
    w.s.keywords.snapshot?.status === 'RUNNING' ||
    STEP_FLOW.some((code) => w.s.steps[code].status === 'RUNNING') ||
    openChain(w) !== null ||
    w.s.registration.records.some((rec) => rec.status === 'REGISTERING')
  );
}
