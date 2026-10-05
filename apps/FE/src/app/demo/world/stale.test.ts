import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@/shared/api/client';
import type { DemoApi } from '../demoApi';
import { requirementSteps } from './engine';
import { directReaders, readsOf, requiredReads } from './graph';
import { STEP_FLOW, type StepCode } from './steps';
import {
  approveOnce,
  chooseLeaf,
  passG3,
  reachSourcingDone,
  reachSourcingSearch,
  reachUploadDone,
  startDemoKit,
  thumbnailImages,
} from './testkit';

/**
 * '재실행 필요' 전파와 [재실행 필요 단계 모두 실행](D-32 리뷰 뒤) — BE 의존 그래프를 그대로 걷는다:
 * 단계가 끝날 때 읽은 입력을 적어 두고, 앞 단계가 새 버전을 내면 그 산출물을 바로 읽는 단계만 지금 값과 견줘 달라진 것만 낡게 한다.
 * 근거: BE `step-engine/propagation`·`continuous/chain-planner`·`test/step-engine/continuous-gates`, FE e2e flow-failures #4.
 */
let demo: DemoApi;
let off: () => void;

beforeEach(() => {
  ({ demo, off } = startDemoKit());
});

afterEach(() => {
  off();
  expect(demo.unknownRequests).toEqual([]);
  expect(demo.serverErrors).toEqual([]);
  expect(demo.readOnlyRequests).toEqual([]);
});

const id = 1;
const path = { params: { path: { candidateId: id } } };
const next = () => demo.world.progress().next;

async function rail() {
  const res = await api.GET('/candidates/{candidateId}/steps', path);
  return Object.fromEntries(res.data!.items.map((item) => [item.stepCode, item]));
}
const statuses = async () =>
  Object.fromEntries(Object.entries(await rail()).map(([code, item]) => [code, item.status]));
const candidate = async () => (await api.GET('/candidates/{candidateId}', path)).data!;
const gate = async (code: 'G2' | 'G3' | 'G4') =>
  (await api.GET('/candidates/{candidateId}/gates', path)).data!.items.find(
    (g) => g.gate === code,
  )!;

const savePrice = (pRefKrw: number) =>
  api.POST('/candidates/{candidateId}/domestic-prices', {
    ...path,
    body: { pRefKrw, sourceUrl: null, sourceKind: 'MANUAL' } as never,
  });
const rerunStale = () =>
  api.POST('/candidates/{candidateId}/continuous-runs', {
    ...path,
    body: { kind: 'RERUN_STALE' } as never,
  });
const chainOf = async (stepChainId: number) =>
  (await api.GET('/continuous-runs/{stepChainId}', { params: { path: { stepChainId } } })).data!;
const runStep = (stepCode: StepCode) =>
  api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
    params: { path: { candidateId: id, stepCode } },
    body: {},
  });

/** 재실행 필요 단계 모두 실행을 누르고 끝까지 기다려 그 묶음을 돌려준다 */
async function rerunAll() {
  const res = await rerunStale();
  expect(res.response.status).toBe(202);
  demo.world.flush();
  const chain = await chainOf(res.data!.stepChainId);
  return { accepted: res.data!, chain, codes: chain.stepRuns.map((run) => run.stepCode) };
}

const ALL_DONE = Object.fromEntries(STEP_FLOW.slice(0, 9).map((code) => [code, 'COMPLETED']));

describe('단계 입력 그래프(BE STEP_GRAPH와 같다)', () => {
  it('뒤에서 바로 읽는 단계: 전파는 이 단계들만 다시 견준다(⑨ 제외)', () => {
    expect(directReaders('SOURCING')).toEqual([
      'PRICING',
      'CATEGORY',
      'THUMBNAIL',
      'COPY',
      'NOTICE_RAW',
      'NOTICE_HTML',
      'TAGS',
    ]);
    expect(directReaders('PRICING')).toEqual(['NOTICE_HTML']);
    // ④ 리프 경로는 ⑥-3(상품명)과 ⑦(카테고리 필터)이 선택 입력으로 읽는다
    expect(directReaders('CATEGORY')).toEqual(['NOTICE_HTML', 'TAGS']);
    expect(directReaders('THUMBNAIL')).toEqual(['UPLOAD']);
    expect(directReaders('COPY')).toEqual(['NOTICE_HTML']);
    expect(directReaders('NOTICE_RAW')).toEqual(['NOTICE_HTML']);
    expect(directReaders('NOTICE_HTML')).toEqual(['UPLOAD']);
    expect(directReaders('TAGS')).toEqual([]);
    expect(directReaders('UPLOAD')).toEqual([]);
    expect(directReaders('REGISTER')).toEqual([]);
  });

  it('시작 조건 표(엔진)의 앞 단계는 모두 필수 앞 단계이고, 읽는 단계 = 필수 + 선택이다', () => {
    for (const code of STEP_FLOW) {
      expect([...new Set(requirementSteps(code))].sort(), code).toEqual(
        [...requiredReads(code)].sort(),
      );
      expect(readsOf(code), code).toEqual(expect.arrayContaining([...requiredReads(code)]));
    }
    expect(readsOf('NOTICE_HTML')).toContain('CATEGORY');
    expect(readsOf('TAGS')).toContain('CATEGORY');
    expect(requiredReads('NOTICE_HTML')).not.toContain('CATEGORY');
  });
});

