import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@/shared/api/client';
import type { DemoApi } from '../../demoApi';
import { reachPricingDone, reachSourcingDone, startDemoKit } from '../testkit';

/**
 * ④ 카테고리(D-32): 실행 → 입력 대기(리프 후보 2개) → 고르기 = 완료. 실제 `api` 클라이언트로 화면이 보내는 요청 그대로 부르고,
 * 실제 BE의 상태·오류 문구를 글자 그대로 확인한다. 지연은 0이고 `world.flush()`가 맡겨 둔 결과를 지금 낸다.
 */
let demo: DemoApi;
let off: () => void;

beforeEach(() => {
  ({ demo, off } = startDemoKit());
});

afterEach(() => {
  off();
  expect(demo.serverErrors).toEqual([]);
  expect(demo.unknownRequests).toEqual([]);
});

const id = 1;
const path = { params: { path: { candidateId: id } } };
const RUNNING_LEAF = '50000830';
const WALKING_LEAF = '50000831';

const runCategory = () =>
  api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
    params: { path: { candidateId: id, stepCode: 'CATEGORY' } },
    body: {},
  });

const decision = () => api.GET('/candidates/{candidateId}/category-decision', path);

const select = (decisionId: number, body: object) =>
  api.PUT('/category-decisions/{categoryDecisionId}/selection', {
    params: { path: { categoryDecisionId: decisionId } },
    body: body as never,
  });

async function stepOf(code: string) {
  const rail = await api.GET('/candidates/{candidateId}/steps', path);
  return rail.data!.items.find((item) => item.stepCode === code)!;
}

/** ② 완료 → ④ 실행 → 입력 대기(G2·③ 없이도 된다) */
async function waiting() {
  await reachSourcingDone(demo);
  await runCategory();
  demo.world.flush();
  return (await decision()).data!;
}

describe('④ 실행 전', () => {
  it('결정 조회는 404 STEP_OUTPUT_NOT_FOUND, 결정 id로 고르면 404 CATEGORY_DECISION_NOT_FOUND', async () => {
    await reachSourcingDone(demo);
    const res = await decision();
    expect(res.response.status).toBe(404);
    expect(res.error).toMatchObject({
      code: 'STEP_OUTPUT_NOT_FOUND',
      message: '아직 ④ 카테고리를 실행하지 않았습니다.',
      details: { stepCode: 'CATEGORY' },
    });
    const pick = await select(21, { leafCategoryId: RUNNING_LEAF });
    expect(pick.response.status).toBe(404);
    expect(pick.error).toMatchObject({
      code: 'CATEGORY_DECISION_NOT_FOUND',
      message: '카테고리 결정을 찾을 수 없습니다.',
    });
    const bad = await api.GET('/candidates/{candidateId}/category-decision', {
      params: { path: { candidateId: id }, query: { stepRunId: 7777 } },
    });
    expect(bad.error).toMatchObject({ code: 'STEP_RUN_NOT_FOUND' });
  });

  it('② 전에는 시작 조건 409(② 장르·상품유형, 성별)', async () => {
    await api.POST('/keyword-snapshots', { body: { method: 'BUTTON', rankLimit: 100 } as never });
    demo.world.flush();
    await api.PUT('/keywords/{keywordId}/selection', { params: { path: { keywordId: 101 } } });
    await api.POST('/candidates', {
      body: {
        creationPath: 'KEYWORD',
        sourceKeywordId: 101,
        rakutenQuery: '아식스 젤카야노14',
      } as never,
    });
    const res = await runCategory();
    expect(res.error).toMatchObject({
      code: 'STEP_START_CONDITION_UNMET',
      message: '시작에 필요한 값이 없습니다: ② 장르·상품유형, 성별.',
    });
  });
});

