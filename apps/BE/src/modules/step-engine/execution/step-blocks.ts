import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage, type ErrorCode } from '../../../common/errors/error-codes.js';
import type { FieldError } from '../../../common/errors/error-response.js';
import { inputKeyLabel } from '../domain/input-keys.js';
import type { GateFlags } from '../domain/resume.js';
import {
  isLockedStatus,
  STEP_GRAPH,
  STEP_LABEL,
  stepStatusOf,
  type CandidateStatus,
  type GateCode,
  type StepCode,
  type StepStatus,
  type StepStatusMap,
} from '../domain/steps.js';
import { missingStartInputs, type StartConditionCandidate } from './start-conditions.js';
import { editLockBlock, runLockBlock, type LockBlock } from './step-locks.js';

/**
 * 막힌 이유 하나(순수 값). code는 같은 동작의 API가 돌려줄 409·422·503 오류 코드와 같다. 실행 API·오너 수정 API는
 * `toApiException`으로, 단계 레일은 `toBlockReason`으로 같은 값을 쓴다(05-2 listCandidateSteps '한 곳에서 계산').
 */
export type StepBlock =
  | {
      code: 'INVALID_STEP_CODE';
      stepCode: StepCode;
      reason: 'NOT_RUNNABLE' | 'NO_RUNNER' | 'NOT_EDITABLE';
    }
  | { code: 'CANDIDATE_LOCKED'; status: CandidateStatus }
  | { code: 'CANDIDATE_EXCLUDED' }
  | { code: 'TEMP_CANDIDATE_NOT_ALLOWED'; stepCode: StepCode }
  | { code: 'SETTINGS_INVALID' }
  | LockBlock
  | { code: 'STEP_START_CONDITION_UNMET'; stepCode: StepCode; missingInputs: string[] }
  | { code: 'GATE_NOT_PASSED'; stepCode: StepCode; gate: GateCode }
  | { code: 'STEP_NOT_COMPLETED'; stepCode: StepCode; status: StepStatus };

/** 게이트 이름(문구 '{게이트}를 먼저 통과해 주세요.') */
export const GATE_NAME: Record<GateCode, string> = {
  G2: 'G2 판정 확정',
  G3: 'G3 썸네일 선택',
};

/** 단계 상태 글자(문구 '(지금: {상태})') */
export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  NOT_RUN: '미실행',
  RUNNING: '실행중',
  WAITING_INPUT: '입력 대기',
  COMPLETED: '완료',
  FAILED: '실패',
  RERUN_REQUIRED: '재실행 필요',
};

/** 오너가 값을 직접 고칠 수 있는 단계(05-1 표 B EDIT: COPY·NOTICE_RAW·NOTICE_HTML 필드, TAGS 추가·삭제) */
export const EDITABLE_STEPS: readonly StepCode[] = ['COPY', 'NOTICE_RAW', 'NOTICE_HTML', 'TAGS'];

export interface RunnableOptions {
  /**
   * 'run'(실행 API·레일 실행 버튼): 입력 대기 중인 자기 단계도 막는다(새 실행을 열지 않는다).
   * 'picker'(P1-04 입력 고르기): 입력 대기 중인 자기 단계는 고를 수 있다(화면을 열어 입력한다). 기본 'picker'
   */
  mode?: 'run' | 'picker';
  /** 실행기가 등록돼 있는가. false면 422 INVALID_STEP_CODE(P1-05 Proposed). 주지 않으면 보지 않는다 */
  hasRunner?: boolean;
  /** 설정 스냅샷이 로드돼 있는가. false면 503 SETTINGS_INVALID. 주지 않으면 보지 않는다 */
  settingsLoaded?: boolean;
}

function candidateBlock(
  stepCode: StepCode,
  candidate: Pick<StartConditionCandidate, 'status'>,
): StepBlock | null {
  if (isLockedStatus(candidate.status))
    return { code: 'CANDIDATE_LOCKED', status: candidate.status };
  if (candidate.status === 'EXCLUDED') return { code: 'CANDIDATE_EXCLUDED' };
  if (candidate.status === 'TEMP' && (stepCode === 'UPLOAD' || stepCode === 'REGISTER')) {
    return { code: 'TEMP_CANDIDATE_NOT_ALLOWED', stepCode };
  }
  return null;
}

/**
 * 이 후보에서 이 단계를 지금 실행할 수 있는지. 실행할 수 없으면 첫 이유(순서 = 실행 API가 검사하는 순서):
 * 단계 코드(⑨·실행기 없음 422) → 후보(잠금·제외·임시) → 설정 없음(503) → 실행 중 잠금 → 시작 조건 → 게이트(⑧ G3).
 */
export function checkStepRunnable(
  stepCode: StepCode,
  candidate: StartConditionCandidate,
  steps: StepStatusMap,
  gates: GateFlags,
  options: RunnableOptions = {},
): StepBlock | null {
  const graph = STEP_GRAPH[stepCode];
  if (!graph.stepRunnable) return { code: 'INVALID_STEP_CODE', stepCode, reason: 'NOT_RUNNABLE' };
  if (options.hasRunner === false) {
    return { code: 'INVALID_STEP_CODE', stepCode, reason: 'NO_RUNNER' };
  }
  const blocked = candidateBlock(stepCode, candidate);
  if (blocked) return blocked;
  if (options.settingsLoaded === false) return { code: 'SETTINGS_INVALID' };

  const lock = runLockBlock(stepCode, steps, { allowWaitingSelf: options.mode !== 'run' });
  if (lock) return lock;

  const missingInputs = missingStartInputs(stepCode, candidate, steps);
  if (missingInputs.length > 0) {
    return { code: 'STEP_START_CONDITION_UNMET', stepCode, missingInputs };
  }
  for (const gate of graph.gates) {
    if (!gates[gate]) return { code: 'GATE_NOT_PASSED', stepCode, gate };
  }
  return null;
}