describe('B1 ③ 국내 기준가를 바꾼 뒤 [재실행 필요 단계 모두 실행]', () => {
  it('판매가가 달라지면 ③을 돌리고 G2 앞(AWAIT_G2)에서 멈춘다 → [소싱 확정(G2)]을 다시 눌러야 승인대기', async () => {
    await reachUploadDone(demo);
    expect((await candidate()).status).toBe('AWAITING_APPROVAL');
    expect((await savePrice(170_000)).data?.pricingStepStatus).toBe('RERUN_REQUIRED');
    expect(await statuses()).toMatchObject({ ...ALL_DONE, PRICING: 'RERUN_REQUIRED' });
    expect((await candidate()).status).toBe('WORKING');
    // G2: 옛 판정이 그대로라 지문은 유효하지만, 새로 통과하려면 ③이 완료여야 한다(BE blockedReasons)
    expect(await gate('G2')).toMatchObject({
      passed: true,
      fingerprintValid: true,
      blockedReasons: [
        {
          code: 'STEP_NOT_COMPLETED',
          message: '③ 판정이 아직 완료되지 않았습니다(지금: 재실행 필요).',
        },
      ],
    });
    // 띠: 재실행 필요 단계를 먼저 알린다(③ 화면 → 단계 이름 목록)
    expect(next()).toEqual({
      id: 'rerunStale',
      path: '/candidates/1/judgement',
      params: { steps: '③ 판정', g2: '1' },
    });
    // 버튼이 켜져 있고(재실행 필요 1개), 누르면 접수된다(RERUN_STALE은 시작 단계가 없다)
    const run = await rerunAll();
    expect(run.accepted).toMatchObject({
      kind: 'RERUN_STALE',
      startStepCode: null,
      stepCode: 'PRICING',
    });
    expect(run.codes).toEqual(['PRICING']);
    expect(run.chain).toMatchObject({
      kind: 'RERUN_STALE',
      startStepCode: null,
      stopReason: 'AWAIT_G2',
      stopStepCode: 'PRICING',
      skippedStepCodes: [],
    });
    expect(await statuses()).toMatchObject(ALL_DONE);
    // 판매가가 달라져 통과한 G2는 무효 → 여정 상태는 작업중 그대로
    expect(await gate('G2')).toMatchObject({ passed: false, fingerprintValid: false });
    expect((await candidate()).status).toBe('WORKING');
    expect(next()?.id).toBe('passG2');
    const judgement = await api.GET('/candidates/{candidateId}/price-judgement', path);
    expect(judgement.data?.salePriceKrw).toBe(168_300);
    const g2 = await api.POST('/candidates/{candidateId}/gates/{gateCode}/pass', {
      params: { path: { candidateId: id, gateCode: 'G2' } },
      body: { basisStepRunId: judgement.data!.stepRunId },
    });
    expect(g2.response.status).toBe(201);
    expect((await candidate()).status).toBe('AWAITING_APPROVAL');
    expect(next()?.id).toBe('approveDryRun');
  });

  it('판매가가 같으면(169,050원 → 167,300원) ③만 돌리고 G2를 그대로 둔 채 G4 앞에서 끝난다', async () => {
    await reachUploadDone(demo);
    expect((await savePrice(169_050)).data?.pricingStepStatus).toBe('RERUN_REQUIRED');
    const run = await rerunAll();
    expect(run.codes).toEqual(['PRICING']);
    expect(run.chain).toMatchObject({ stopReason: 'AWAIT_G4', stopStepCode: 'REGISTER' });
    expect(await gate('G2')).toMatchObject({ passed: true, fingerprintValid: true });
    expect((await candidate()).status).toBe('AWAITING_APPROVAL');
    expect(next()?.id).toBe('approveDryRun');
  });

  it('재실행 필요 단계가 없으면 409 NO_RERUN_REQUIRED_STEPS, 이미 도는 묶음이 있으면 409 CONTINUOUS_RUN_ALREADY_OPEN', async () => {
    await reachUploadDone(demo);
    expect((await rerunStale()).error).toMatchObject({
      code: 'NO_RERUN_REQUIRED_STEPS',
      message: '다시 실행할 단계가 없습니다.',
    });
    await savePrice(170_000);
    const first = await rerunStale();
    expect(first.response.status).toBe(202);
    expect((await rerunStale()).error).toMatchObject({ code: 'CONTINUOUS_RUN_ALREADY_OPEN' });
    // 묶음은 하나만 남았고(거절된 시도는 묶음을 남기지 않는다) 끝까지 돈다
    demo.world.flush();
    expect((await chainOf(first.data!.stepChainId)).stopReason).toBe('AWAIT_G2');
  });

  it('G2가 풀린 채 ③ 밖의 재실행 필요 단계만 남았으면 연속으로 돌지 않는다(CONTINUOUS_RUN_BEFORE_G2)', async () => {
    await reachUploadDone(demo);
    // ③을 가격 변경으로 낡게 한 뒤 판매가가 달라지게 다시 돌려 G2를 무효로 만든다
    await savePrice(170_000);
    await rerunAll();
    expect((await gate('G2')).fingerprintValid).toBe(false);
    // ④를 다시 골라 ⑥-3·⑦이 낡아졌다
    await runStep('CATEGORY');
    demo.world.flush();
    await chooseLeaf('워킹화', true);
    expect(await statuses()).toMatchObject({
      NOTICE_HTML: 'RERUN_REQUIRED',
      TAGS: 'RERUN_REQUIRED',
    });
    const res = await rerunStale();
    expect(res.error).toMatchObject({
      code: 'CONTINUOUS_RUN_BEFORE_G2',
    });
    // 거절된 시도는 묶음도, 실행도 남기지 않는다
    expect((await candidate()).openContinuousRun).toBeNull();
  });
});

