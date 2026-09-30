import type {
  Candidate,
  CandidateStep,
  StepRun,
  StepRunInput,
} from '../../../generated/prisma/client.js';
import type { AppSettings } from '../../settings/schema/settings.types.js';
import type { Db } from '../candidates/step-engine-tx.js';
import type {
  CandidateStepState,
  StepInput,
  StepInputContext,
  StepRunner,
  Tx,
} from '../contracts/step-runner.js';
import { NULL_VALUE_HASH, valueHash } from '../domain/fingerprint.js';
import {
  STEP_FLOW,
  toStepStatusMap,
  type StepCode,
  type StepStatus,
  type StepStatusMap,
} from '../domain/steps.js';

/**
 * 단계 실행 저장소 도우미(P1-05): 단계 행 읽기, 버전 발급, 입력 읽기·해시·저장, 열린 실행 유일 제약 판별.
 * 서비스(시작·끝·전파·오너 수정·레일)가 같이 쓴다.
 */

/** 입력 키 길이 상한(varchar(64)) */
const INPUT_KEY_MAX = 64;

/** 값 해시가 붙은 입력 */
export interface ResolvedInput extends StepInput {
  valueHash: string;
}

/** 후보의 candidate_step 10행(흐름 순서) */
export async function loadStepRows(db: Db, candidateId: number): Promise<CandidateStep[]> {
  const rows = await db.candidateStep.findMany({ where: { candidateId } });
  const byCode = new Map(rows.map((row) => [row.stepCode, row]));
  return STEP_FLOW.map((code) => byCode.get(code)).filter((row): row is CandidateStep => !!row);
}

export function stepStatusMapOf(rows: readonly CandidateStep[]): StepStatusMap {
  return toStepStatusMap(rows);
}

export function stepStatesOf(rows: readonly CandidateStep[]): Record<StepCode, CandidateStepState> {
  const states = {} as Record<StepCode, CandidateStepState>;
  for (const code of STEP_FLOW) states[code] = { status: 'NOT_RUN', currentStepRunId: null };
  for (const row of rows) {
    states[row.stepCode as StepCode] = {
      status: row.status as StepStatus,
      currentStepRunId: row.currentStepRunId,
    };
  }
  return states;
}

/** 실행기 `readInputs`에 넘길 것 */
export function inputContextOf(
  db: Tx,
  candidate: Candidate,
  settings: Readonly<AppSettings>,
  rows: readonly CandidateStep[],
): StepInputContext {
  const steps = stepStatesOf(rows);
  return {
    db,
    candidate,
    settings,
    steps,
    completedRunId: (code) =>
      steps[code].status === 'COMPLETED' ? steps[code].currentStepRunId : null,
  };
}

/** 실행기 입력이 규약을 어겼다(앱 코드 잘못) */
export class StepInputContractError extends Error {}

/** 실행기의 입력을 읽어 값 해시를 붙인다. 입력 키 중복·길이·출처 모양을 검사한다 */
export async function readResolvedInputs(
  runner: StepRunner,
  ctx: StepInputContext,
): Promise<ResolvedInput[]> {
  const inputs = await runner.readInputs(ctx);
  const seen = new Set<string>();
  return inputs.map((input) => {
    if (seen.has(input.inputKey)) {
      throw new StepInputContractError(
        `${runner.stepCode}: 입력 키가 두 번 나왔습니다(${input.inputKey})`,
      );
    }
    seen.add(input.inputKey);
    if (input.inputKey.length === 0 || input.inputKey.length > INPUT_KEY_MAX) {
      throw new StepInputContractError(`${runner.stepCode}: 입력 키 길이가 1~64자가 아닙니다`);
    }
    if (input.sourceType !== 'PREV_STEP' && input.sourceStepRunId != null) {
      throw new StepInputContractError(
        `${runner.stepCode}: PREV_STEP이 아닌 입력에 sourceStepRunId가 있습니다(${input.inputKey})`,
      );
    }
    const missing = input.value === null || input.value === undefined;
    return { ...input, valueHash: missing ? NULL_VALUE_HASH : valueHash(input.value) };
  });
}

/** 입력 목록 → `{ inputKey: valueHash }`(startOnly면 시작 조건만) */
export function hashesOf(
  inputs: readonly { inputKey: string; isStartCondition: boolean; valueHash: string }[],
  startOnly = true,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const input of inputs) {
    if (startOnly && !input.isStartCondition) continue;
    out[input.inputKey] = input.valueHash;
  }
  return out;
}

/**
 * step_run_input 행으로 남길 입력. PREV_STEP인데 앞 단계 버전이 없는 것(없는 선택 입력)은 행을 남기지 않는다
 * (ck_step_run_input_prev) — 지문에는 null 값 해시로 들어간다.
 */
export function inputRowsOf(stepRunId: number, inputs: readonly ResolvedInput[]) {
  return inputs
    .filter((input) => input.sourceType !== 'PREV_STEP' || input.sourceStepRunId != null)
    .map((input) => ({
      stepRunId,
      inputKey: input.inputKey,
      sourceType: input.sourceType,
      sourceStepRunId: input.sourceType === 'PREV_STEP' ? (input.sourceStepRunId ?? null) : null,
      isStartCondition: input.isStartCondition,
      valueHash: input.valueHash,
    }));
}

export async function insertInputRows(
  tx: Tx,
  stepRunId: number,
  inputs: readonly ResolvedInput[],
): Promise<void> {
  const data = inputRowsOf(stepRunId, inputs);
  if (data.length > 0) await tx.stepRunInput.createMany({ data });
}

/** 한 실행의 입력 행(키 순) */
export function loadInputRows(db: Db, stepRunId: number): Promise<StepRunInput[]> {
  return db.stepRunInput.findMany({ where: { stepRunId }, orderBy: { inputKey: 'asc' } });
}

/**
 * 다음 버전 번호(규칙 3): candidate_step.last_version을 +1 한 값(UPDATE … RETURNING, Prisma increment).
 * 후보 행을 잠근 트랜잭션 안에서 부른다.
 */
export async function nextVersion(
  tx: Tx,
  candidateId: number,
  stepCode: StepCode,
): Promise<number> {
  const row = await tx.candidateStep.update({
    where: { candidateId_stepCode: { candidateId, stepCode } },
    data: { lastVersion: { increment: 1 } },
    select: { lastVersion: true },
  });
  return row.lastVersion;
}

/** 직전 완료 버전(버전이 가장 큰 COMPLETED 실행). 다시 실행의 기본값·오너 입력 필드 보존(F-CW-01)에 쓴다 */
export function previousCompletedRun(
  db: Db,
  candidateId: number,
  stepCode: StepCode,
): Promise<StepRun | null> {
  return db.stepRun.findFirst({
    where: { candidateId, stepCode, status: 'COMPLETED' },
    orderBy: { version: 'desc' },
  });
}

function describe(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const e = error as { message?: unknown; meta?: unknown; cause?: unknown };
  let meta = '';
  try {
    meta = JSON.stringify(e.meta ?? null);
  } catch {
    meta = '';
  }
  return `${typeof e.message === 'string' ? e.message : ''} ${meta} ${e.cause ? describe(e.cause) : ''}`;
}

/** 후보·단계마다 열린 실행은 하나(uq_step_run_one_open) 위반인가. 동시 요청이 앱 검사를 지나 DB에서 걸린 경우 */
export function isOneOpenRunViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  const text = describe(error);
  const unique = code === 'P2002' || code === '23505' || text.includes('23505');
  return unique && (text.includes('uq_step_run_one_open') || text.includes('one_open'));
}
