import type { GateFlags } from '../domain/resume.js';
import {
  REQUIRED_STEPS,
  STEP_FLOW,
  stepStatusOf,
  type StepCode,
  type StepStatusMap,
} from '../domain/steps.js';
import type { StartConditionCandidate } from '../execution/start-conditions.js';
import { checkStepRunnable } from '../execution/step-blocks.js';

/**
 * 연속 실행 계획(F-CW-14·15·16, PRD §5.3 '연속 실행 세부'·'재실행 필요' 규칙 5, P1-06 규칙 1~6). 순수 함수 —
 * 연속 실행 서비스가 단계가 끝날 때마다 지금 상태로 `nextChainAction`을 불러 다음 행동 하나를 받는다.
 *
 * 순서: ② → ③ → [G2] → ④ → ⑤ → ⑥-1 → ⑥-2 → ⑥-3 → ⑦ → [G3] → ⑧ → [G4]. ⑨는 G4 승인으로만 돈다.
 * - FROM_HERE: 고른 단계는 상태와 관계없이 실행한다. 그 뒤 단계는 완료·최신(COMPLETED)이면 건너뛴다(`skip`).
 *   미실행·실패·재실행 필요면 시작 조건이 맞을 때 실행하고, 입력 대기·실행 중(다른 실행)이면 막힌 것으로 둔다.
 * - RERUN_STALE: 재실행 필요(RERUN_REQUIRED) 단계만 흐름 순서로 실행하고, 그 사이 새로 재실행 필요가 된 단계도 잇는다.
 *   한 묶음에서 단계마다 `CHAIN_RUN_LIMIT`번까지만 실행한다(끝없는 반복 방지, Proposed).
 * - 막힌 단계(입력 대기·실패·시작 조건 미충족)의 결과를 직·간접으로 읽는 단계만 시작 조건(`checkStepRunnable`)에 걸려
 *   실행하지 않고, 나머지는 계속한다(G2 뒤).
 * - 6시간 규칙: 판정에 쓴 라쿠텐 페이지 수집 시각이 판정 유효 시간을 넘었으면(`judgementPageStale`) ③을 건너뛰지 않고,
 *   이 묶음에서 ②를 아직 돌리지 않았으면 ② 재조회(`refetch`)부터 한다. 후보 상태의 '최신'에는 쓰지 않는다.
 * - 게이트: G2 자리(③ 뒤)에서 G2가 유효하지 않으면 멈춘다(AWAIT_G2). G3 자리(⑧ 앞)에서 ⑤가 완료인데 G3이 유효하지 않으면
 *   멈춘다(AWAIT_G3). 이미 통과했고 지문이 그대로인 게이트는 넘어간다. 끝까지 가면 AWAIT_G4, 더 실행할 단계가 없으면
 *   NO_RUNNABLE_STEP.
 * - 멈춘 단계(`stop_step_code`, Proposed): AWAIT_G2 = PRICING(② 입력 대기면 SOURCING), AWAIT_G3 = THUMBNAIL(G3을 고르는
 *   ⑤), AWAIT_G4 = REGISTER(최종 승인 뒤 ⑨), NO_RUNNABLE_STEP = 흐름 순서로 첫 '완료가 아닌' 필수 단계(막힌 곳).
 */

/** 연속 실행 종류(ERD step_chain.kind) */
export type ChainKind = 'FROM_HERE' | 'RERUN_STALE';

/** 멈춘 이유(ERD step_chain.stop_reason). APP_RESTART는 재시작 정리만 쓴다 */
export type ChainStopReason = 'AWAIT_G2' | 'AWAIT_G3' | 'AWAIT_G4' | 'NO_RUNNABLE_STEP';

/** 연속 실행이 도는 단계(⑨ 제외) */
export const CHAIN_STEPS: readonly StepCode[] = STEP_FLOW.filter((code) => code !== 'REGISTER');

/** G2 전에 연속 실행을 시작할 수 있는 단계(F-CW-15) */
export const BEFORE_G2_CHAIN_STARTS: readonly StepCode[] = ['SOURCING', 'PRICING'];

/** 한 묶음에서 한 단계를 실행하는 최대 횟수(RERUN_STALE 끝없는 반복 방지, P1-06 Proposed) */
export const CHAIN_RUN_LIMIT = 1;