describe('B2 ⑤ 대표 이미지를 다시 골라 G3을 다시 통과하면 ⑧만 재실행 필요(flow-failures #4)', () => {
  it('⑧만 재실행 필요 · 여정 상태 작업중 · 승인 불가 → [재실행 필요 단계 모두 실행]이 ⑧을 돌려 승인대기로', async () => {
    await reachUploadDone(demo);
    const { stepRunId, images } = await thumbnailImages();
    const g3 = await passG3(stepRunId, images[1]!, [images[0]!]);
    expect(g3.response.status).toBe(201);
    // ⑤는 새 버전(오너 수정)으로 완료, ⑧만 재실행 필요. 카피·태그 등은 그대로 완료
    expect(await statuses()).toMatchObject({ ...ALL_DONE, UPLOAD: 'RERUN_REQUIRED' });
    const rails = await rail();
    expect(rails.THUMBNAIL?.currentRun).toMatchObject({ executionMode: 'OWNER_EDIT', version: 2 });
    expect(rails.UPLOAD).toMatchObject({ staleInputs: ['thumbnail.selection'] });
    expect(rails.NOTICE_HTML).toMatchObject({ staleInputs: [] });
    // 게이트: 새 선택으로 G3은 다시 통과(유효), G2는 그대로, 승인(G4)은 아직
    expect(await gate('G3')).toMatchObject({ passed: true, fingerprintValid: true });
    expect(await gate('G2')).toMatchObject({ passed: true });
    expect(await gate('G4')).toMatchObject({ passed: false });
    // 여정 상태는 작업중이라 승인할 수 없다
    expect((await candidate()).status).toBe('WORKING');
    const preview = await api.GET('/candidates/{candidateId}/approval', path);
    expect(preview.error).toMatchObject({
      code: 'CANDIDATE_STATUS_INVALID',
      message: '지금 여정 상태(작업중)에서는 할 수 없습니다.',
    });
    // 낡은 이유는 선택본뿐이다
    const diff = await api.GET('/candidates/{candidateId}/steps/{stepCode}/stale-diff', {
      params: { path: { candidateId: id, stepCode: 'UPLOAD' } },
    });
    expect(diff.data?.inputs.map((i) => [i.inputKey, i.changed])).toEqual([
      ['noticeHtml.html', false],
      ['thumbnail.selection', true],
    ]);
    // 띠: ⑧ 화면에서 [재실행 필요 단계 모두 실행]
    expect(next()).toEqual({
      id: 'rerunStale',
      path: '/candidates/1/approval',
      params: { steps: '⑧ 이미지 업로드' },
    });

    const run = await rerunAll();
    expect(run.codes).toEqual(['UPLOAD']);
    expect(run.chain).toMatchObject({ stopReason: 'AWAIT_G4', stopStepCode: 'REGISTER' });
    expect(await statuses()).toMatchObject(ALL_DONE);
    expect((await candidate()).status).toBe('AWAITING_APPROVAL');
    expect(next()?.id).toBe('approveDryRun');
  });

  it('같은 선택으로 다시 통과하면(200) 아무것도 낡지 않는다', async () => {
    await reachUploadDone(demo);
    const { stepRunId, images } = await thumbnailImages();
    // 처음 고른 것: 대표 후보 1 + 추가 후보 2
    const again = await passG3(stepRunId, images[0]!, [images[1]!]);
    expect(again.response.status).toBe(200);
    expect(await statuses()).toMatchObject(ALL_DONE);
    expect((await candidate()).status).toBe('AWAITING_APPROVAL');
  });

  it('드라이런(검증완료) 뒤에 다시 고르면 G4가 풀리고 여정 상태는 작업중 → 고쳐서 다시 승인할 수 있다', async () => {
    await reachUploadDone(demo);
    await approveOnce(demo);
    expect((await candidate()).status).toBe('VALIDATED');
    expect(await gate('G4')).toMatchObject({ passed: true });
    const { stepRunId, images } = await thumbnailImages();
    await passG3(stepRunId, images[1]!, [images[0]!]);
    expect((await candidate()).status).toBe('WORKING');
    expect(await gate('G4')).toMatchObject({ passed: false });
    const history = await api.GET('/candidates/{candidateId}/status-history', path);
    expect(history.data?.content[0]).toMatchObject({
      fromStatus: 'VALIDATED',
      toStatus: 'WORKING',
      reason: 'STEP_NOT_CURRENT',
    });
    await rerunAll();
    expect((await candidate()).status).toBe('AWAITING_APPROVAL');
    await approveOnce(demo);
    expect((await candidate()).status).toBe('VALIDATED');
    expect(await gate('G4')).toMatchObject({ passed: true });
  });

  it('⑤를 다시 실행하면 새 이미지라 같은 칸을 골라도 ⑧이 재실행 필요가 된다', async () => {
    await reachUploadDone(demo);
    expect((await runStep('THUMBNAIL')).response.status).toBe(202);
    demo.world.flush();
    // 다시 실행하는 동안 ⑤는 입력 대기, G3은 확인 중이라 여정 상태는 작업중
    expect(await statuses()).toMatchObject({ THUMBNAIL: 'WAITING_INPUT', UPLOAD: 'COMPLETED' });
    expect((await gate('G3')).passed).toBe(false);
    // ⑧을 지금 다시 돌릴 수는 없다(⑤ 선택본이 없다) — 이유는 시작 조건
    expect((await runStep('UPLOAD')).error).toMatchObject({ code: 'STEP_START_CONDITION_UNMET' });
    const run = (await api.GET('/candidates/{candidateId}/thumbnail', path)).data!.stepRunId;
    await api.PUT('/step-runs/{stepRunId}/thumbnail-references', {
      params: { path: { stepRunId: run } },
      body: { references: [{ imageAssetId: 1, sortOrder: 1 }], noPersonConfirmed: true },
    });
    await api.POST('/step-runs/{stepRunId}/generation-runs', {
      params: { path: { stepRunId: run } },
      body: { slotNos: [1, 2], faceOption: 'FULL_FACE', promptAdjustment: null },
    });
    demo.world.flush();
    const { images } = await thumbnailImages();
    expect((await passG3(run, images[0]!, [images[1]!])).response.status).toBe(201);
    expect(await statuses()).toMatchObject({ THUMBNAIL: 'COMPLETED', UPLOAD: 'RERUN_REQUIRED' });
    expect((await candidate()).status).toBe('WORKING');
  });

  it('⑧이 낡은 채 ⑤를 다시 실행 중이면 [재실행 필요 단계 모두 실행]은 시작 조건 오류로 거절된다(G3 앞)', async () => {
    await reachUploadDone(demo);
    const { stepRunId, images } = await thumbnailImages();
    await passG3(stepRunId, images[1]!, [images[0]!]);
    expect((await statuses()).UPLOAD).toBe('RERUN_REQUIRED');
    await runStep('THUMBNAIL');
    demo.world.flush();
    const res = await rerunStale();
    expect(res.error).toMatchObject({
      code: 'STEP_START_CONDITION_UNMET',
      fieldErrors: [expect.objectContaining({ field: 'thumbnail.selection' })],
    });
    expect((await candidate()).openContinuousRun).toBeNull();
  });
});