describe('④ 실행 → 입력 대기', () => {
  it('③·G2 없이도 실행되고, 실행 중에는 결정이 없다(404) → 입력 대기에서 후보 2개', async () => {
    await reachSourcingDone(demo);
    const accepted = await runCategory();
    expect(accepted.response.status).toBe(202);
    expect(accepted.data).toMatchObject({
      stepCode: 'CATEGORY',
      status: 'RUNNING',
      version: 1,
      aiEngine: null,
    });
    // 같은 단계를 또 누르면 409, 결정은 아직 없다
    expect((await runCategory()).error).toMatchObject({
      code: 'STEP_ALREADY_RUNNING',
      message: '이 단계가 이미 실행 중입니다.',
    });
    expect((await decision()).response.status).toBe(404);
    demo.world.flush();

    const item = await stepOf('CATEGORY');
    expect(item.status).toBe('WAITING_INPUT');
    expect(item.actions.run.disabledReason?.message).toBe(
      '이 단계가 입력을 기다리고 있습니다. 입력을 마치면 이어서 실행됩니다.',
    );
    expect(demo.world.s.steps.CATEGORY.runs.at(-1)).toMatchObject({
      waitingReasonCode: 'CATEGORY_SELECTION_REQUIRED',
      pendingInputs: ['owner.categorySelection'],
    });
    expect((await runCategory()).error).toMatchObject({
      code: 'STEP_ALREADY_RUNNING',
      message: '이 단계가 입력을 기다리고 있습니다. 입력을 마치면 이어서 실행됩니다.',
    });

    const res = await decision();
    expect(res.data).toMatchObject({
      id: 21,
      stepRunId: accepted.data!.stepRunId,
      candidateId: id,
      version: 1,
      stepStatus: 'WAITING_INPUT',
      isCurrent: true,
      inputGenreId: 208025,
      gender: 'MALE',
      genderChangedInRun: false,
      candidateSource: 'MAPPING',
      leafCategoryId: null,
      wholeCategoryName: null,
      genderPathMatch: null,
      exceptionDecision: null,
      kcExemptAdultConfirmedAt: null,
      certificationExcludeContent: null,
      decidedAt: null,
    });
    expect(res.data?.categoryOptions).toEqual([
      {
        leafCategoryId: RUNNING_LEAF,
        wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
        kcExemptionRequired: false,
        blocked: false,
        blockReason: null,
      },
      {
        leafCategoryId: WALKING_LEAF,
        wholeCategoryName: '패션잡화>남성신발>운동화>워킹화',
        kcExemptionRequired: true,
        blocked: false,
        blockReason: null,
      },
    ]);
    // 아직 여정에 카테고리가 없다
    expect((await api.GET('/candidates/{candidateId}', path)).data).toMatchObject({
      leafCategoryId: null,
      wholeCategoryName: null,
    });
    expect(demo.world.progress().next?.id).toBe('domesticPrice');
  });
});

describe('리프 고르기', () => {
  it('러닝화를 고르면 ④가 같은 실행·버전으로 완료되고 여정에 카테고리가 채워진다', async () => {
    const waitingDecision = await waiting();
    const res = await select(waitingDecision.id, {
      leafCategoryId: RUNNING_LEAF,
      kcExemptAdultConfirmed: false,
    });
    expect(res.response.status).toBe(200);
    expect(res.data).toMatchObject({
      categoryDecisionId: 21,
      stepRunId: waitingDecision.stepRunId,
      candidateId: id,
      stepStatus: 'COMPLETED',
      leafCategoryId: RUNNING_LEAF,
      wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
      exceptionDecision: 'PASS',
      kcExemptAdultConfirmedAt: null,
      staleDownstreamSteps: [],
    });
    expect(Date.parse(res.data!.decidedAt)).not.toBeNaN();
    const item = await stepOf('CATEGORY');
    expect(item).toMatchObject({
      status: 'COMPLETED',
      currentStepRunId: waitingDecision.stepRunId,
    });
    expect(item.currentRun).toMatchObject({ version: 1, status: 'COMPLETED' });

    const done = await decision();
    expect(done.data).toMatchObject({
      id: 21,
      stepStatus: 'COMPLETED',
      leafCategoryId: RUNNING_LEAF,
      wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
      genderPathMatch: true,
      exceptionDecision: 'PASS',
      exceptionalCategories: [],
      certificationExcludeContent: null,
    });
    expect(done.data?.categoryOptions).toHaveLength(2);
    const detail = await api.GET('/candidates/{candidateId}', path);
    expect(detail.data).toMatchObject({
      leafCategoryId: RUNNING_LEAF,
      wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
    });
    // 이미 끝난 결정에 다시 보내면 409
    expect((await select(21, { leafCategoryId: RUNNING_LEAF })).error).toMatchObject({
      code: 'STEP_RUN_NOT_WAITING_INPUT',
      message: '이 실행은 입력을 기다리고 있지 않습니다. 바꾸려면 다시 실행하거나 수정해 주세요.',
    });
  });

  it('G2 통과 뒤 띠의 다음 일: ④ 실행 → 리프 고르기 → ⑤ 실행', async () => {
    await reachPricingDone(demo);
    expect(demo.world.progress().next?.id).toBe('runCategory');
    await runCategory();
    demo.world.flush();
    expect(demo.world.progress().next?.id).toBe('chooseLeaf');
    const d = (await decision()).data!;
    await select(d.id, { leafCategoryId: RUNNING_LEAF });
    expect(demo.world.progress().next?.id).toBe('runThumbnail');
  });

  it('워킹화(KC 인증 예외)는 KC 면제 확인이 있어야 하고, 확인하면 KC_EXEMPT로 기록된다', async () => {
    const d = await waiting();
    const missing = await select(d.id, {
      leafCategoryId: WALKING_LEAF,
      kcExemptAdultConfirmed: false,
    });
    expect(missing.response.status).toBe(409);
    expect(missing.error).toMatchObject({
      code: 'KC_EXEMPT_CONFIRMATION_REQUIRED',
      message: "KC 인증 예외 카테고리입니다. 'KC 면제 성인용 확인'을 체크해 주세요.",
      details: { leafCategoryId: WALKING_LEAF },
    });
    expect((await stepOf('CATEGORY')).status).toBe('WAITING_INPUT');
    const ok = await select(d.id, { leafCategoryId: WALKING_LEAF, kcExemptAdultConfirmed: true });
    expect(ok.data).toMatchObject({ exceptionDecision: 'KC_EXEMPT', leafCategoryId: WALKING_LEAF });
    expect(ok.data?.kcExemptAdultConfirmedAt).not.toBeNull();
    const done = (await decision()).data!;
    expect(done).toMatchObject({
      exceptionDecision: 'KC_EXEMPT',
      exceptionalCategories: ['KC_CERTIFICATION'],
      certificationExcludeContent: {
        kcCertifiedProductExclusionYn: 'KC_EXEMPTION_OBJECT',
        kcExemptionType: 'OVERSEAS',
      },
    });
    expect(done.kcExemptAdultConfirmedAt).not.toBeNull();
  });

  it('목록 밖 리프 422 · 모양 오류 422 · 리프 검색(SEARCH)은 M2라 422', async () => {
    const d = await waiting();
    const outside = await select(d.id, { leafCategoryId: '99999999' });
    expect(outside.response.status).toBe(422);
    expect(outside.error).toMatchObject({
      code: 'CATEGORY_NOT_IN_OPTIONS',
      message: '보여 드린 목록에 없는 카테고리입니다.',
      details: { leafCategoryId: '99999999', reason: 'NOT_IN_OPTIONS' },
    });
    const empty = await select(d.id, { leafCategoryId: '' });
    expect(empty.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ field: 'leafCategoryId', message: '비울 수 없습니다.' }],
    });
    const long = await select(d.id, { leafCategoryId: 'x'.repeat(21) });
    expect(long.error?.fieldErrors?.[0]).toMatchObject({
      field: 'leafCategoryId',
      message: '20자 이내여야 합니다.',
    });
    const missing = await select(d.id, {});
    expect(missing.error?.fieldErrors?.[0]).toMatchObject({
      field: 'leafCategoryId',
      message: '글자여야 합니다.',
    });
    const search = await select(d.id, { leafCategoryId: RUNNING_LEAF, candidateSource: 'SEARCH' });
    expect(search.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [
        {
          field: 'candidateSource',
          message: '리프 검색·직접 선택(SEARCH)은 M2 기능입니다. 보여 드린 목록에서 골라 주세요.',
        },
      ],
    });
    const wrongId = await select(d.id + 1, { leafCategoryId: RUNNING_LEAF });
    expect(wrongId.error).toMatchObject({ code: 'CATEGORY_DECISION_NOT_FOUND' });
    expect((await stepOf('CATEGORY')).status).toBe('WAITING_INPUT');
    expect(demo.world.s.candidate?.leafCategoryId).toBeNull();
  });

  it('잠긴 여정에는 고를 수 없다(409 CANDIDATE_LOCKED)', async () => {
    const d = await waiting();
    demo.world.candidate().status = 'REGISTERING';
    const res = await select(d.id, { leafCategoryId: RUNNING_LEAF });
    expect(res.error).toMatchObject({
      code: 'CANDIDATE_LOCKED',
      message: '등록을 진행 중이거나 끝난 여정이라 바꿀 수 없습니다.',
    });
  });
});

