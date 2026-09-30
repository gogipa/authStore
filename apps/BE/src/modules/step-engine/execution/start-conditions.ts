import type { StepInput } from '../contracts/step-runner.js';
import { COMPLETION_ONLY_INPUTS, inputKeysFromStep } from '../domain/step-graph.js';
import {
  CANDIDATE_INPUT_KEYS,
  STEP_GRAPH,
  stepStatusOf,
  type CandidateInputKey,
  type CandidateStatus,
  type StepCode,
  type StepStatusMap,
} from '../domain/steps.js';

/**
 * 단계 시작 조건(F-BS-16, PRD §5.3 '필수 시작 조건', 규칙 2). 순수 함수 — 실행 API의 409, 레일 `disabledReason`,
 * P1-04 `runnableStep`이 같이 쓴다.
 * - 필수 앞 단계는 현재 버전이 COMPLETED여야 한다(NOT_RUN·RUNNING·WAITING_INPUT·FAILED·RERUN_REQUIRED면 막는다).
 *   빠진 입력 키는 이 단계가 그 앞 단계에서 읽는 입력 키다(예 ③ ← ② `sourcing.targetSkus`).
 * - '선택' 앞 단계(⑦·⑥-3 ← ④)는 완료가 아니어도 막지 않는다(값 없이 실행한다).
 * - 조건만 맞으면 흐름 순서와 관계없이 실행한다(⑤는 ③ 없이 된다).
 */

/** 시작 조건 판단에 필요한 후보 값 */
export interface StartConditionCandidate {
  status: CandidateStatus;
  rakutenQuery: string | null;
  sourceUrl: string | null;
  anchorModelCode: string | null;
  anchorItemCode: string | null;
  gender: string | null;
}

/** candidate 행 → 시작 조건 판단 값 */
export function asStartCandidate(candidate: {
  status: string;
  rakutenQuery: string | null;
  sourceUrl: string | null;
  anchorModelCode: string | null;
  anchorItemCode: string | null;
  gender: string | null;
}): StartConditionCandidate {
  return {
    status: candidate.status as CandidateStatus,
    rakutenQuery: candidate.rakutenQuery,
    sourceUrl: candidate.sourceUrl,
    anchorModelCode: candidate.anchorModelCode,
    anchorItemCode: candidate.anchorItemCode,
    gender: candidate.gender,
  };
}

export function candidateFieldPresent(
  candidate: StartConditionCandidate,
  key: CandidateInputKey,
): boolean {
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

/** 단계 그래프로 본 빠진 시작 조건 입력 키(없으면 빈 배열) */
export function missingStartInputs(
  stepCode: StepCode,
  candidate: StartConditionCandidate,
  steps: StepStatusMap,
): string[] {
  const graph = STEP_GRAPH[stepCode];
  const missing: string[] = [];
  for (const required of graph.requires) {
    if (stepStatusOf(steps, required) === 'COMPLETED') continue;
    const keys = inputKeysFromStep(stepCode, required);
    // ⑤ ← ②처럼 완료만 보는 앞 단계(P3-01)는 그 입력 이름으로 알린다
    const completionOnly = COMPLETION_ONLY_INPUTS[stepCode]?.[required];
    missing.push(
      ...(keys.length > 0 ? keys : completionOnly ? [completionOnly] : [`step.${required}`]),
    );
  }
  for (const key of graph.candidateFields) {
    if (!candidateFieldPresent(candidate, key)) missing.push(key);
  }
  if (
    graph.anyOfCandidateFields.length > 0 &&
    !graph.anyOfCandidateFields.some((key) => candidateFieldPresent(candidate, key))
  ) {
    // ② 검색어·URL·앵커 키 중 하나: 대표 입력(검색어)으로 알린다
    missing.push(graph.anyOfCandidateFields[0]!);
  }
  return [...new Set(missing)];
}

/** 실행기가 읽은 입력 중 값이 없는 필수 시작 조건(설정 키·오너가 넣는 시작 조건 등) */
export function missingRequiredInputs(inputs: readonly StepInput[]): string[] {
  return inputs
    .filter(
      (input) =>
        input.isStartCondition &&
        input.required &&
        (input.value === null || input.value === undefined),
    )
    .map((input) => input.inputKey);
}