describe('B2 ④를 다시 실행해 다른 리프를 고르면 ⑥-3·⑦이 재실행 필요', () => {
  it('워킹화(KC 면제 확인)를 고르면 ⑥-3·⑦만 낡고, 모두 실행하면 ⑥-3 → ⑦ 순서로 돌고 ⑧은 완료 그대로 G4 앞에서 멈춘다(BE와 같다)', async () => {
    await reachUploadDone(demo);
    // ④ 다시 실행 → 입력 대기: 여정 상태는 작업중
    expect((await runStep('CATEGORY')).response.status).toBe(202);
    demo.world.flush();
    expect(await statuses()).toMatchObject({ ...ALL_DONE, CATEGORY: 'WAITING_INPUT' });
    expect((await candidate()).status).toBe('WORKING');
    // KC 확인 없이 워킹화는 고를 수 없다
    expect((await chooseLeaf('워킹화')).error).toMatchObject({
      code: 'KC_EXEMPT_CONFIRMATION_REQUIRED',
    });
    const chosen = await chooseLeaf('워킹화', true);
    expect(chosen.response.status).toBe(200);
    // 응답이 새로 낡아진 뒤 단계를 알린다
    expect(chosen.data?.staleDownstreamSteps).toEqual(['NOTICE_HTML', 'TAGS']);
    expect(await statuses()).toMatchObject({
      ...ALL_DONE,
      NOTICE_HTML: 'RERUN_REQUIRED',
      TAGS: 'RERUN_REQUIRED',
    });
    const rails = await rail();
    expect(rails.NOTICE_HTML).toMatchObject({ staleInputs: ['category.leafPath'] });
    expect(rails.TAGS).toMatchObject({ staleInputs: ['category.leafPath'] });
    // 낡은 단계는 정확히 ⑥-3·⑦ 둘뿐이다 — ⑧은 ⑤ 선택본과 ⑥-3 HTML 값(html_sha256)만 읽고 리프 경로는 상품명에만 든다
    expect(
      Object.entries(await statuses())
        .filter(([, status]) => status === 'RERUN_REQUIRED')
        .map(([code]) => code),
    ).toEqual(['NOTICE_HTML', 'TAGS']);
    expect(rails.UPLOAD?.staleInputs).toEqual([]);
    const uploadRunId = rails.UPLOAD?.currentStepRunId;
    // 게이트는 그대로, 여정 상태는 작업중
    expect(await gate('G2')).toMatchObject({ passed: true });
    expect(await gate('G3')).toMatchObject({ passed: true });
    expect((await candidate()).status).toBe('WORKING');
    expect(next()).toEqual({
      id: 'rerunStale',
      path: '/candidates/1/content',
      params: { steps: '⑥-3 고시·HTML, ⑦ 태그' },
    });

    const htmlBefore = demo.world.s.steps.NOTICE_HTML.runs[0]!;
    const run = await rerunAll();
    // ⑥-3 → ⑦ 순서로 돌고, ⑥-3 HTML 값은 그대로라(리프 경로는 상품명에만 든다) ⑧은 낡지 않아 돌지 않는다
    expect(run.codes).toEqual(['NOTICE_HTML', 'TAGS']);
    expect(run.chain).toMatchObject({
      stopReason: 'AWAIT_G4',
      stopStepCode: 'REGISTER',
      skippedStepCodes: [],
    });
    const htmlAfter = demo.world.s.steps.NOTICE_HTML.runs[1]!;
    expect(htmlAfter.inputs?.['category.leafPath']?.sig).not.toBe(
      htmlBefore.inputs?.['category.leafPath']?.sig,
    );
    expect(htmlAfter.outputs?.['noticeHtml.html']).toBe(htmlBefore.outputs?.['noticeHtml.html']);
    expect(await statuses()).toMatchObject(ALL_DONE);
    expect((await rail()).UPLOAD?.currentStepRunId).toBe(uploadRunId);
    expect(
      (
        await api.GET('/candidates/{candidateId}/steps/{stepCode}/runs', {
          params: { path: { candidateId: id, stepCode: 'UPLOAD' } },
        })
      ).data?.content,
    ).toHaveLength(1);
    expect((await candidate()).status).toBe('AWAITING_APPROVAL');
    expect((await candidate()).wholeCategoryName).toMatch(/워킹화$/);
  });

  it('같은 리프를 다시 고르면 아무것도 낡지 않고 ④만 새 버전으로 끝난다', async () => {
    await reachUploadDone(demo);
    await runStep('CATEGORY');
    demo.world.flush();
    const chosen = await chooseLeaf('러닝화');
    expect(chosen.data?.staleDownstreamSteps).toEqual([]);
    expect(await statuses()).toMatchObject(ALL_DONE);
    expect((await candidate()).status).toBe('AWAITING_APPROVAL');
  });

  it('③ 금액과 ④ 리프를 함께 바꾸면 ③ 다음 G2 앞에서 멈추고, G2를 다시 통과한 뒤에야 나머지를 돌린다', async () => {
    await reachUploadDone(demo);
    await savePrice(170_000);
    await runStep('CATEGORY');
    demo.world.flush();
    await chooseLeaf('워킹화', true);
    expect(await statuses()).toMatchObject({
      PRICING: 'RERUN_REQUIRED',
      NOTICE_HTML: 'RERUN_REQUIRED',
      TAGS: 'RERUN_REQUIRED',
    });
    // ③이 가격으로 낡았으니 ⑥-3은 ③ 판매 사이즈를 읽지 못한다(③이 완료가 아니다) → 낡은 이유에 함께 든다
    expect((await rail()).NOTICE_HTML?.staleInputs).toEqual(
      expect.arrayContaining(['category.leafPath']),
    );
    expect(next()?.params?.steps).toBe('③ 판정, ⑥-3 고시·HTML, ⑦ 태그');

    const first = await rerunAll();
    expect(first.codes).toEqual(['PRICING']);
    expect(first.chain).toMatchObject({ stopReason: 'AWAIT_G2', stopStepCode: 'PRICING' });
    // G2가 풀려 있어 남은 낡은 단계(⑥-3·⑦)는 이 버튼으로 못 돈다 — BE와 같은 409. 띠는 [소싱 확정(G2)]을 먼저 알린다
    expect((await rerunStale()).error).toMatchObject({ code: 'CONTINUOUS_RUN_BEFORE_G2' });
    expect(next()).toEqual({
      id: 'rerunStaleNeedsG2',
      path: '/candidates/1/judgement',
      params: { steps: '⑥-3 고시·HTML, ⑦ 태그' },
    });
    const judgement = await api.GET('/candidates/{candidateId}/price-judgement', path);
    await api.POST('/candidates/{candidateId}/gates/{gateCode}/pass', {
      params: { path: { candidateId: id, gateCode: 'G2' } },
      body: { basisStepRunId: judgement.data!.stepRunId },
    });
    expect((await gate('G2')).passed).toBe(true);
    const second = await rerunAll();
    expect(second.codes).toEqual(['NOTICE_HTML', 'TAGS']);
    expect(second.chain.stopReason).toBe('AWAIT_G4');
    expect((await candidate()).status).toBe('AWAITING_APPROVAL');
  });
});