/** 계획에 넘기는 지금 상태 */
export interface ChainState {
  kind: ChainKind;
  /** FROM_HERE의 고른 단계(RERUN_STALE은 null) */
  startStepCode: StepCode | null;
  /** 시작 조건 판단에 필요한 후보 값 */
  candidate: StartConditionCandidate;
  /** 단계 레일 10칸의 상태 */
  steps: StepStatusMap;
  /** G2·G3 유효(지문 일치) */
  gates: GateFlags;
  /** ③ 판정에 쓴 라쿠텐 페이지가 판정 유효 시간(기본 6시간)을 넘었는가 */
  judgementPageStale: boolean;
  /** 이 묶음 안에서 단계별로 만든 실행 수(step_run.step_chain_id) */
  runs: Partial<Record<StepCode, number>>;
  /** 이 묶음이 완료·최신이라 건너뛴 단계(step_chain.skipped_step_codes) */
  skipped: readonly StepCode[];
  /** 실행기가 등록되지 않은 단계(실행할 수 없어 막힌 것으로 둔다). 주지 않으면 모두 있다고 본다 */
  missingRunners?: readonly StepCode[];
}

/** 다음 행동 하나 */
export type ChainAction =
  /** 이 단계를 실행한다. refetch = 6시간 규칙의 ② 재조회 */
  | { run: StepCode; refetch: boolean }
  /** 완료·최신이라 건너뛴다(기록하고 다시 계획한다) */
  | { skip: StepCode }
  /** 이 묶음의 실행이 아직 돌고 있다. 끝나면 다시 계획한다 */
  | { wait: StepCode }
  /** 멈춘다(묶음을 닫는다) */
  | { stop: ChainStopReason; stepCode: StepCode | null };

/** 시작을 막는 이유(API 409) */
export type ChainStartBlock = 'CONTINUOUS_RUN_BEFORE_G2' | 'NO_RERUN_REQUIRED_STEPS';

/** 시작 검사(규칙 4·6): G2 전 FROM_HERE는 ②·③에서만, RERUN_STALE은 재실행 필요 단계가 있어야 한다 */
export function checkChainStart(
  state: Pick<ChainState, 'kind' | 'startStepCode' | 'steps' | 'gates'>,
): ChainStartBlock | null {
  if (state.kind === 'FROM_HERE') {
    const start = state.startStepCode;
    if (start && !state.gates.G2 && !BEFORE_G2_CHAIN_STARTS.includes(start)) {
      return 'CONTINUOUS_RUN_BEFORE_G2';
    }
    return null;
  }
  const targets = CHAIN_STEPS.filter(
    (code) => stepStatusOf(state.steps, code) === 'RERUN_REQUIRED',
  );
  if (targets.length === 0) return 'NO_RERUN_REQUIRED_STEPS';
  // G2 전에는 ②·③ 밖의 재실행 필요 단계만 남았으면 연속으로 돌지 않는다(G2에서 멈추는 규칙과 같다)
  if (!state.gates.G2 && targets.every((code) => !BEFORE_G2_CHAIN_STARTS.includes(code))) {
    return 'CONTINUOUS_RUN_BEFORE_G2';
  }
  return null;
}

/** 이 묶음에서 이 단계를 몇 번 실행했나 */
export function chainRunCount(state: Pick<ChainState, 'runs'>, code: StepCode): number {
  return state.runs[code] ?? 0;
}

/** 묶음이 도는 단계 목록(FROM_HERE = 고른 단계부터, RERUN_STALE = 전부) */
export function chainSegment(state: Pick<ChainState, 'kind' | 'startStepCode'>): StepCode[] {
  if (state.kind === 'RERUN_STALE' || !state.startStepCode) return [...CHAIN_STEPS];
  const index = CHAIN_STEPS.indexOf(state.startStepCode);
  return index < 0 ? [] : CHAIN_STEPS.slice(index);
}

