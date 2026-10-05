import { isStepCode } from '@/shared/lib/steps';
import { get, post, type DemoRoute, type RouteContext } from '../router';
import type { Schema } from '../sample/types';
import { pageOf } from '../sample/util';
import type { DemoWorld } from '../demoWorld';
import {
  attentionSteps,
  candidateGates,
  candidateStatusCounts,
  candidateStatusHistory,
  candidateSteps,
  continuousRunView,
  listCandidates,
  resumeTargetOf,
  stepRunDetail,
  stepRunVersions,
  candidateDetailOf,
  staleDiffOf,
} from './candidateViews';
import { startChain, startStep } from './engine';
import { httpError, validationFailed } from './errors';
import { passG2 } from './domains/pricing';
import { passG3 } from './domains/thumbnail';
import type { StartBody } from './runner';
import { STEP_FLOW, type StepCode } from './steps';

const AI_STEPS: readonly StepCode[] = ['COPY', 'NOTICE_RAW'];

function stepCodeOf(params: RouteContext['params']): StepCode {
  const code = params.stepCode;
  if (!isStepCode(code)) {
    throw httpError(422, 'INVALID_STEP_CODE', '이 단계는 여기서 실행하거나 고칠 수 없습니다.', {
      details: { stepCode: code },
    });
  }
  return code;
}

/** 단계마다 받는 오너 입력(BE `OWNER_INPUT_FIELDS`) */
const OWNER_INPUTS: Readonly<Partial<Record<StepCode, readonly string[]>>> = {
  SOURCING: ['searchKeyword'],
  PRICING: ['couponYen'],
  THUMBNAIL: ['faceOption', 'promptAdjustment'],
};

function checkBody(code: StepCode, body: StartBody): void {
  const allowed = OWNER_INPUTS[code] ?? [];
  const fieldErrors = Object.keys(body.ownerInputs ?? {})
    .filter((key) => !allowed.includes(key))
    .map((key) => ({
      field: `ownerInputs.${key}`,
      message: '이 단계에서는 받지 않는 입력입니다.',
    }));
  if (fieldErrors.length > 0) {
    throw httpError(422, 'VALIDATION_FAILED', '입력값을 확인해 주세요.', { fieldErrors });
  }
  if (
    body.throughStepCode !== undefined &&
    (code !== 'COPY' || body.throughStepCode !== 'NOTICE_HTML')
  ) {
    throw validationFailed(
      'throughStepCode',
      'throughStepCode는 stepCode=COPY일 때만 줄 수 있습니다.',
    );
  }
}

/** 이 실행 id가 속한 단계 */
function runStepCodeOf(w: DemoWorld, runId: number): StepCode | null {
  return STEP_FLOW.find((code) => w.s.steps[code].runs.some((run) => run.id === runId)) ?? null;
}

function accepted(w: DemoWorld, code: StepCode, run: { id: number; version: number }) {
  const ai = AI_STEPS.includes(code);
  return {
    stepRunId: run.id,
    stepRunIds: [run.id],
    candidateId: w.candidate().id,
    stepCode: code,
    version: run.version,
    executionMode: 'STEP' as const,
    aiEngine: ai ? ('CLAUDE' as const) : null,
    aiModel: ai ? 'sonnet' : null,
    aiCliVersion: ai ? '2.1.269' : null,
    status: 'RUNNING' as const,
    warnings: [],
  } satisfies Schema<'StepRunAccepted'>;
}