describe('낡음 전파의 경계', () => {
  it('앞 단계를 같은 값으로 다시 실행하면(예시 결과가 늘 같다) 뒤 단계는 낡지 않는다', async () => {
    await reachUploadDone(demo);
    expect((await runStep('COPY')).response.status).toBe(202);
    demo.world.flush();
    expect(await statuses()).toMatchObject(ALL_DONE);
    expect((await candidate()).status).toBe('AWAITING_APPROVAL');
  });

  it('새 실행이 시작되면 낡은 이유가 지워진다 — 재실행 필요 단계를 하나씩 실행해도 같다', async () => {
    await reachUploadDone(demo);
    await savePrice(169_050);
    expect((await rail()).PRICING?.staleInputs).toEqual(['owner.domesticPrice']);
    expect((await runStep('PRICING')).response.status).toBe(202);
    const during = await rail();
    expect(during.PRICING).toMatchObject({ status: 'RUNNING', staleInputs: [], staleSince: null });
    demo.world.flush();
    expect(await statuses()).toMatchObject(ALL_DONE);
  });

  it('재실행 필요가 아닌 단계의 낡음 비교는 409 STEP_NOT_RERUN_REQUIRED', async () => {
    await reachUploadDone(demo);
    const res = await api.GET('/candidates/{candidateId}/steps/{stepCode}/stale-diff', {
      params: { path: { candidateId: id, stepCode: 'UPLOAD' } },
    });
    expect(res.error).toMatchObject({ code: 'STEP_NOT_RERUN_REQUIRED' });
  });
});