describe('④ 다시 실행', () => {
  it('새 버전이 열리면 결정이 사라지고(404) 여정의 리프는 새 결정까지 그대로, 지난 결정 id로는 고를 수 없다', async () => {
    const first = await waiting();
    await select(first.id, { leafCategoryId: RUNNING_LEAF });
    const rerun = await runCategory();
    expect(rerun.data).toMatchObject({ version: 2, status: 'RUNNING' });
    expect((await decision()).error).toMatchObject({ code: 'STEP_OUTPUT_NOT_FOUND' });
    expect((await api.GET('/candidates/{candidateId}', path)).data?.leafCategoryId).toBe(
      RUNNING_LEAF,
    );
    demo.world.flush();
    const second = (await decision()).data!;
    expect(second).toMatchObject({
      version: 2,
      stepStatus: 'WAITING_INPUT',
      leafCategoryId: null,
      stepRunId: rerun.data!.stepRunId,
    });
    expect(second.id).toBe(22);
    expect((await select(first.id, { leafCategoryId: RUNNING_LEAF })).error).toMatchObject({
      code: 'CATEGORY_DECISION_NOT_FOUND',
    });
    const done = await select(second.id, { leafCategoryId: RUNNING_LEAF });
    expect(done.data).toMatchObject({ stepStatus: 'COMPLETED', categoryDecisionId: 22 });
    expect((await stepOf('CATEGORY')).currentRun).toMatchObject({ version: 2 });
  });

  it('처음부터 다시(reset)는 ④ 상태도 비운다', async () => {
    const d = await waiting();
    await select(d.id, { leafCategoryId: RUNNING_LEAF });
    demo.world.reset();
    expect(demo.world.s.category).toEqual({ chosenLeafCategoryId: null, decision: null });
    expect(demo.world.s.candidate).toBeNull();
  });
});
