import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_GUIDE_TEXT } from '@/features/guide';
import { api } from '@/shared/api/client';
import type { DemoApi } from '../demoApi';
import { DEMO_GUIDE_ACTIONS, DEMO_GUIDE_TOTAL } from './progress';
import {
  reachRegistered,
  reachSourcingDone,
  reachThumbnailDone,
  reachUploadDone,
  startDemoKit,
} from './testkit';

/**
 * 따라 하기 걷기(D-32) — 전송 계층: 화면이 보내는 요청 그대로 ①→⑨를 순서대로 부르며, 단계마다 (1) 모델 상태(레일·게이트·여정 상태)
 * (2) 띠의 '다음에 할 일' (3) 대시보드·여정 목록 반영 (4) 순서를 어기면 실제 BE의 오류(G1~G4 막기)를 본다.
 * 지연은 0이고 `world.flush()`가 맡겨 둔 결과를 지금 낸다. 끝까지 가는 동안 표에 없는 요청(`unknownRequests`)과 모델 오류(500)는 0건이다.
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
const next = () => demo.world.progress().next?.id ?? null;
const done = () => demo.world.progress().done;

async function rail() {
  const res = await api.GET('/candidates/{candidateId}/steps', path);
  return Object.fromEntries(res.data!.items.map((item) => [item.stepCode, item]));
}
const statuses = async () =>
  Object.fromEntries(Object.entries(await rail()).map(([code, item]) => [code, item.status]));

const runStep = (stepCode: string, body: object = {}) =>
  api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
    params: { path: { candidateId: id, stepCode: stepCode as 'SOURCING' } },
    body,
  });

describe('따라 하기 걷기 ①→⑨', () => {
  it('띠의 일 id는 글 표의 키와 같은 순서이고 19개다', () => {
    expect(DEMO_GUIDE_ACTIONS).toEqual(Object.keys(DEMO_GUIDE_TEXT.actions));
    expect(DEMO_GUIDE_TOTAL).toBe(19);
    expect(demo.world.progress()).toMatchObject({ done: 0, total: 19, next: { id: 'collect' } });
  });

  it('빈 상태에서 등록까지: 단계마다 상태·다음 일·목록 반영이 맞다', async () => {
    // ① [수집]
    await api.POST('/keyword-snapshots', { body: { method: 'BUTTON', rankLimit: 100 } as never });
    expect(next()).toBe('collect');
    expect(demo.world.progress().busy).toBe(true);
    demo.world.flush();
    expect(next()).toBe('useKeyword');
    // ① G1(하나만 고른다 — 다른 줄을 먼저 골랐다가 바꿔도 띠는 같고, 지금 고른 키워드는 마지막으로 고른 줄이다) + 여정 만들기 + ② 실행
    await api.PUT('/keywords/{keywordId}/selection', { params: { path: { keywordId: 100 } } });
    expect(next()).toBe('startSourcing');
    await api.PUT('/keywords/{keywordId}/selection', { params: { path: { keywordId: 101 } } });
    expect(next()).toBe('startSourcing');
    expect(demo.world.progress().done).toBe(2);
    const snapshot = await api.GET('/keyword-snapshots/{keywordSnapshotId}', {
      params: { path: { keywordSnapshotId: 7 } },
    });
    expect(snapshot.data?.selectedKeyword).toMatchObject({ id: 101, keyword: '아식스 젤카야노14' });
    await api.POST('/candidates', {
      body: {
        creationPath: 'KEYWORD',
        sourceKeywordId: 101,
        rakutenQuery: '아식스 젤카야노14',
      } as never,
    });
    expect(next()).toBe('anchor');
    expect(demo.world.progress().candidateId).toBe(id);
    expect((await runStep('SOURCING')).response.status).toBe(202);
    demo.world.flush();
    expect(await statuses()).toMatchObject({ SOURCING: 'WAITING_INPUT', PRICING: 'NOT_RUN' });

    // 대시보드: 진행 중에 여정이 있고, 이어서 할 곳은 ②(입력 대기)
    const list = await api.GET('/candidates', { params: { query: { size: 100 } } });
    expect(list.data?.content.map((c) => [c.id, c.status])).toEqual([[1, 'WORKING']]);
    expect((await api.GET('/candidates/resume-target')).data).toMatchObject({
      stepCode: 'SOURCING',
      stepStatus: 'WAITING_INPUT',
    });

    // ② 앵커 → 고르기
    const comparison = await api.GET('/candidates/{candidateId}/sourcing-comparison', path);
    const cmpId = comparison.data!.id;
    await api.PUT('/sourcing-comparisons/{sourcingComparisonId}/anchor', {
      params: { path: { sourcingComparisonId: cmpId } },
      body: {
        anchorInputMethod: 'SEARCH_PICK',
        anchorItemCode: 'shop-a:10000123',
        anchorColorCode: null,
      } as never,
    });
    expect(next()).toBe('pickShop');
    demo.world.flush();
    await api.PUT('/sourcing-comparisons/{sourcingComparisonId}/selection', {
      params: { path: { sourcingComparisonId: cmpId } },
      body: { rowId: 411 },
    });
    expect(next()).toBe('domesticPrice');
    expect((await statuses()).SOURCING).toBe('COMPLETED');

    // ③ 국내 기준가 → 실행 → G2
    const price = await api.POST('/candidates/{candidateId}/domestic-prices', {
      ...path,
      body: { pRefKrw: 169_000, sourceUrl: null, sourceKind: 'MANUAL' } as never,
    });
    expect(price.response.status).toBe(201);
    expect(next()).toBe('runPricing');
    expect((await runStep('PRICING')).response.status).toBe(202);
    demo.world.flush();
    const judgement = await api.GET('/candidates/{candidateId}/price-judgement', path);
    expect(judgement.data).toMatchObject({
      salePriceKrw: 167_300,
      pRefKrw: 169_000,
      stepStatus: 'COMPLETED',
    });
    expect(next()).toBe('passG2');
    // G2 전에는 ④ 이후 연속 실행이 막힌다(실제 BE와 같다)
    expect(
      (
        await api.POST('/candidates/{candidateId}/continuous-runs', {
          ...path,
          body: { kind: 'FROM_HERE', startStepCode: 'CATEGORY' },
        })
      ).error,
    ).toMatchObject({ code: 'CONTINUOUS_RUN_BEFORE_G2' });
    const g2 = await api.POST('/candidates/{candidateId}/gates/{gateCode}/pass', {
      params: { path: { candidateId: id, gateCode: 'G2' } },
      body: { basisStepRunId: judgement.data!.stepRunId },
    });
    expect(g2.response.status).toBe(201);
    expect(next()).toBe('runCategory');

    // ④ 실행 → 입력 대기 → 확정
    await runStep('CATEGORY');
    demo.world.flush();
    expect((await statuses()).CATEGORY).toBe('WAITING_INPUT');
    const decision = await api.GET('/candidates/{candidateId}/category-decision', path);
    const leaf = decision.data!.categoryOptions!.find((o) =>
      o.wholeCategoryName.endsWith('러닝화'),
    )!;
    expect(next()).toBe('chooseLeaf');
    await api.PUT('/category-decisions/{categoryDecisionId}/selection', {
      params: { path: { categoryDecisionId: decision.data!.id } },
      body: { leafCategoryId: leaf.leafCategoryId, kcExemptAdultConfirmed: false } as never,
    });
    expect((await statuses()).CATEGORY).toBe('COMPLETED');
    expect(next()).toBe('runThumbnail');

    // ⑤ 실행 → 입력 대기(원본) → 레퍼런스 → 만들기 → G3
    await runStep('THUMBNAIL');
    demo.world.flush();
    expect((await statuses()).THUMBNAIL).toBe('WAITING_INPUT');
    expect(next()).toBe('references');
    const before = await api.GET('/candidates/{candidateId}/thumbnail', path);
    const thumbRun = before.data!.stepRunId;
    await api.PUT('/step-runs/{stepRunId}/thumbnail-references', {
      params: { path: { stepRunId: thumbRun } },
      body: { references: [{ imageAssetId: 1, sortOrder: 1 }], noPersonConfirmed: true },
    });
    expect(next()).toBe('generate');
    await api.POST('/step-runs/{stepRunId}/generation-runs', {
      params: { path: { stepRunId: thumbRun } },
      body: { slotNos: [1, 2], faceOption: 'FULL_FACE', promptAdjustment: null },
    });
    expect(demo.world.progress().busy).toBe(true);
    demo.world.flush();
    const generated = await api.GET('/candidates/{candidateId}/thumbnail', path);
    const images = generated.data!.generationRuns.map((run) => run.resultImageAssetId!);
    expect(images).toHaveLength(2);
    expect(next()).toBe('pickThumbnail');
    const g3 = await api.POST('/candidates/{candidateId}/gates/{gateCode}/pass', {
      params: { path: { candidateId: id, gateCode: 'G3' } },
      body: {
        basisStepRunId: thumbRun,
        representativeImageAssetId: images[0],
        additionalImageAssetIds: [images[1]],
        checklist: {
          shoeRatioOver70: true,
          detailMatch: true,
          colorMatchesSelectedColor: true,
          referenceNoPerson: true,
          noRealPersonResemblance: true,
          noTextOrPrice: true,
          singleProductSingleModel: true,
        },
      } as never,
    });
    expect(g3.response.status).toBe(201);
    expect((await statuses()).THUMBNAIL).toBe('COMPLETED');
    expect(next()).toBe('runChain');
    // 아직 승인대기가 아니다: ⑥~⑧이 남았다
    expect((await api.GET('/candidates/{candidateId}', path)).data?.status).toBe('WORKING');

    // ⑥ 연속 실행 → ⑥-1~⑧ → 최종 승인 앞에서 멈춤(승인대기)
    const chain = await api.POST('/candidates/{candidateId}/continuous-runs', {
      ...path,
      body: { kind: 'FROM_HERE', startStepCode: 'COPY' },
    });
    expect(chain.response.status).toBe(202);
    expect(demo.world.progress().busy).toBe(true);
    demo.world.flush();
    expect(await statuses()).toMatchObject({
      COPY: 'COMPLETED',
      NOTICE_RAW: 'COMPLETED',
      NOTICE_HTML: 'COMPLETED',
      TAGS: 'COMPLETED',
      UPLOAD: 'COMPLETED',
      REGISTER: 'NOT_RUN',
    });
    const stopped = await api.GET('/continuous-runs/{stepChainId}', {
      params: { path: { stepChainId: chain.data!.stepChainId } },
    });
    expect(stopped.data).toMatchObject({ stopReason: 'AWAIT_G4', stopStepCode: 'REGISTER' });
    expect((await api.GET('/candidates/{candidateId}', path)).data?.status).toBe(
      'AWAITING_APPROVAL',
    );
    expect(next()).toBe('approveDryRun');

    // 최종 승인: 사전 검증 → 차단 켬 = 드라이런
    const preview = await api.GET('/candidates/{candidateId}/approval', path);
    expect(preview.data).toMatchObject({ approveEnabled: true, apiBlocked: true });
    const pre = await api.POST('/candidates/{candidateId}/pre-validations', {
      ...path,
      body: { optionType: 'COMBINATION' },
    });
    expect(pre.data?.checks).toHaveLength(15);
    const approveBody = {
      optionType: 'COMBINATION' as const,
      expectedUploadResultId: preview.data!.uploadResultId,
      expectedPriceJudgementId: preview.data!.priceJudgementId,
    };
    const dry = await api.POST('/candidates/{candidateId}/registrations', {
      ...path,
      params: { ...path.params, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: approveBody,
    });
    expect(dry.response.status).toBe(202);
    expect(dry.data?.status).toBe('VALIDATED');
    expect((await api.GET('/candidates/{candidateId}', path)).data?.status).toBe('VALIDATED');
    expect(next()).toBe('switchOff');
    // 검증완료 뒤에는 승인 미리보기가 409(실제 BE와 같다)
    expect((await api.GET('/candidates/{candidateId}/approval', path)).error).toMatchObject({
      code: 'CANDIDATE_STATUS_INVALID',
    });

    // 차단 끄기 → 승인대기로 → 실등록
    const switchOff = await api.PUT('/registration-switch', { body: { apiBlocked: false } });
    expect(switchOff.data).toMatchObject({ apiBlocked: false, revertedCandidateIds: [id] });
    expect((await api.GET('/candidates/{candidateId}', path)).data?.status).toBe(
      'AWAITING_APPROVAL',
    );
    expect(next()).toBe('approve');
    const live = await api.POST('/candidates/{candidateId}/registrations', {
      ...path,
      params: { ...path.params, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: approveBody,
    });
    expect(live.data?.status).toBe('REGISTERING');
    expect((await api.GET('/candidates/{candidateId}', path)).data?.status).toBe('REGISTERING');
    demo.world.flush();
    expect((await api.GET('/candidates/{candidateId}', path)).data?.status).toBe('REGISTERED');
    expect(demo.world.progress()).toMatchObject({ registered: true, next: { id: 'switchOn' } });
    // 등록된 여정은 M1 목록(진행 중)에서 빠진다
    const after = await api.GET('/candidates', { params: { query: { size: 100 } } });
    expect(after.data?.content).toEqual([]);
    const records = await api.GET('/candidates/{candidateId}/registrations', path);
    expect(records.data?.content.map((r) => r.status)).toEqual(['REGISTERED', 'VALIDATED']);
    expect(records.data?.content[0]?.originProductNo).not.toBeNull();
    const gates = await api.GET('/candidates/{candidateId}/gates', path);
    expect(gates.data?.items.map((g) => [g.gate, g.passed])).toEqual([
      ['G1', true],
      ['G2', true],
      ['G3', true],
      ['G4', true],
    ]);

    // 차단 다시 켜기 = 19/19
    await api.PUT('/registration-switch', { body: { apiBlocked: true } });
    expect(demo.world.progress()).toMatchObject({ done: 19, next: null, registered: true });
    expect(done()).toBe(DEMO_GUIDE_TOTAL);

    // 처음부터 다시
    demo.world.reset();
    expect(demo.world.progress()).toMatchObject({ done: 0, candidateId: null, registered: false });
    expect(
      (await api.GET('/candidates', { params: { query: { size: 100 } } })).data?.content,
    ).toEqual([]);
  });

  it('차단 스위치를 먼저 끄고 첫 승인을 하면 드라이런이 아니라 등록이고, 띠 글도 그렇게 말한다', async () => {
    await reachUploadDone(demo);
    expect(next()).toBe('approveDryRun');
    expect(demo.world.progress().next).toEqual({
      id: 'approveDryRun',
      path: '/candidates/1/approval',
    });
    await api.PUT('/registration-switch', { body: { apiBlocked: false } });
    // 차단이 꺼져 있으면 '켜져 있어 드라이런' 글이 거짓이 되므로 다른 글을 가리킨다
    expect(demo.world.progress().next).toEqual({
      id: 'approveBlockOff',
      path: '/candidates/1/approval',
    });
    const preview = await api.GET('/candidates/{candidateId}/approval', path);
    expect(preview.data).toMatchObject({ approveEnabled: true, apiBlocked: false });
    const live = await api.POST('/candidates/{candidateId}/registrations', {
      ...path,
      params: { ...path.params, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: {
        optionType: 'COMBINATION',
        expectedUploadResultId: preview.data!.uploadResultId,
        expectedPriceJudgementId: preview.data!.priceJudgementId,
      },
    });
    // 드라이런(VALIDATED)이 아니라 실제 등록 진행(REGISTERING → REGISTERED)
    expect(live.data?.status).toBe('REGISTERING');
    demo.world.flush();
    expect((await api.GET('/candidates/{candidateId}', path)).data?.status).toBe('REGISTERED');
    const records = await api.GET('/candidates/{candidateId}/registrations', path);
    expect(records.data?.content.map((r) => r.status)).toEqual(['REGISTERED']);
    expect(next()).toBe('switchOn');
  });

  it('G1~G4: 순서를 건너뛰면 실제 BE의 오류가 난다(한 걸음도 못 나간다)', async () => {
    // 여정 전에는 단계 실행·게이트 모두 CANDIDATE_NOT_FOUND
    expect((await runStep('PRICING')).error).toMatchObject({ code: 'CANDIDATE_NOT_FOUND' });
    // G1: 고르지 않은 키워드로는 여정을 못 만든다
    await api.POST('/keyword-snapshots', { body: { method: 'BUTTON', rankLimit: 100 } as never });
    demo.world.flush();
    expect(
      (
        await api.POST('/candidates', {
          body: { creationPath: 'KEYWORD', sourceKeywordId: 101, rakutenQuery: 'a' } as never,
        })
      ).error,
    ).toMatchObject({ code: 'KEYWORD_NOT_SELECTED' });
    await api.PUT('/keywords/{keywordId}/selection', { params: { path: { keywordId: 101 } } });
    await api.POST('/candidates', {
      body: {
        creationPath: 'KEYWORD',
        sourceKeywordId: 101,
        rakutenQuery: '아식스 젤카야노14',
      } as never,
    });
    // ② 전에는 ③~⑧ 모두 시작 조건 409
    for (const code of [
      'PRICING',
      'CATEGORY',
      'THUMBNAIL',
      'COPY',
      'NOTICE_RAW',
      'NOTICE_HTML',
      'TAGS',
      'UPLOAD',
    ]) {
      const res = await runStep(code);
      expect(res.response.status, code).toBe(409);
      expect(res.error, code).toMatchObject({ code: 'STEP_START_CONDITION_UNMET' });
    }
    // G2·G3: 근거 단계가 끝나기 전에는 통과할 수 없다
    const g2 = await api.POST('/candidates/{candidateId}/gates/{gateCode}/pass', {
      params: { path: { candidateId: id, gateCode: 'G2' } },
      body: { basisStepRunId: 1 },
    });
    expect(g2.response.status).toBeGreaterThanOrEqual(409);
    // G4(승인): ⑧ 전에는 미리보기·사전 검증·승인이 409(작업중)
    const preview = await api.GET('/candidates/{candidateId}/approval', path);
    expect(preview.error).toMatchObject({
      code: 'CANDIDATE_STATUS_INVALID',
      message: '지금 여정 상태(작업중)에서는 할 수 없습니다.',
    });
    const pre = await api.POST('/candidates/{candidateId}/pre-validations', {
      ...path,
      body: { optionType: 'COMBINATION' },
    });
    expect(pre.error).toMatchObject({ code: 'CANDIDATE_STATUS_INVALID' });
    // 단계 산출물은 실제 BE처럼 404 STEP_OUTPUT_NOT_FOUND
    for (const url of [
      '/candidates/{candidateId}/price-judgement',
      '/candidates/{candidateId}/category-decision',
      '/candidates/{candidateId}/thumbnail',
      '/candidates/{candidateId}/content-copy',
      '/candidates/{candidateId}/content-fact',
      '/candidates/{candidateId}/content-assembly',
      '/candidates/{candidateId}/tag-set',
      '/candidates/{candidateId}/upload-result',
    ] as const) {
      const res = await api.GET(url, path);
      expect(res.response.status, url).toBe(404);
      expect(res.error, url).toMatchObject({ code: 'STEP_OUTPUT_NOT_FOUND' });
    }
  });

  it('되돌아가도 안전하다: ③ 금액을 바꾸면 재실행 필요(승인대기 해제), 같은 금액으로 다시 실행하면 G2 그대로 승인대기로 돌아온다', async () => {
    await reachUploadDone(demo);
    expect((await api.GET('/candidates/{candidateId}', path)).data?.status).toBe(
      'AWAITING_APPROVAL',
    );
    // 같은 금액을 다시 저장해도 아무 일 없다
    await api.POST('/candidates/{candidateId}/domestic-prices', {
      ...path,
      body: { pRefKrw: 169_000, sourceUrl: null, sourceKind: 'MANUAL' } as never,
    });
    expect((await statuses()).PRICING).toBe('COMPLETED');
    // 다른 금액이면 ③은 재실행 필요
    await api.POST('/candidates/{candidateId}/domestic-prices', {
      ...path,
      body: { pRefKrw: 175_000, sourceUrl: null, sourceKind: 'MANUAL' } as never,
    });
    const items = await rail();
    expect(items.PRICING).toMatchObject({
      status: 'RERUN_REQUIRED',
      staleInputs: ['owner.domesticPrice'],
    });
    const diff = await api.GET('/candidates/{candidateId}/steps/{stepCode}/stale-diff', {
      params: { path: { candidateId: id, stepCode: 'PRICING' } },
    });
    expect(diff.data).toMatchObject({
      status: 'RERUN_REQUIRED',
      staleInputs: ['owner.domesticPrice'],
    });
    // BE처럼: ③만 재실행 필요이고 옛 판정은 그대로라 G2 지문은 유효하다. 여정은 필수 단계가 최신이 아니라 작업중으로 돌아간다
    const gates = await api.GET('/candidates/{candidateId}/gates', path);
    expect(gates.data?.items.find((g) => g.gate === 'G2')).toMatchObject({
      passed: true,
      fingerprintValid: true,
      changedBasisKeys: [],
    });
    expect((await api.GET('/candidates/{candidateId}', path)).data?.status).toBe('WORKING');
    const history = await api.GET('/candidates/{candidateId}/status-history', path);
    expect(history.data?.content[0]).toMatchObject({
      fromStatus: 'AWAITING_APPROVAL',
      toStatus: 'WORKING',
      reason: 'STEP_NOT_CURRENT',
    });
    expect(next()).toBe('rerunStale');
    const attention = await api.GET('/candidate-steps');
    expect(attention.data?.content.map((a) => [a.stepCode, a.status, a.staleInputs])).toEqual([
      ['PRICING', 'RERUN_REQUIRED', ['owner.domesticPrice']],
    ]);
    // 이전 값으로 되돌려 다시 실행하면 판정이 같아 G2는 그대로 유효하고, 여정은 다시 통과하지 않아도 승인대기로 돌아온다
    await api.POST('/candidates/{candidateId}/domestic-prices', {
      ...path,
      body: { pRefKrw: 169_000, sourceUrl: null, sourceKind: 'MANUAL' } as never,
    });
    expect((await runStep('PRICING')).response.status).toBe(202);
    demo.world.flush();
    expect((await statuses()).PRICING).toBe('COMPLETED');
    const judgement = await api.GET('/candidates/{candidateId}/price-judgement', path);
    expect(judgement.data?.salePriceKrw).toBe(167_300);
    expect((await api.GET('/candidates/{candidateId}', path)).data?.status).toBe(
      'AWAITING_APPROVAL',
    );
    const again = await api.POST('/candidates/{candidateId}/gates/{gateCode}/pass', {
      params: { path: { candidateId: id, gateCode: 'G2' } },
      body: { basisStepRunId: judgement.data!.stepRunId },
    });
    expect(again.response.status).toBe(200);
    expect(
      (
        await api.GET('/candidates/{candidateId}/steps/{stepCode}/runs', {
          params: { path: { candidateId: id, stepCode: 'PRICING' } },
        })
      ).data?.content.map((v) => [v.version, v.isCurrent]),
    ).toEqual([
      [2, true],
      [1, false],
    ]);
  });

  it('연속 실행: ②에서 시작하면 입력 대기에서 판정(G2) 앞에 멈춘다', async () => {
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
    const chain = await api.POST('/candidates/{candidateId}/continuous-runs', {
      ...path,
      body: { kind: 'FROM_HERE', startStepCode: 'SOURCING' },
    });
    expect(chain.response.status).toBe(202);
    // 열려 있는 동안: 여정에 열린 묶음이 보이고, 다시 시작하거나 다른 단계를 이어 시작할 수 없다
    const open = await api.GET('/candidates/{candidateId}', path);
    expect(open.data?.openContinuousRun).toMatchObject({
      id: chain.data!.stepChainId,
      endedAt: null,
    });
    expect(demo.world.progress().busy).toBe(true);
    const again = await api.POST('/candidates/{candidateId}/continuous-runs', {
      ...path,
      body: { kind: 'FROM_HERE', startStepCode: 'SOURCING' },
    });
    expect(again.error).toMatchObject({ code: 'CONTINUOUS_RUN_ALREADY_OPEN' });
    expect((await rail()).PRICING?.actions.continuousRun.disabledReason?.code).toBe(
      'CONTINUOUS_RUN_ALREADY_OPEN',
    );
    demo.world.flush();
    const stopped = await api.GET('/continuous-runs/{stepChainId}', {
      params: { path: { stepChainId: chain.data!.stepChainId } },
    });
    expect(stopped.data).toMatchObject({
      stopReason: 'AWAIT_G2',
      stopStepCode: 'SOURCING',
      skippedStepCodes: [],
    });
    expect(stopped.data?.stepRuns.map((r) => [r.stepCode, r.executionMode, r.status])).toEqual([
      ['SOURCING', 'CHAIN', 'WAITING_INPUT'],
    ]);
    expect((await api.GET('/candidates/{candidateId}', path)).data?.openContinuousRun).toBeNull();
  });

  it('연속 실행: ③에서 시작하면 판정이 끝나고 G2 앞에서 멈춘다(국내 기준가가 있으면)', async () => {
    await reachSourcingDone(demo);
    await api.POST('/candidates/{candidateId}/domestic-prices', {
      ...path,
      body: { pRefKrw: 169_000, sourceUrl: null, sourceKind: 'MANUAL' } as never,
    });
    const chain = await api.POST('/candidates/{candidateId}/continuous-runs', {
      ...path,
      body: { kind: 'FROM_HERE', startStepCode: 'PRICING' },
    });
    expect(chain.response.status).toBe(202);
    demo.world.flush();
    expect((await statuses()).PRICING).toBe('COMPLETED');
    const stopped = await api.GET('/continuous-runs/{stepChainId}', {
      params: { path: { stepChainId: chain.data!.stepChainId } },
    });
    expect(stopped.data).toMatchObject({ stopReason: 'AWAIT_G2', stopStepCode: 'PRICING' });
    // 한 번 돈 단계를 같은 묶음에서 두 번 돌리지 않는다
    expect(stopped.data?.stepRuns).toHaveLength(1);
  });

  it('⑥ 묶음 [실행]: ⑥-1 → ⑥-2 → ⑥-3만 차례로 돌고 ⑦·⑧은 건드리지 않는다', async () => {
    await reachThumbnailDone(demo);
    const run = await api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
      params: { path: { candidateId: id, stepCode: 'COPY' } },
      body: { throughStepCode: 'NOTICE_HTML' },
    });
    expect(run.response.status).toBe(202);
    expect(run.data?.stepRunIds).toHaveLength(1);
    expect(await statuses()).toMatchObject({ COPY: 'RUNNING', NOTICE_RAW: 'NOT_RUN' });
    demo.world.flush();
    expect(await statuses()).toMatchObject({
      COPY: 'COMPLETED',
      NOTICE_RAW: 'COMPLETED',
      NOTICE_HTML: 'COMPLETED',
      TAGS: 'NOT_RUN',
      UPLOAD: 'NOT_RUN',
    });
    expect((await rail()).NOTICE_RAW?.currentRun?.executionMode).toBe('STEP');
    // 다음 일은 아직 [여기부터 연속 실행]이다(⑧이 안 끝났다)
    expect(next()).toBe('runChain');
  });

  it('등록까지 끝낸 뒤에는 여정이 잠겨 단계 실행·연속 실행이 CANDIDATE_LOCKED로 막힌다', async () => {
    await reachRegistered(demo);
    const run = await runStep('SOURCING');
    expect(run.error).toMatchObject({
      code: 'CANDIDATE_LOCKED',
      message: '등록을 진행 중이거나 끝난 여정이라 바꿀 수 없습니다.',
    });
    const chain = await api.POST('/candidates/{candidateId}/continuous-runs', {
      ...path,
      body: { kind: 'FROM_HERE', startStepCode: 'COPY' },
    });
    expect(chain.error).toMatchObject({ code: 'CANDIDATE_LOCKED' });
    expect((await rail()).SOURCING?.actions.run.disabledReason?.code).toBe('CANDIDATE_LOCKED');
    // 등록 결과는 계속 읽힌다
    expect(
      (await api.GET('/candidates/{candidateId}/registrations', path)).data?.content,
    ).toHaveLength(2);
  });
});