describe('띠는 버튼이 지금 거절되는 이유를 알린다(BE 시작 검사와 같은 검사)', () => {
  it('③ 금액을 170000으로 돌려 G2가 풀린 뒤 ⑤ 대표를 다시 고르면: ⑧만 낡았어도 먼저 [소싱 확정(G2)] — 버튼은 409 CONTINUOUS_RUN_BEFORE_G2', async () => {
    await reachUploadDone(demo);
    await savePrice(170_000);
    await rerunAll();
    expect((await gate('G2')).fingerprintValid).toBe(false);
    const { stepRunId, images } = await thumbnailImages();
    await passG3(stepRunId, images[1]!, [images[0]!]);
    expect(await statuses()).toMatchObject({ ...ALL_DONE, UPLOAD: 'RERUN_REQUIRED' });
    // 눌러도 거절될 버튼을 알리지 않는다
    expect((await rerunStale()).error).toMatchObject({ code: 'CONTINUOUS_RUN_BEFORE_G2' });
    expect(next()).toEqual({
      id: 'rerunStaleNeedsG2',
      path: '/candidates/1/judgement',
      params: { steps: '⑧ 이미지 업로드' },
    });
    // G2를 다시 통과하면 버튼이 돌아와 ⑧만 돈다
    const judgement = await api.GET('/candidates/{candidateId}/price-judgement', path);
    await api.POST('/candidates/{candidateId}/gates/{gateCode}/pass', {
      params: { path: { candidateId: id, gateCode: 'G2' } },
      body: { basisStepRunId: judgement.data!.stepRunId },
    });
    expect(next()).toMatchObject({ id: 'rerunStale', params: { steps: '⑧ 이미지 업로드' } });
    const run = await rerunAll();
    expect(run.codes).toEqual(['UPLOAD']);
    expect(run.chain.stopReason).toBe('AWAIT_G4');
    expect((await candidate()).status).toBe('AWAITING_APPROVAL');
  });

  it('⑧이 낡은 채 ⑤를 다시 실행해 선택을 기다리는 중이면: 버튼은 409 STEP_START_CONDITION_UNMET — 띠는 ⑤를 먼저 마치라고 한다', async () => {
    await reachUploadDone(demo);
    const { stepRunId, images } = await thumbnailImages();
    await passG3(stepRunId, images[1]!, [images[0]!]);
    await runStep('THUMBNAIL');
    demo.world.flush();
    expect(await statuses()).toMatchObject({
      THUMBNAIL: 'WAITING_INPUT',
      UPLOAD: 'RERUN_REQUIRED',
    });
    expect((await rerunStale()).error).toMatchObject({ code: 'STEP_START_CONDITION_UNMET' });
    expect(next()).toEqual({
      id: 'rerunStaleNeedsStep',
      path: '/candidates/1/thumbnail',
      params: { steps: '⑧ 이미지 업로드', blocker: '⑤ 썸네일' },
    });
    // ⑤를 마치면(레퍼런스 → 만들기 → G3) 다시 버튼을 알린다 — 새 이미지라 ⑧은 그대로 낡았다
    const run = (await api.GET('/candidates/{candidateId}/thumbnail', path)).data!.stepRunId;
    await api.PUT('/step-runs/{stepRunId}/thumbnail-references', {
      params: { path: { stepRunId: run } },
      body: { references: [{ imageAssetId: 1, sortOrder: 1 }], noPersonConfirmed: true },
    });
    await api.POST('/step-runs/{stepRunId}/generation-runs', {
      params: { path: { stepRunId: run } },
      body: { slotNos: [1, 2], faceOption: 'FULL_FACE', promptAdjustment: null },
    });
    demo.world.flush();
    const made = await thumbnailImages();
    await passG3(run, made.images[0]!, [made.images[1]!]);
    expect(next()).toMatchObject({ id: 'rerunStale', params: { steps: '⑧ 이미지 업로드' } });
    expect((await rerunAll()).codes).toEqual(['UPLOAD']);
  });

  it('연속 실행이 도는 동안은 막힘이 아니라 만드는 중이다(busy)', async () => {
    await reachUploadDone(demo);
    await savePrice(169_050);
    expect((await rerunStale()).response.status).toBe(202);
    expect(demo.world.progress().busy).toBe(true);
    demo.world.flush();
    expect(demo.world.progress().busy).toBe(false);
  });
});

