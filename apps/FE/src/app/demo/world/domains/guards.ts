import type { StepCode } from '@/shared/lib/steps';
import type { DemoWorld } from '../../demoWorld';
import { candidateLockBlock, currentRun } from '../engine';
import {
  httpError,
  STEP_LABEL,
  STEP_STATUS_TEXT,
  withObject,
  withSubject,
  type DemoErrorExtra,
} from '../errors';
import type { RunRec, StepStatus } from '../state';
import { STEP_FLOW } from '../steps';

/**
 * ③④⑤ 도메인이 같이 쓰는 검사(BE `CandidateGuardService`·`GateService`의 막힌 이유). 문구는 BE 오류 표 그대로다.
 */

/** 값을 바꾸는 요청의 기본 검사: 등록 진행 잠금(409 CANDIDATE_LOCKED) → 제외 여정(409 CANDIDATE_EXCLUDED) */
export function assertMutable(w: DemoWorld): void {
  const candidate = w.candidate();
  const lock = candidateLockBlock(candidate);
  if (lock) throw lock;
  if (candidate.status === 'EXCLUDED') {
    throw httpError(
      409,
      'CANDIDATE_EXCLUDED',
      "제외된 여정입니다. '다시 작업'을 먼저 눌러 주세요.",
    );
  }
}

/** 이 단계가 읽는 앞 단계(②)가 실행 중이면 통과·고르기를 막는다(409 STEP_LOCKED_BY_RUNNING_STEP) */
export function assertSourcingIdle(w: DemoWorld): void {
  if (w.s.steps.SOURCING.status === 'RUNNING') {
    throw stepLocked('SOURCING');
  }
}

/** 409 STEP_LOCKED_BY_RUNNING_STEP. `details`의 기본은 BE 단계 엔진과 같은 `{stepCode: 실행 중인 단계}` */
export function stepLocked(
  runningStepCode: StepCode,
  details: Record<string, unknown> = { stepCode: runningStepCode },
) {
  return httpError(
    409,
    'STEP_LOCKED_BY_RUNNING_STEP',
    `${withSubject(STEP_LABEL[runningStepCode])} 실행 중이라 지금은 할 수 없습니다. 끝난 뒤 다시 해 주세요.`,
    { details },
  );
}

/** 입력 대기가 아닌 실행에 입력을 보냈다(409 STEP_RUN_NOT_WAITING_INPUT) */
export const notWaitingInput = (details?: Record<string, unknown>) =>
  httpError(
    409,
    'STEP_RUN_NOT_WAITING_INPUT',
    '이 실행은 입력을 기다리고 있지 않습니다. 바꾸려면 다시 실행하거나 수정해 주세요.',
    details ? { details } : undefined,
  );

/** 화면이 본 버전이 현재 버전이 아니다(409 VERSION_NOT_CURRENT) */
export const versionNotCurrent = (stepCode: StepCode, currentStepRunId: number | null) =>
  httpError(
    409,
    'VERSION_NOT_CURRENT',
    '화면을 연 뒤 값이 바뀌었습니다. 새로 고친 뒤 다시 해 주세요.',
    { details: { stepCode, currentStepRunId } },
  );

/** 근거 단계가 끝나지 않았다(409 STEP_NOT_COMPLETED) */
export const stepNotCompleted = (stepCode: StepCode, status: StepStatus) =>
  httpError(
    409,
    'STEP_NOT_COMPLETED',
    `${withSubject(STEP_LABEL[stepCode])} 아직 완료되지 않았습니다(지금: ${STEP_STATUS_TEXT[status]}).`,
    { details: { stepCode, status } },
  );

/** 단계 산출물이 아직 없다(404 STEP_OUTPUT_NOT_FOUND) */
export const outputNotFound = (stepCode: StepCode) =>
  httpError(
    404,
    'STEP_OUTPUT_NOT_FOUND',
    `아직 ${withObject(STEP_LABEL[stepCode])} 실행하지 않았습니다.`,
    { details: { stepCode } },
  );

