import type { DemoWorld } from '../../demoWorld';
import { get, put, type DemoRoute } from '../../router';
import {
  categoryDecisionOf,
  categoryOptionOf,
  FIRST_DECISION_ID,
  type CategoryDecisionRec,
} from '../../sample/category';
import type { Schema } from '../../sample/types';
import { currentRun, resumeToComplete } from '../engine';
import { httpError } from '../errors';
import { STEP_FLOW } from '../steps';
import type { StepRunner } from '../runner';
import {
  assertMutable,
  assertQueryKeys,
  findStepRun,
  invalidQuery,
  isWaitingCurrent,
  notWaitingInput,
  outputNotFound,
  stepRunIdQuery,
  stepRunNotFound,
  throwIfFieldErrors,
  type FieldErrors,
} from './guards';

/**
 * ④ 카테고리: 매핑표로 뽑은 리프 후보(러닝화 · 워킹화)를 보여 주고(입력 대기 `CATEGORY_SELECTION_REQUIRED`), 오너가 하나를 고르면
 * ④가 완료되며 여정의 `leafCategoryId`·`wholeCategoryName`이 채워진다. 근거: BE `modules/category`.
 * - 결정 기록(`decision`)은 입력 대기에 이르러야 생긴다 — 실행 전·실행 중(다시 실행 직후 포함)은 404 STEP_OUTPUT_NOT_FOUND.
 * - 워킹화는 KC 인증 예외 카테고리라 'KC 면제 성인용 확인'을 체크해야 고를 수 있다(409 KC_EXEMPT_CONFIRMATION_REQUIRED).
 */
export interface CategoryState {
  /** 고른 리프 카테고리(확정 전 null) */
  chosenLeafCategoryId: string | null;
  /** 현재 ④ 실행의 결정 기록(입력 대기에 이르기 전·다시 시작한 직후는 null) */
  decision: CategoryDecisionRec | null;
}

export const initialCategory = (): CategoryState => ({
  chosenLeafCategoryId: null,
  decision: null,
});

// ── 실행기 ─────────────────────────────────────────────────────────────────

export const categoryRunner: StepRunner = {
  stepCode: 'CATEGORY',
  delay: 'short',
  onStart(w) {
    // 새 실행은 결정 기록이 아직 없다(여정에 이미 채워진 리프는 새 결정이 날 때까지 그대로다)
    w.s.category.decision = null;
    w.s.category.chosenLeafCategoryId = null;
  },
  outcome() {
    // 후보가 둘이고 하나는 KC 확인이 필요해 자동으로 끝나지 않는다
    return {
      status: 'WAITING_INPUT',
      reasonCode: 'CATEGORY_SELECTION_REQUIRED',
      pendingInputs: ['owner.categorySelection'],
    };
  },
  onSettled(w, outcome) {
    if (outcome.status !== 'WAITING_INPUT') return;
    const run = currentRun(w, 'CATEGORY');
    if (!run) return;
    const now = w.now();
    w.s.category.decision = {
      id: FIRST_DECISION_ID + run.version - 1,
      stepRunId: run.id,
      version: run.version,
      createdAt: now,
      updatedAt: now,
      leafCategoryId: null,
      wholeCategoryName: null,
      exceptionDecision: null,
      kcExemptAdultConfirmedAt: null,
      decidedAt: null,
    };
  },
};

// ── 조회 ───────────────────────────────────────────────────────────────────

/** `GET …/category-decision`: 현재(또는 `?stepRunId=`) 버전의 결정. 기록이 없으면 404 STEP_OUTPUT_NOT_FOUND */
function decisionView(w: DemoWorld, query: URLSearchParams): Schema<'CategoryDecisionDetail'> {
  assertQueryKeys(query, ['stepRunId']);
  const asked = stepRunIdQuery(query);
  const current = currentRun(w, 'CATEGORY');
  const runId = asked ?? current?.id ?? null;
  if (runId === null) throw outputNotFound('CATEGORY');
  const found = findStepRun(w, runId);
  if (!found) throw stepRunNotFound();
  if (found.code !== 'CATEGORY') {
    throw invalidQuery('stepRunId', '이 여정의 ④ 카테고리 실행이 아닙니다.');
  }
  const decision = w.s.category.decision;
  if (!decision || decision.stepRunId !== found.run.id) throw outputNotFound('CATEGORY');
  const isCurrent = current?.id === found.run.id;
  return categoryDecisionOf(decision, {
    stepStatus: isCurrent ? w.s.steps.CATEGORY.status : 'COMPLETED',
    isCurrent,
    candidateId: w.candidate().id,
  });
}

// ── 리프 고르기 ─────────────────────────────────────────────────────────────

const notFoundDecision = () =>
  httpError(404, 'CATEGORY_DECISION_NOT_FOUND', '카테고리 결정을 찾을 수 없습니다.');

