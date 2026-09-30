import { downstreamSteps, upstreamSteps } from '../domain/step-graph.js';
import { STEP_FLOW, stepStatusOf, type StepCode, type StepStatusMap } from '../domain/steps.js';

/**
 * 실행 중 잠금(F-CW-18, PRD §5.3 '동시 실행과 잠금', 규칙 9). 순수 함수 — 실행 API의 409, 레일 `disabledReason`,
 * P1-04 `runnableStep`이 같이 쓴다.
 * - 같은 단계의 열린 실행(실행중·입력 대기, `uq_step_run_one_open`)이 있으면 새 실행·수정을 열지 않는다(409 STEP_ALREADY_RUNNING).
 *   입력 대기 중인 단계에 새 실행 요청이 오면 새 실행을 열지 않는다(ERD §7.1-15 기본안, P1-05 Proposed).
 * - 단계 X가 RUNNING이면 X를 직·간접으로 읽는 단계의 실행과, X가 직·간접으로 읽는 앞 단계의 실행·수정을 막는다
 *   (409 STEP_LOCKED_BY_RUNNING_STEP).
 * - 입력 대기는 다른 단계를 잠그지 않는다.
 */
export type LockBlock =
  | { code: 'STEP_ALREADY_RUNNING'; stepCode: StepCode; status: 'RUNNING' | 'WAITING_INPUT' }
  | { code: 'STEP_LOCKED_BY_RUNNING_STEP'; stepCode: StepCode; runningStepCode: StepCode };

/** 같은 단계의 열린 실행 */
function selfOpenBlock(
  stepCode: StepCode,
  steps: StepStatusMap,
  allowWaitingSelf: boolean,
): LockBlock | null {
  const status = stepStatusOf(steps, stepCode);
  if (status === 'RUNNING') return { code: 'STEP_ALREADY_RUNNING', stepCode, status };
  if (status === 'WAITING_INPUT' && !allowWaitingSelf) {
    return { code: 'STEP_ALREADY_RUNNING', stepCode, status };
  }
  return null;
}

function firstRunningAmong(steps: StepStatusMap, among: ReadonlySet<StepCode>): StepCode | null {
  return (
    STEP_FLOW.find((code) => among.has(code) && stepStatusOf(steps, code) === 'RUNNING') ?? null
  );
}

/**
 * 실행 잠금: 같은 단계의 열린 실행 → 앞(이 단계가 읽는)·뒤(이 단계를 읽는) 단계의 실행 중.
 * `allowWaitingSelf`(입력 고르기 목록): 입력 대기 중인 자기 단계는 막지 않는다(화면을 열어 입력한다).
 */
export function runLockBlock(
  stepCode: StepCode,
  steps: StepStatusMap,
  options: { allowWaitingSelf?: boolean } = {},
): LockBlock | null {
  const self = selfOpenBlock(stepCode, steps, options.allowWaitingSelf ?? false);
  if (self) return self;
  const related = new Set([...upstreamSteps(stepCode), ...downstreamSteps(stepCode)]);
  const running = firstRunningAmong(steps, related);
  return running
    ? { code: 'STEP_LOCKED_BY_RUNNING_STEP', stepCode, runningStepCode: running }
    : null;
}

/**
 * 수정 잠금(오너 수정·그대로 유지·이전 버전 다시 고르기): 같은 단계의 열린 실행 → 이 단계를 직·간접으로 읽는 단계의
 * 실행 중. 이 단계가 읽는 앞 단계가 실행 중인 것은 수정을 막지 않는다(수정은 앞 단계를 바꾸지 않는다).
 */
export function editLockBlock(stepCode: StepCode, steps: StepStatusMap): LockBlock | null {
  const self = selfOpenBlock(stepCode, steps, false);
  if (self) return self;
  const running = firstRunningAmong(steps, downstreamSteps(stepCode));
  return running
    ? { code: 'STEP_LOCKED_BY_RUNNING_STEP', stepCode, runningStepCode: running }
    : null;
}

/** 입력 대기에서 이어 가기 잠금: 자기 자신은 빼고 앞·뒤 단계의 실행 중만 본다 */
export function resumeLockBlock(stepCode: StepCode, steps: StepStatusMap): LockBlock | null {
  const related = new Set([...upstreamSteps(stepCode), ...downstreamSteps(stepCode)]);
  const running = firstRunningAmong(steps, related);
  return running
    ? { code: 'STEP_LOCKED_BY_RUNNING_STEP', stepCode, runningStepCode: running }
    : null;
}