export const stepRunNotFound = () =>
  httpError(404, 'STEP_RUN_NOT_FOUND', '실행 기록을 찾을 수 없습니다.');

/** 이 실행 id가 어느 단계의 몇 번째 실행인가(없으면 null) */
export function findStepRun(
  w: DemoWorld,
  stepRunId: number,
): { code: StepCode; run: RunRec } | null {
  for (const code of STEP_FLOW) {
    const run = w.s.steps[code].runs.find((r) => r.id === stepRunId);
    if (run) return { code, run };
  }
  return null;
}

const ID_TEXT = /^[1-9]\d{0,9}$/;

/** 경로의 실행 id: 1 이상 int4 정수가 아니면 그런 실행은 없다(404 STEP_RUN_NOT_FOUND) */
export function stepRunIdOf(text: string | undefined): number {
  if (typeof text === 'string' && ID_TEXT.test(text) && Number(text) <= 2_147_483_647) {
    return Number(text);
  }
  throw stepRunNotFound();
}

/** 그 단계의 실행이 아니면 422 INVALID_STEP_CODE(예: 레퍼런스를 ⑤ 아닌 실행에 보냄) */
export function assertStepRun(w: DemoWorld, stepRunId: number, code: StepCode, reason: string) {
  const found = findStepRun(w, stepRunId);
  if (!found) throw stepRunNotFound();
  if (found.code !== code) {
    throw httpError(422, 'INVALID_STEP_CODE', '이 단계는 여기서 실행하거나 고칠 수 없습니다.', {
      details: { stepCode: found.code, reason },
    });
  }
  return found.run;
}

/** 이 단계의 실행이 지금 입력 대기인 현재 버전인가 */
export function isWaitingCurrent(w: DemoWorld, code: StepCode, run: RunRec): boolean {
  const current = currentRun(w, code);
  return w.s.steps[code].status === 'WAITING_INPUT' && current?.id === run.id;
}

// ── 요청 본문 모양 검사(BE class-validator 문구) ──────────────────────────────────

export type FieldErrors = NonNullable<DemoErrorExtra['fieldErrors']>;

/** 칸 오류가 하나라도 있으면 422 VALIDATION_FAILED */
export function throwIfFieldErrors(fieldErrors: FieldErrors): void {
  if (fieldErrors.length > 0) {
    throw httpError(422, 'VALIDATION_FAILED', '입력값을 확인해 주세요.', { fieldErrors });
  }
}

export const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

/** 1 이상 int4 정수 */
export const isId = (value: unknown): value is number =>
  isInt(value) && value >= 1 && value <= 2_147_483_647;

/** 쿼리 키가 허용 목록 밖이면 422 INVALID_QUERY_PARAMETER */
export function assertQueryKeys(query: URLSearchParams, allowed: readonly string[]): void {
  for (const key of query.keys()) {
    if (!allowed.includes(key)) {
      throw httpError(422, 'INVALID_QUERY_PARAMETER', '목록 조건이 올바르지 않습니다.', {
        fieldErrors: [{ field: key, message: '받지 않는 조건입니다.' }],
      });
    }
  }
}

export const invalidQuery = (field: string, message: string) =>
  httpError(422, 'INVALID_QUERY_PARAMETER', '목록 조건이 올바르지 않습니다.', {
    fieldErrors: [{ field, message }],
  });

/** 쿼리 `stepRunId`(1 이상 정수) — 없으면 null */
export function stepRunIdQuery(query: URLSearchParams): number | null {
  const raw = query.get('stepRunId');
  if (raw === null) return null;
  if (!ID_TEXT.test(raw) || Number(raw) > 2_147_483_647) {
    throw invalidQuery('stepRunId', '1 이상의 정수여야 합니다.');
  }
  return Number(raw);
}