/** G2 자리에서 멈출 때: ②·③ 상태로 이유와 단계를 고른다 */
function stopAtG2(state: ChainState): ChainAction {
  const sourcing = stepStatusOf(state.steps, 'SOURCING');
  const pricing = stepStatusOf(state.steps, 'PRICING');
  if (sourcing === 'WAITING_INPUT') return { stop: 'AWAIT_G2', stepCode: 'SOURCING' };
  if (sourcing !== 'COMPLETED') return { stop: 'NO_RUNNABLE_STEP', stepCode: 'SOURCING' };
  if (pricing === 'COMPLETED' || pricing === 'WAITING_INPUT') {
    return { stop: 'AWAIT_G2', stepCode: 'PRICING' };
  }
  return { stop: 'NO_RUNNABLE_STEP', stepCode: 'PRICING' };
}

/** 끝까지 봤을 때: 필수 단계가 모두 완료면 남은 게이트(G2 → G3 → G4), 아니면 막힌 첫 단계 */
function stopAtEnd(state: ChainState): ChainAction {
  const blocked = REQUIRED_STEPS.find((code) => stepStatusOf(state.steps, code) !== 'COMPLETED');
  if (blocked) return { stop: 'NO_RUNNABLE_STEP', stepCode: blocked };
  if (!state.gates.G2) return { stop: 'AWAIT_G2', stepCode: 'PRICING' };
  if (!state.gates.G3) return { stop: 'AWAIT_G3', stepCode: 'THUMBNAIL' };
  return { stop: 'AWAIT_G4', stepCode: 'REGISTER' };
}

/** 다음 행동(한 번에 하나). 서비스는 `skip`이면 기록하고 다시 부른다 */
export function nextChainAction(state: ChainState): ChainAction {
  const status = (code: StepCode) => stepStatusOf(state.steps, code);
  const ran = (code: StepCode) => chainRunCount(state, code) > 0;
  // 실행 한도를 채운 단계는 다시 실행하지 않는다(재실행 필요가 다시 붙어도 그대로 두고 막힌 곳으로 알린다)
  const handled = (code: StepCode) =>
    chainRunCount(state, code) >= CHAIN_RUN_LIMIT || state.skipped.includes(code);
  const runnable = (code: StepCode) =>
    checkStepRunnable(code, state.candidate, state.steps, state.gates, {
      mode: 'run',
      hasRunner: !(state.missingRunners ?? []).includes(code),
    }) === null;
  const fromHere = state.kind === 'FROM_HERE';

  // 이 묶음이 연 실행이 아직 돈다(입력 대기에서 이어 간 실행 등) → 끝나면 다시 본다
  const own = CHAIN_STEPS.find((code) => ran(code) && status(code) === 'RUNNING');
  if (own) return { wait: own };

  const segment = chainSegment(state);
  for (const code of segment) {
    // [G2] ③ 뒤·④ 앞. ③이 묶음 안에 있을 때만 여기서 본다(④ 이후에서 시작하면 시작 때 G2 유효를 확인했다)
    if (code === 'CATEGORY' && segment.includes('PRICING') && !state.gates.G2) {
      return stopAtG2(state);
    }
    // [G3] ⑧ 앞. ⑤가 완료인데 G3이 유효하지 않으면 멈춘다(⑤가 입력 대기·실패면 ⑧이 시작 조건에서 막힌다)
    if (
      code === 'UPLOAD' &&
      !handled('UPLOAD') &&
      !state.gates.G3 &&
      status('THUMBNAIL') === 'COMPLETED' &&
      (fromHere || status('UPLOAD') === 'RERUN_REQUIRED')
    ) {
      return { stop: 'AWAIT_G3', stepCode: 'THUMBNAIL' };
    }
    if (handled(code)) continue;

    const current = status(code);
    const isStart = fromHere && code === state.startStepCode;
    const target = fromHere || current === 'RERUN_REQUIRED';
    if (!target) continue;

    // 6시간 규칙: ③을 다시 판정하기 전에 ②를 다시 조회한다(이 묶음에서 ②를 아직 안 돌렸을 때만)
    const pageStale = code === 'PRICING' && state.judgementPageStale;
    if (
      pageStale &&
      !ran('SOURCING') &&
      current !== 'RUNNING' &&
      current !== 'WAITING_INPUT' &&
      runnable('SOURCING')
    ) {
      return { run: 'SOURCING', refetch: true };
    }
    if (fromHere && !isStart && current === 'COMPLETED' && !pageStale) return { skip: code };
    if (current === 'RUNNING' || current === 'WAITING_INPUT') continue;
    if (runnable(code)) return { run: code, refetch: false };
  }
  return stopAtEnd(state);
}