/** 여정·단계·실행·게이트·연속 실행 라우트(step-engine). 단계 고유 라우트는 domains/* */
export const engineRoutes: DemoRoute[] = [
  get('/candidates', ({ world, query }) => listCandidates(world, query)),
  get('/candidates/status-counts', ({ world }) => candidateStatusCounts(world)),
  // 이어 할 곳이 없으면 204
  get('/candidates/resume-target', ({ world }) => {
    return resumeTargetOf(world) ?? new Response(null, { status: 204 });
  }),
  get('/candidates/{candidateId}', ({ world }) => candidateDetailOf(world)),
  get('/candidates/{candidateId}/steps', ({ world }) => candidateSteps(world)),
  get('/candidates/{candidateId}/steps/{stepCode}/runs', ({ world, params, query }) => {
    const code = stepCodeOf(params);
    const runs = stepRunVersions(world, code);
    const asc = query
      .getAll('sort')
      .flatMap((s) => s.split(','))
      .join(',')
      .replace(/\s/g, '')
      .includes('version,asc');
    const page = Number(query.get('page') ?? 0) || 0;
    const size = Number(query.get('size') ?? 20) || 20;
    return pageOf(asc ? [...runs].reverse() : runs, page, size);
  }),
  get('/candidates/{candidateId}/steps/{stepCode}/stale-diff', ({ world, params }) => {
    const code = stepCodeOf(params);
    const diff = staleDiffOf(world, code);
    if (diff) return diff;
    // 재실행 필요 단계가 아니다
    throw httpError(
      409,
      'STEP_NOT_RERUN_REQUIRED',
      "'재실행 필요' 상태인 단계에서만 할 수 있습니다.",
      {
        details: { stepCode: code, status: world.s.steps[code].status },
      },
    );
  }),
  get('/step-runs/{stepRunId}', ({ world, params }) => {
    const detail = stepRunDetail(world, Number(params.stepRunId));
    if (!detail) throw httpError(404, 'STEP_RUN_NOT_FOUND', '실행 기록을 찾을 수 없습니다.');
    return detail;
  }),
  get('/candidates/{candidateId}/gates', ({ world }) => candidateGates(world)),
  get('/candidates/{candidateId}/status-history', ({ world, query }) => {
    const page = Number(query.get('page') ?? 0) || 0;
    const size = Number(query.get('size') ?? 20) || 20;
    return pageOf(candidateStatusHistory(world), page, size);
  }),
  get('/continuous-runs/{stepChainId}', ({ world, params }) => {
    const view = continuousRunView(world, Number(params.stepChainId));
    if (!view) {
      throw httpError(404, 'CONTINUOUS_RUN_NOT_FOUND', '연속 실행 기록을 찾을 수 없습니다.');
    }
    return view;
  }),
  get('/candidate-steps', ({ world, query }) => attentionSteps(world, query)),

  // ── 누르는 일 ──
  post('/candidates/{candidateId}/steps/{stepCode}/runs', 202, async ({ world, params, json }) => {
    const code = stepCodeOf(params);
    const body = await json<StartBody>();
    checkBody(code, body);
    const run = startStep(world, code, body);
    if (code === 'COPY' && body.throughStepCode === 'NOTICE_HTML') {
      world.s.bundle = ['NOTICE_RAW', 'NOTICE_HTML'];
    }
    return accepted(world, code, run);
  }),
  post('/candidates/{candidateId}/continuous-runs', 202, async ({ world, json }) => {
    const body = await json<{ kind: string; startStepCode: string }>();
    if (body.kind !== 'FROM_HERE' && body.kind !== 'RERUN_STALE') {
      throw validationFailed('kind', 'FROM_HERE 또는 RERUN_STALE이어야 합니다.');
    }
    let start: StepCode | null = null;
    if (body.kind === 'FROM_HERE') {
      if (!body.startStepCode) {
        throw validationFailed('startStepCode', "'여기부터 연속 실행'에는 시작 단계가 필요합니다.");
      }
      if (!isStepCode(body.startStepCode)) {
        throw httpError(422, 'INVALID_STEP_CODE', '이 단계는 여기서 실행하거나 고칠 수 없습니다.', {
          details: { stepCode: body.startStepCode },
        });
      }
      start = body.startStepCode;
    }
    const { chain, run } = startChain(world, start);
    return {
      stepChainId: chain.id,
      candidateId: world.candidate().id,
      kind: chain.kind,
      startStepCode: chain.startStepCode,
      startedAt: new Date(chain.startedAt).toISOString(),
      status: 'RUNNING' as const,
      stepRunId: run.id,
      stepCode: runStepCodeOf(world, run.id),
    } satisfies Schema<'ContinuousRunAccepted'>;
  }),
  post('/candidates/{candidateId}/gates/{gateCode}/pass', 201, async ({ world, params, json }) => {
    const body = (await json<Record<string, unknown>>()) as Record<string, unknown>;
    if (params.gateCode === 'G2') return passG2(world, body);
    if (params.gateCode === 'G3') return passG3(world, body);
    throw httpError(
      422,
      'INVALID_GATE_CODE',
      '여기서는 G2·G3만 통과할 수 있습니다. 최종 승인은 승인 화면에서 해 주세요.',
    );
  }),
];
