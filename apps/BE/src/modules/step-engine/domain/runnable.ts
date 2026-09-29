import type { GateFlags } from './resume.js';
import {
  CANDIDATE_INPUT_KEYS,
  downstreamSteps,
  isLockedStatus,
  STEP_FLOW,
  STEP_GRAPH,
  stepStatusOf,
  upstreamSteps,
  type CandidateInputKey,
  type CandidateStatus,
  type StepCode,
  type StepStatusMap,
} from './steps.js';

/** '지금 실행 가능' 판단에 필요한 후보 값 */
export interface RunnableCandidate {
  status: CandidateStatus;
  rakutenQuery: string | null;
  sourceUrl: string | null;
  anchorModelCode: string | null;
  anchorItemCode: string | null;
  gender: string | null;
}

/**
 * 실행할 수 없는 이유. code는 단계 실행 API(05-1 표 A)의 409·422 코드와 같다(레일의 disabledReason.code도 같은 값).
 */
export type RunnableBlock =
  | { code: 'INVALID_STEP_CODE'; stepCode: StepCode }
  | { code: 'CANDIDATE_LOCKED'; status: CandidateStatus }
  | { code: 'CANDIDATE_EXCLUDED' }
  | { code: 'TEMP_CANDIDATE_NOT_ALLOWED'; stepCode: StepCode }
  | { code: 'STEP_ALREADY_RUNNING'; stepCode: StepCode }
  | { code: 'STEP_LOCKED_BY_RUNNING_STEP'; stepCode: StepCode; runningStepCode: StepCode }
  | { code: 'STEP_START_CONDITION_UNMET'; stepCode: StepCode; missingInputs: string[] }
  | { code: 'GATE_NOT_PASSED'; stepCode: StepCode; gate: 'G2' | 'G3' };

function candidateFieldPresent(candidate: RunnableCandidate, key: CandidateInputKey): boolean {
  switch (key) {
    case CANDIDATE_INPUT_KEYS.gender:
      return candidate.gender !== null;
    case CANDIDATE_INPUT_KEYS.rakutenQuery:
      return candidate.rakutenQuery !== null && candidate.rakutenQuery !== '';
    case CANDIDATE_INPUT_KEYS.sourceUrl:
      return candidate.sourceUrl !== null;
    case CANDIDATE_INPUT_KEYS.anchorKey:
      return candidate.anchorModelCode !== null || candidate.anchorItemCode !== null;
  }
}

/**
 * 이 후보에서 이 단계를 지금 실행할 수 있는지(F-CW-22 입력 고르기, 05-1 §2.1 runnableStep). 실행할 수 없으면 첫 이유.
 * - 잠김(등록 진행)·제외 후보는 안 된다. 임시 후보는 ⑧·⑨를 돌릴 수 없다(PRD §5.2).
 * - 필수 앞 단계가 모두 COMPLETED이고 필수 후보 필드가 있어야 한다(PRD §5.3 시작 조건 표).
 * - 이 단계·이 단계가 읽는 앞 단계·이 단계를 읽는 뒷단계가 실행 중이면 안 된다(PRD §5.3 동시 실행과 잠금).
 *   입력 대기는 실행 중이 아니라서 잠그지 않는다.
 * - ⑧은 G3이 유효해야 한다. ⑨는 단계 실행으로 돌리지 않는다(G4 승인으로만).
 * 단계 레일의 '실행' 버튼 계산과 같은 함수다. P1-05가 설정·오너 입력 키까지 넓힌다(execution/start-conditions).
 */
export function checkStepRunnable(
  stepCode: StepCode,
  candidate: RunnableCandidate,
  steps: StepStatusMap,
  gates: GateFlags,
): RunnableBlock | null {
  const graph = STEP_GRAPH[stepCode];
  if (!graph.stepRunnable) return { code: 'INVALID_STEP_CODE', stepCode };
  if (isLockedStatus(candidate.status))
    return { code: 'CANDIDATE_LOCKED', status: candidate.status };
  if (candidate.status === 'EXCLUDED') return { code: 'CANDIDATE_EXCLUDED' };
  if (candidate.status === 'TEMP' && (stepCode === 'UPLOAD' || stepCode === 'REGISTER')) {
    return { code: 'TEMP_CANDIDATE_NOT_ALLOWED', stepCode };
  }

  if (stepStatusOf(steps, stepCode) === 'RUNNING')
    return { code: 'STEP_ALREADY_RUNNING', stepCode };
  const related = new Set([...upstreamSteps(stepCode), ...downstreamSteps(stepCode)]);
  const running = STEP_FLOW.find(
    (code) => related.has(code) && stepStatusOf(steps, code) === 'RUNNING',
  );
  if (running) return { code: 'STEP_LOCKED_BY_RUNNING_STEP', stepCode, runningStepCode: running };

  const missingInputs: string[] = [];
  for (const required of graph.requires) {
    if (stepStatusOf(steps, required) !== 'COMPLETED') missingInputs.push(`step.${required}`);
  }
  for (const key of graph.candidateFields) {
    if (!candidateFieldPresent(candidate, key)) missingInputs.push(key);
  }
  if (
    graph.anyOfCandidateFields.length > 0 &&
    !graph.anyOfCandidateFields.some((key) => candidateFieldPresent(candidate, key))
  ) {
    missingInputs.push(graph.anyOfCandidateFields.join('|'));
  }
  if (missingInputs.length > 0) {
    return { code: 'STEP_START_CONDITION_UNMET', stepCode, missingInputs };
  }

  for (const gate of graph.gates) {
    if (!gates[gate]) return { code: 'GATE_NOT_PASSED', stepCode, gate };
  }
  return null;
}

export function canRunStep(
  stepCode: StepCode,
  candidate: RunnableCandidate,
  steps: StepStatusMap,
  gates: GateFlags,
): boolean {
  return checkStepRunnable(stepCode, candidate, steps, gates) === null;
}