describe('규칙 5 끝 지문 비교: 실행하는 사이 입력이 바뀌면 그 실행은 재실행 필요로 끝난다', () => {
  it('⑧이 도는 동안(약 1초) ⑤ 대표를 다시 고르면 ⑧은 완료가 아니라 재실행 필요이고 승인할 수 없다', async () => {
    await reachUploadDone(demo);
    const { stepRunId, images } = await thumbnailImages();
    // ⑧을 다시 실행해 도는 중에 G3을 다시 통과(BE: 근거 ⑤가 읽는 ②만 잠그므로 ⑧ 실행 중에도 된다)
    expect((await runStep('UPLOAD')).response.status).toBe(202);
    expect((await statuses()).UPLOAD).toBe('RUNNING');
    expect((await passG3(stepRunId, images[1]!, [images[0]!])).response.status).toBe(201);
    // 실행 중인 ⑧은 전파로 바뀌지 않는다
    expect((await statuses()).UPLOAD).toBe('RUNNING');
    demo.world.flush();
    expect(await statuses()).toMatchObject({ ...ALL_DONE, UPLOAD: 'RERUN_REQUIRED' });
    expect((await rail()).UPLOAD).toMatchObject({
      staleInputs: ['thumbnail.selection'],
      currentRun: { status: 'RERUN_REQUIRED', rerunReasonInputs: ['thumbnail.selection'] },
    });
    expect((await candidate()).status).toBe('WORKING');
    expect((await api.GET('/candidates/{candidateId}/approval', path)).error).toMatchObject({
      code: 'CANDIDATE_STATUS_INVALID',
    });
    // 다시 실행하면 새 선택으로 완료된다
    expect(next()).toMatchObject({ id: 'rerunStale', params: { steps: '⑧ 이미지 업로드' } });
    expect((await rerunAll()).codes).toEqual(['UPLOAD']);
    expect((await candidate()).status).toBe('AWAITING_APPROVAL');
  });

  it('③ 입력 대기에서 국내 기준가를 넣어 끝나면 견주지 않고 완료다 — 쓴 금액이 실행에 적힌다(실행 중 오너 입력)', async () => {
    await reachSourcingDone(demo);
    expect((await runStep('PRICING')).response.status).toBe(202);
    demo.world.flush();
    expect((await statuses()).PRICING).toBe('WAITING_INPUT');
    expect((await savePrice(169_000)).response.status).toBe(201);
    demo.world.flush();
    expect((await statuses()).PRICING).toBe('COMPLETED');
    const run = demo.world.s.steps.PRICING.runs[0]!;
    expect(run).toMatchObject({ status: 'COMPLETED', rerunReasonInputs: [] });
    expect(run.inputs?.['owner.domesticPrice']?.sig).toBe('169000');
  });

  it('값이 안 바뀐 실행 중 입력으로는 ⑥ 묶음이 끊기지 않는다', async () => {
    await reachUploadDone(demo);
    expect(demo.world.s.bundle).toEqual([]);
    expect(await statuses()).toMatchObject(ALL_DONE);
  });
});

describe('시작 조건 오류의 칸 이름은 BE 입력 키와 같다', () => {
  it('② 전에 ⑥-1을 실행하면 빠진 입력은 ② 상품명·설명(sourcing.itemText)과 ② SKU 속성(sourcing.skuAttributes)', async () => {
    await reachSourcingSearch(demo);
    const res = await runStep('COPY');
    expect(res.error).toMatchObject({
      code: 'STEP_START_CONDITION_UNMET',
      message: '시작에 필요한 값이 없습니다: ② 상품명·설명, ② SKU 속성.',
      fieldErrors: [{ field: 'sourcing.itemText' }, { field: 'sourcing.skuAttributes' }],
    });
  });
});