/** 요청 모양 검사(BE `CategorySelectionRequestDto`) + M1에서 받지 않는 리프 검색(SEARCH) */
function checkSelectionBody(body: Record<string, unknown>): {
  leafCategoryId: string;
  kcExemptAdultConfirmed: boolean;
} {
  if (body.candidateSource !== undefined) {
    throw httpError(422, 'VALIDATION_FAILED', '입력값을 확인해 주세요.', {
      fieldErrors: [
        {
          field: 'candidateSource',
          message: '리프 검색·직접 선택(SEARCH)은 M2 기능입니다. 보여 드린 목록에서 골라 주세요.',
          rejectedValue: body.candidateSource,
        },
      ],
    });
  }
  const errors: FieldErrors = [];
  const leaf = body.leafCategoryId;
  if (typeof leaf !== 'string') {
    errors.push({ field: 'leafCategoryId', message: '글자여야 합니다.', rejectedValue: leaf });
  } else if (leaf.length < 1) {
    errors.push({ field: 'leafCategoryId', message: '비울 수 없습니다.' });
  } else if (leaf.length > 20) {
    errors.push({ field: 'leafCategoryId', message: '20자 이내여야 합니다.', rejectedValue: leaf });
  }
  const kc = body.kcExemptAdultConfirmed;
  if (kc !== undefined && typeof kc !== 'boolean') {
    errors.push({
      field: 'kcExemptAdultConfirmed',
      message: 'true 또는 false여야 합니다.',
      rejectedValue: kc,
    });
  }
  throwIfFieldErrors(errors);
  return { leafCategoryId: leaf as string, kcExemptAdultConfirmed: kc === true };
}

/**
 * `PUT /category-decisions/{id}/selection`(200): 검사 순서(BE 규칙 7) — 결정 없음 404 → 입력 대기 아님 409 → 목록에 없음 422 →
 * (아동·제외 품목·성별 막힘은 예시 여정에 없다) → KC 확인 없음 409 → 잠긴·제외 여정 409. 통과하면 ④를 완료한다.
 */
function selectLeaf(
  w: DemoWorld,
  idText: string | undefined,
  rawBody: Record<string, unknown>,
): Schema<'CategorySelectionResult'> {
  const body = checkSelectionBody(rawBody);
  const decision = w.s.category.decision;
  const run = currentRun(w, 'CATEGORY');
  if (
    !decision ||
    !run ||
    !/^[1-9]\d{0,9}$/.test(idText ?? '') ||
    Number(idText) !== decision.id ||
    decision.stepRunId !== run.id
  ) {
    throw notFoundDecision();
  }
  if (!isWaitingCurrent(w, 'CATEGORY', run)) {
    throw notWaitingInput({ stepRunId: run.id, status: w.s.steps.CATEGORY.status });
  }
  const option = categoryOptionOf(body.leafCategoryId);
  if (!option) {
    throw httpError(422, 'CATEGORY_NOT_IN_OPTIONS', '보여 드린 목록에 없는 카테고리입니다.', {
      details: { leafCategoryId: body.leafCategoryId, reason: 'NOT_IN_OPTIONS' },
    });
  }
  if (option.kcExemptionRequired && !body.kcExemptAdultConfirmed) {
    throw httpError(
      409,
      'KC_EXEMPT_CONFIRMATION_REQUIRED',
      "KC 인증 예외 카테고리입니다. 'KC 면제 성인용 확인'을 체크해 주세요.",
      { details: { leafCategoryId: option.leafCategoryId } },
    );
  }
  assertMutable(w);

  const now = w.now();
  const kc = option.kcExemptionRequired;
  decision.leafCategoryId = option.leafCategoryId;
  decision.wholeCategoryName = option.wholeCategoryName;
  decision.exceptionDecision = kc ? 'KC_EXEMPT' : 'PASS';
  decision.kcExemptAdultConfirmedAt = kc ? now : null;
  decision.decidedAt = now;
  decision.updatedAt = now;
  w.s.category.chosenLeafCategoryId = option.leafCategoryId;
  const candidate = w.candidate();
  candidate.leafCategoryId = option.leafCategoryId;
  candidate.wholeCategoryName = option.wholeCategoryName;
  candidate.updatedAt = now;
  // ④를 끝내면 리프 경로를 읽는 ⑥-3·⑦이 달라진 값이면 '재실행 필요'가 된다(BE: 새로 재실행 필요가 된 단계를 알려 준다)
  const staleBefore = new Set(
    STEP_FLOW.filter((code) => w.s.steps[code].status === 'RERUN_REQUIRED'),
  );
  resumeToComplete(w, 'CATEGORY');
  const staleDownstreamSteps = STEP_FLOW.filter(
    (code) =>
      code !== 'CATEGORY' && w.s.steps[code].status === 'RERUN_REQUIRED' && !staleBefore.has(code),
  );
  return {
    categoryDecisionId: decision.id,
    stepRunId: run.id,
    candidateId: candidate.id,
    stepStatus: w.s.steps.CATEGORY.status,
    leafCategoryId: option.leafCategoryId,
    wholeCategoryName: option.wholeCategoryName,
    exceptionDecision: decision.exceptionDecision,
    kcExemptAdultConfirmedAt: kc ? new Date(now).toISOString() : null,
    decidedAt: new Date(now).toISOString(),
    staleDownstreamSteps,
  };
}

// ── 라우트 ─────────────────────────────────────────────────────────────────

export const categoryRoutes: DemoRoute[] = [
  get('/candidates/{candidateId}/category-decision', ({ world, query }) =>
    decisionView(world, query),
  ),
  put('/category-decisions/{categoryDecisionId}/selection', 200, async ({ world, params, json }) =>
    selectLeaf(
      world,
      params.categoryDecisionId,
      (await json<Record<string, unknown>>()) as Record<string, unknown>,
    ),
  ),
];