/**
 * 오너 값 편집(EDIT)을 지금 할 수 있는지(레일 `actions.edit`, 오너 수정 API EDIT 공통 검사).
 * 편집 단계 아님·실행기 없음(422) → 후보(잠금·제외) → 수정 잠금 → 현재 버전이 완료·재실행 필요가 아님(409 STEP_NOT_COMPLETED).
 */
export function checkStepEditable(
  stepCode: StepCode,
  candidate: Pick<StartConditionCandidate, 'status'>,
  steps: StepStatusMap,
  options: { hasRunner?: boolean } = {},
): StepBlock | null {
  if (!EDITABLE_STEPS.includes(stepCode)) {
    return { code: 'INVALID_STEP_CODE', stepCode, reason: 'NOT_EDITABLE' };
  }
  if (options.hasRunner === false) {
    return { code: 'INVALID_STEP_CODE', stepCode, reason: 'NO_RUNNER' };
  }
  if (isLockedStatus(candidate.status))
    return { code: 'CANDIDATE_LOCKED', status: candidate.status };
  if (candidate.status === 'EXCLUDED') return { code: 'CANDIDATE_EXCLUDED' };
  const lock = editLockBlock(stepCode, steps);
  if (lock) return lock;
  const status = stepStatusOf(steps, stepCode);
  if (status !== 'COMPLETED' && status !== 'RERUN_REQUIRED') {
    return { code: 'STEP_NOT_COMPLETED', stepCode, status };
  }
  return null;
}

/** 막힌 이유 → 오류 봉투 재료(code·message·details·fieldErrors) */
export interface BlockReason {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  fieldErrors?: FieldError[];
}

const INVALID_STEP_MESSAGE: Record<'NOT_RUNNABLE' | 'NO_RUNNER' | 'NOT_EDITABLE', string> = {
  NOT_RUNNABLE: '최종 승인(G4)에서만 등록합니다.',
  NO_RUNNER: '이 단계는 아직 준비 중이라 실행할 수 없습니다.',
  NOT_EDITABLE: '이 단계는 값을 직접 고칠 수 없습니다. 이전 버전 다시 고르기만 됩니다.',
};

/** 입력 대기 중인 단계에 새 실행·수정을 요청했을 때(P1-05 Proposed, 코드는 STEP_ALREADY_RUNNING) */
export const WAITING_INPUT_MESSAGE =
  '이 단계가 입력을 기다리고 있습니다. 입력을 마치면 이어서 실행됩니다.';

export function toBlockReason(block: StepBlock): BlockReason {
  switch (block.code) {
    case 'INVALID_STEP_CODE':
      return {
        code: block.code,
        message: INVALID_STEP_MESSAGE[block.reason],
        details: { stepCode: block.stepCode, reason: block.reason },
      };
    case 'CANDIDATE_LOCKED':
      return {
        code: block.code,
        message: formatErrorMessage(block.code),
        details: { status: block.status },
      };
    case 'CANDIDATE_EXCLUDED':
    case 'SETTINGS_INVALID':
      return { code: block.code, message: formatErrorMessage(block.code) };
    case 'TEMP_CANDIDATE_NOT_ALLOWED':
      return {
        code: block.code,
        message: formatErrorMessage(block.code),
        details: { stepCode: block.stepCode },
      };
    case 'STEP_ALREADY_RUNNING':
      return {
        code: block.code,
        message:
          block.status === 'WAITING_INPUT' ? WAITING_INPUT_MESSAGE : formatErrorMessage(block.code),
        details: { stepCode: block.stepCode, status: block.status },
      };
    case 'STEP_LOCKED_BY_RUNNING_STEP':
      return {
        code: block.code,
        message: formatErrorMessage(block.code, { 단계: STEP_LABEL[block.runningStepCode] }),
        details: { stepCode: block.runningStepCode },
      };
    case 'STEP_START_CONDITION_UNMET':
      return {
        code: block.code,
        message: formatErrorMessage(block.code, {
          '빠진 입력': block.missingInputs.map(inputKeyLabel).join(', '),
        }),
        details: { stepCode: block.stepCode },
        fieldErrors: block.missingInputs.map((field) => ({
          field,
          message: `${inputKeyLabel(field)} 값이 필요합니다.`,
        })),
      };
    case 'GATE_NOT_PASSED':
      return {
        code: block.code,
        message: formatErrorMessage(block.code, { 게이트: GATE_NAME[block.gate] }),
        details: { stepCode: block.stepCode, gate: block.gate },
      };
    case 'STEP_NOT_COMPLETED':
      return {
        code: block.code,
        message: formatErrorMessage(block.code, {
          단계: STEP_LABEL[block.stepCode],
          상태: STEP_STATUS_LABEL[block.status],
        }),
        details: { stepCode: block.stepCode, status: block.status },
      };
  }
}

export function toApiException(block: StepBlock): ApiException {
  const reason = toBlockReason(block);
  return new ApiException(reason.code, {
    message: reason.message,
    details: reason.details,
    fieldErrors: reason.fieldErrors,
  });
}
