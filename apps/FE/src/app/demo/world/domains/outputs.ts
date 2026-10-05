import type { DemoWorld } from '../../demoWorld';
import { currentRun } from '../engine';
import { httpError, STEP_LABEL, withObject } from '../errors';
import type { RunRec } from '../state';
import type { StepCode } from '../steps';

/**
 * ⑥~⑧ 산출물 조회 도우미(BE `content-query.ts`·`tag-set.service.ts`·`upload-result.service.ts`가 같은 규칙을 쓴다):
 * 기본은 현재 버전, `?stepRunId=`면 그 버전. 단계를 아직 실행하지 않았거나 그 버전에 산출물이 아직 없으면(실행 중·실패)
 * 404 `STEP_OUTPUT_NOT_FOUND`다 — 새 실행이 RUNNING인 동안은 현재 버전 포인터가 새 실행으로 옮겨 가 산출물이 없다.
 */

const MAX_ID = 2_147_483_647;

export const iso = (ms: number): string => new Date(ms).toISOString();

function invalidQuery(field: string, message: string) {
  return httpError(422, 'INVALID_QUERY_PARAMETER', '목록 조건이 올바르지 않습니다.', {
    fieldErrors: [{ field, message }],
  });
}

/** 조회 쿼리는 `stepRunId`만 받는다(어기면 422 `INVALID_QUERY_PARAMETER`) */
export function parseOutputQuery(query: URLSearchParams): number | null {
  for (const key of query.keys()) {
    if (key !== 'stepRunId') throw invalidQuery(key, '받지 않는 조건입니다.');
  }
  const raw = query.get('stepRunId');
  if (raw === null) return null;
  if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > MAX_ID) {
    throw invalidQuery('stepRunId', '1 이상의 정수여야 합니다.');
  }
  return Number(raw);
}

/** 404 `STEP_OUTPUT_NOT_FOUND` — '아직 ⑥-1 카피를 실행하지 않았습니다.' */
export const stepNotRun = (code: StepCode) =>
  httpError(
    404,
    'STEP_OUTPUT_NOT_FOUND',
    `아직 ${withObject(STEP_LABEL[code])} 실행하지 않았습니다.`,
    {
      details: { stepCode: code },
    },
  );

/** 볼 버전을 고른다. 이 단계의 실행이 아니면 404 `STEP_RUN_NOT_FOUND`, 산출물이 없으면 404 `STEP_OUTPUT_NOT_FOUND` */
export function resolveOutputRun(
  w: DemoWorld,
  code: StepCode,
  query: URLSearchParams,
  outputRunIds: readonly number[],
): { run: RunRec; isCurrent: boolean } {
  const asked = parseOutputQuery(query);
  const current = currentRun(w, code);
  let run: RunRec | null;
  if (asked !== null) {
    run = w.s.steps[code].runs.find((candidate) => candidate.id === asked) ?? null;
    if (!run) {
      throw httpError(404, 'STEP_RUN_NOT_FOUND', '실행 기록을 찾을 수 없습니다.', {
        details: { stepRunId: asked },
      });
    }
  } else {
    run = current;
    if (!run) throw stepNotRun(code);
  }
  if (!outputRunIds.includes(run.id)) throw stepNotRun(code);
  return { run, isCurrent: current?.id === run.id };
}

/** 이 단계의 현재 실행이 산출물을 냈는가(다른 화면이 앞 단계 산출물을 읽을 때) */
export function hasCurrentOutput(
  w: DemoWorld,
  code: StepCode,
  outputRunIds: readonly number[],
): boolean {
  const run = currentRun(w, code);
  return run !== null && outputRunIds.includes(run.id);
}
