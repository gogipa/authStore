import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@/shared/api/client';
import type { DemoApi } from '../../demoApi';
import { reachCategoryDone, reachSourcingDone, startDemoKit } from '../testkit';
import { thumbnailPhase } from './thumbnail';

/**
 * ⑤ 썸네일 · G3 썸네일 선택(D-32): 실행(원본 받기) → 입력 대기 → 레퍼런스 → 프롬프트 미리보기 → 생성(RUNNING → SUCCEEDED) → 대표·추가 +
 * 체크 7개 → G3 통과 = ⑤ 완료. 실제 `api` 클라이언트로 화면이 보내는 요청 그대로 부르고, 실제 BE의 상태·오류 문구를 글자 그대로 확인한다.
 * 지연은 0이고 `world.flush()`가 맡겨 둔 결과를 지금 낸다.
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

const CHECKLIST = {
  shoeRatioOver70: true,
  detailMatch: true,
  colorMatchesSelectedColor: true,
  referenceNoPerson: true,
  noRealPersonResemblance: true,
  noTextOrPrice: true,
  singleProductSingleModel: true,
};

const runThumbnail = () =>
  api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
    params: { path: { candidateId: id, stepCode: 'THUMBNAIL' } },
    body: {},
  });

const output = () => api.GET('/candidates/{candidateId}/thumbnail', path);

const sources = (query: object = {}) =>
  api.GET('/candidates/{candidateId}/source-images', {
    params: { path: { candidateId: id }, query: query as never },
  });

const putRefs = (stepRunId: number, body: object) =>
  api.PUT('/step-runs/{stepRunId}/thumbnail-references', {
    params: { path: { stepRunId } },
    body: body as never,
  });

const preview = (body: object) => api.POST('/thumbnail-prompt-previews', { body: body as never });

const generate = (stepRunId: number, body: object) =>
  api.POST('/step-runs/{stepRunId}/generation-runs', {
    params: { path: { stepRunId } },
    body: body as never,
  });

const passG3 = (body: object) =>
  api.POST('/candidates/{candidateId}/gates/{gateCode}/pass', {
    params: { path: { candidateId: id, gateCode: 'G3' } },
    body: body as never,
  });

async function stepOf(code: string) {
  const rail = await api.GET('/candidates/{candidateId}/steps', path);
  return rail.data!.items.find((item) => item.stepCode === code)!;
}

const g3State = async () =>
  (await api.GET('/candidates/{candidateId}/gates', path)).data!.items.find(
    (g) => g.gate === 'G3',
  )!;

/** ② 완료 → ⑤ 실행 → 입력 대기(③·④·G2 없이도 된다) */
async function waiting() {
  await reachSourcingDone(demo);
  await runThumbnail();
  demo.world.flush();
  return (await output()).data!.stepRunId;
}

async function withReferences() {
  const run = await waiting();
  await putRefs(run, { references: [{ imageAssetId: 1, sortOrder: 1 }], noPersonConfirmed: true });
  return run;
}

async function generated() {
  const run = await withReferences();
  await generate(run, { slotNos: [1, 2], faceOption: 'FULL_FACE', promptAdjustment: null });
  demo.world.flush();
  return run;
}

describe('⑤ 실행 전', () => {
  it('산출물 조회는 404 STEP_OUTPUT_NOT_FOUND, 원본 목록은 빈 목록, 낯선 실행 id는 404', async () => {
    await reachSourcingDone(demo);
    const res = await output();
    expect(res.response.status).toBe(404);
    expect(res.error).toMatchObject({
      code: 'STEP_OUTPUT_NOT_FOUND',
      message: '아직 ⑤ 썸네일을 실행하지 않았습니다.',
      details: { stepCode: 'THUMBNAIL' },
    });
    expect((await sources()).data).toEqual({ itemCode: 'shop-a:10000123', items: [] });
    expect((await putRefs(777, {})).error).toMatchObject({
      code: 'STEP_RUN_NOT_FOUND',
      message: '실행 기록을 찾을 수 없습니다.',
    });
    expect((await preview({ stepRunId: 777, faceOption: 'FULL_FACE' })).error).toMatchObject({
      code: 'STEP_RUN_NOT_FOUND',
    });
    expect((await generate(777, { slotNos: [1], faceOption: 'FULL_FACE' })).error).toMatchObject({
      code: 'STEP_RUN_NOT_FOUND',
    });
    expect(
      (
        await api.GET('/generation-runs/{generationRunId}', {
          params: { path: { generationRunId: 9 } },
        })
      ).error,
    ).toMatchObject({
      code: 'GENERATION_RUN_NOT_FOUND',
      message: '썸네일 생성 기록을 찾을 수 없습니다.',
    });
    // 근거 단계(⑤)가 없어 G3은 현재 버전이 없다
    expect(
      (
        await passG3({
          basisStepRunId: 1,
          representativeImageAssetId: 901,
          additionalImageAssetIds: [],
          checklist: CHECKLIST,
        })
      ).error,
    ).toMatchObject({
      code: 'VERSION_NOT_CURRENT',
      details: { stepCode: 'THUMBNAIL', currentStepRunId: null },
    });
    expect(await g3State()).toMatchObject({
      passed: false,
      blockedReasons: [
        {
          code: 'STEP_NOT_COMPLETED',
          message: '⑤ 썸네일이 아직 완료되지 않았습니다(지금: 미실행).',
        },
      ],
    });
  });

  it('② 전에는 시작 조건 409(② 소싱 선택)', async () => {
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
    expect((await runThumbnail()).error).toMatchObject({
      code: 'STEP_START_CONDITION_UNMET',
      message: '시작에 필요한 값이 없습니다: ② 소싱 선택.',
    });
  });
});

describe('⑤ 실행 → 원본 받기 → 입력 대기', () => {
  it('G2 전에도 실행되고(레일에 비용 경고), 실행 중에는 산출물이 RUNNING으로 보인다', async () => {
    await reachSourcingDone(demo);
    const item = await stepOf('THUMBNAIL');
    expect(item.warnings.map((w) => w.code)).toEqual(['PRE_G2_AI_COST']);
    const accepted = await runThumbnail();
    expect(accepted.response.status).toBe(202);
    expect(accepted.data).toMatchObject({
      stepCode: 'THUMBNAIL',
      status: 'RUNNING',
      version: 1,
      aiEngine: null,
    });
    const runId = accepted.data!.stepRunId;
    // 실행 중: 산출물은 200(상태 RUNNING), 원본은 아직 없다, 같은 단계를 또 누르면 409
    expect((await output()).data).toMatchObject({
      stepRunId: runId,
      stepRunStatus: 'RUNNING',
      isCurrent: true,
      references: [],
      referencesConfirmed: false,
      generationRuns: [],
      selection: null,
      candidateCount: 2,
      sameProductColorRequired: false,
    });
    expect((await sources()).data?.items).toEqual([]);
    expect((await runThumbnail()).error).toMatchObject({
      code: 'STEP_ALREADY_RUNNING',
      message: '이 단계가 이미 실행 중입니다.',
    });
    demo.world.flush();

    // 입력 대기: 원본 3장(같은 앵커·색상 코드 있음)
    const waitingItem = await stepOf('THUMBNAIL');
    expect(waitingItem.status).toBe('WAITING_INPUT');
    expect(waitingItem.actions.run.disabledReason?.message).toBe(
      '이 단계가 입력을 기다리고 있습니다. 입력을 마치면 이어서 실행됩니다.',
    );
    expect(demo.world.s.steps.THUMBNAIL.runs.at(-1)).toMatchObject({
      waitingReasonCode: 'THUMBNAIL_REFERENCE_REQUIRED',
      pendingInputs: ['owner.referenceSelection'],
    });
    const list = (await sources({ sourceSection: 'PRODUCT_IMAGE' })).data!;
    expect(list.itemCode).toBe('shop-a:10000123');
    expect(list.items.map((i) => i.imageAssetId)).toEqual([1, 2, 3]);
    expect(list.items[0]).toMatchObject({
      kind: 'ORIGINAL',
      sourceSection: 'PRODUCT_IMAGE',
      usageRight: 'REFERENCE_ONLY',
      isSameAnchor: true,
      sourceColorCode: '108',
      sourceShopCode: 'shop-a',
    });
    expect(list.items[0]?.fileUrl).toBeTruthy();
    expect((await sources({ sourceSection: 'DESCRIPTION_IMAGE' })).data?.items).toEqual([]);
    expect((await sources({ sourceSection: 'NOPE' })).error).toMatchObject({
      code: 'INVALID_QUERY_PARAMETER',
    });
    expect((await output()).data).toMatchObject({ stepRunStatus: 'WAITING_INPUT', references: [] });
    expect(thumbnailPhase(demo.world.s.thumbnail)).toBe('NONE');
    // ⑤는 G3을 통과해야 끝난다: 아직 통과할 수 있는 상태(입력 대기)지만 막힌 이유는 없다
    expect(await g3State()).toMatchObject({ passed: false, blockedReasons: [] });
  });
});

describe('레퍼런스 · 프롬프트 미리보기', () => {
  it('레퍼런스를 저장하면 확인한 레퍼런스가 산출물에 보이고 미리보기의 생성 허용이 켜진다', async () => {
    const run = await waiting();
    const before = await preview({
      stepRunId: run,
      faceOption: 'FULL_FACE',
      promptAdjustment: null,
    });
    expect(before.response.status).toBe(200);
    expect(before.data).toMatchObject({
      faceOption: 'FULL_FACE',
      requestedSizePx: 1024,
      promptAdjusted: false,
      realPersonNameDetected: false,
      blockedTerms: [],
      generationAllowed: false,
    });
    expect(before.data?.prompt).toContain('1024 pixels');
    expect(before.data?.prompt).toContain('Model framing: full face.');
    expect(before.data?.prompt).not.toContain('{');

    const saved = await putRefs(run, {
      references: [
        { imageAssetId: 2, sortOrder: 2 },
        { imageAssetId: 1, sortOrder: 1 },
      ],
      noPersonConfirmed: true,
    });
    expect(saved.response.status).toBe(200);
    expect(saved.data).toMatchObject({
      stepRunId: run,
      inputNo: 1,
      sameProductColorRequired: false,
    });
    expect(
      saved.data?.references.map((r) => [r.imageAssetId, r.sortOrder, r.isSameAnchor]),
    ).toEqual([
      [1, 1, true],
      [2, 2, true],
    ]);
    expect(saved.data?.references[0]?.noPersonConfirmedAt).toBeTruthy();
    expect(demo.world.progress().next?.id).toBe('domesticPrice');
    expect(thumbnailPhase(demo.world.s.thumbnail)).toBe('REFERENCES');
    // 같은 선택이면 새 번호 없이 200, 다른 선택이면 번호가 오른다
    const same = await putRefs(run, {
      references: [
        { imageAssetId: 1, sortOrder: 1 },
        { imageAssetId: 2, sortOrder: 2 },
      ],
      noPersonConfirmed: true,
    });
    expect(same.data?.inputNo).toBe(1);
    const other = await putRefs(run, {
      references: [{ imageAssetId: 3, sortOrder: 1 }],
      noPersonConfirmed: true,
    });
    expect(other.data?.inputNo).toBe(2);

    const out = (await output()).data!;
    expect(out.referencesConfirmed).toBe(true);
    expect(out.references.map((r) => r.imageAssetId)).toEqual([3]);
    const after = await preview({
      stepRunId: run,
      faceOption: 'CHIN_CROP',
      promptAdjustment: '  softer light  ',
    });
    expect(after.data).toMatchObject({
      promptAdjusted: true,
      generationAllowed: true,
      faceOption: 'CHIN_CROP',
    });
    expect(after.data?.prompt).toContain('crop at chin (face not shown)');
    expect(after.data?.prompt.endsWith('\n\nsofter light')).toBe(true);
  });

  it('실존 인물 이름은 200으로 걸러 낸다(BTS 등) — 생성 허용 꺼짐', async () => {
    const run = await withReferences();
    const res = await preview({
      stepRunId: run,
      faceOption: 'FULL_FACE',
      promptAdjustment: 'like bts, not debts',
    });
    expect(res.response.status).toBe(200);
    expect(res.data).toMatchObject({
      realPersonNameDetected: true,
      blockedTerms: ['BTS'],
      generationAllowed: false,
    });
    // 'debts'처럼 영문이 붙은 낱말은 걸리지 않는다
    const safe = await preview({
      stepRunId: run,
      faceOption: 'FULL_FACE',
      promptAdjustment: 'debts',
    });
    expect(safe.data?.realPersonNameDetected).toBe(false);
    const korean = await preview({
      stepRunId: run,
      faceOption: 'FULL_FACE',
      promptAdjustment: '뉴진스 스타일',
    });
    expect(korean.data?.blockedTerms).toEqual(['뉴진스']);
    expect(
      (await preview({ stepRunId: run, faceOption: 'FACE' })).error?.fieldErrors?.[0],
    ).toMatchObject({
      field: 'faceOption',
      message: 'FULL_FACE·CHIN_CROP·HANDS_UPPER_BODY 중 하나여야 합니다.',
    });
  });

  it('레퍼런스 저장 오류: 장수 · 확인 · 이미지 종류 · 없는 이미지 · 겹침', async () => {
    const run = await waiting();
    const ref = (imageAssetId: number, sortOrder: number) => ({ imageAssetId, sortOrder });
    const countMessage = '고른 이미지 수가 맞지 않습니다(레퍼런스 1~3장, 추가이미지 9장까지).';
    const none = await putRefs(run, { references: [], noPersonConfirmed: true });
    expect(none.response.status).toBe(422);
    expect(none.error).toMatchObject({ code: 'IMAGE_COUNT_INVALID', message: countMessage });
    const four = await putRefs(run, {
      references: [ref(1, 1), ref(2, 2), ref(3, 3), ref(901, 3)],
      noPersonConfirmed: true,
    });
    expect(four.error).toMatchObject({
      code: 'IMAGE_COUNT_INVALID',
      details: { count: 4, min: 1, max: 3 },
    });
    for (const noPerson of [false, undefined]) {
      const res = await putRefs(run, { references: [ref(1, 1)], noPersonConfirmed: noPerson });
      expect(res.error).toMatchObject({
        code: 'NO_PERSON_CONFIRMATION_REQUIRED',
        message: "'사람·얼굴 없음'을 체크해 주세요.",
      });
    }
    const dup = await putRefs(run, { references: [ref(1, 1), ref(1, 2)], noPersonConfirmed: true });
    expect(dup.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [
        { field: 'references', message: '같은 이미지나 같은 순서를 두 번 넣을 수 없습니다.' },
      ],
    });
    const order = await putRefs(run, { references: [ref(1, 4)], noPersonConfirmed: true });
    expect(order.error?.fieldErrors?.[0]).toMatchObject({
      field: 'references.sortOrder',
      message: '1~3이어야 합니다.',
    });
    const generatedImage = await putRefs(run, {
      references: [ref(901, 1)],
      noPersonConfirmed: true,
    });
    expect(generatedImage.error).toMatchObject({
      code: 'IMAGE_NOT_ALLOWED',
      message:
        '이 이미지는 여기에 쓸 수 없습니다(라쿠텐 원본 이미지만 레퍼런스로 고를 수 있습니다).',
      details: { imageAssetId: 901, reason: 'NOT_ORIGINAL' },
    });
    const unknown = await putRefs(run, { references: [ref(8888, 1)], noPersonConfirmed: true });
    expect(unknown.response.status).toBe(404);
    expect(unknown.error).toMatchObject({
      code: 'IMAGE_ASSET_NOT_FOUND',
      message: '이미지를 찾을 수 없습니다.',
    });
    expect(demo.world.s.thumbnail.references).toEqual([]);
    // 다른 단계의 실행에는 보낼 수 없다
    const sourcingRun = demo.world.s.steps.SOURCING.runs.at(-1)!.id;
    expect(
      (await putRefs(sourcingRun, { references: [ref(1, 1)], noPersonConfirmed: true })).error,
    ).toMatchObject({
      code: 'INVALID_STEP_CODE',
      message: '이 단계는 여기서 실행하거나 고칠 수 없습니다.',
      details: { reason: 'NOT_THUMBNAIL' },
    });
  });
});

describe('생성', () => {
  it('레퍼런스 확인 전에는 409 REFERENCES_NOT_CONFIRMED', async () => {
    const run = await waiting();
    const res = await generate(run, {
      slotNos: [1, 2],
      faceOption: 'FULL_FACE',
      promptAdjustment: null,
    });
    expect(res.response.status).toBe(409);
    expect(res.error).toMatchObject({
      code: 'REFERENCES_NOT_CONFIRMED',
      message: "레퍼런스 컷을 고르고 '사람·얼굴 없음'을 체크해 주세요.",
      details: { stepRunId: run, referenceCount: 0 },
    });
  });

  it('요청 모양 · 실존 인물 이름 오류', async () => {
    const run = await withReferences();
    const bad = await generate(run, { slotNos: [1, 3], faceOption: 'NOPE', promptAdjustment: 5 });
    expect(bad.response.status).toBe(422);
    expect(bad.error?.code).toBe('VALIDATION_FAILED');
    expect(bad.error?.fieldErrors?.map((f) => [f.field, f.message])).toEqual([
      ['slotNos', '후보 번호는 1~2 안의 서로 다른 정수 1개 이상이어야 합니다.'],
      ['faceOption', 'FULL_FACE·CHIN_CROP·HANDS_UPPER_BODY 중 하나여야 합니다.'],
      ['promptAdjustment', '2000자 이하 글이어야 합니다.'],
    ]);
    for (const slotNos of [[], [1, 1], [0]]) {
      const res = await generate(run, { slotNos, faceOption: 'FULL_FACE' });
      expect(res.error?.fieldErrors?.[0]?.field).toBe('slotNos');
    }
    const blocked = await generate(run, {
      slotNos: [1],
      faceOption: 'FULL_FACE',
      promptAdjustment: 'make it like BTS and 카리나',
    });
    expect(blocked.response.status).toBe(422);
    expect(blocked.error).toMatchObject({
      code: 'REAL_PERSON_NAME_BLOCKED',
      message: '프롬프트에 실존 인물 이름(BTS, 카리나)이 있어 만들 수 없습니다.',
      details: { blockedTerms: ['BTS', '카리나'] },
    });
    expect(demo.world.s.thumbnail.generations).toEqual([]);
  });

  it('202 → 번호 1·2가 RUNNING(생성 중) → 지연 뒤 SUCCEEDED(901·902)', async () => {
    const run = await withReferences();
    const res = await generate(run, {
      slotNos: [2, 1],
      faceOption: 'FULL_FACE',
      promptAdjustment: null,
    });
    expect(res.response.status).toBe(202);
    expect(res.data).toEqual({
      stepRunId: run,
      candidateId: id,
      generationRuns: [
        {
          generationRunId: 701,
          slotNo: 1,
          attemptNo: 1,
          triggerType: 'INITIAL',
          status: 'RUNNING',
        },
        {
          generationRunId: 702,
          slotNo: 2,
          attemptNo: 1,
          triggerType: 'INITIAL',
          status: 'RUNNING',
        },
      ],
    });
    expect(thumbnailPhase(demo.world.s.thumbnail)).toBe('GENERATING');
    expect(demo.world.progress().busy).toBe(true);
    // 생성 중: 같은 번호를 또 만들 수 없고, 레퍼런스도 바꿀 수 없다
    const busy = await generate(run, { slotNos: [1], faceOption: 'FULL_FACE' });
    expect(busy.error).toMatchObject({
      code: 'ALREADY_IN_PROGRESS',
      message: '썸네일 생성이 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
      details: { job: 'GENERATION', slotNos: [1] },
    });
    const refs = await putRefs(run, {
      references: [{ imageAssetId: 2, sortOrder: 1 }],
      noPersonConfirmed: true,
    });
    expect(refs.error).toMatchObject({
      code: 'ALREADY_IN_PROGRESS',
      details: { job: 'GENERATION' },
    });
    const running = (await output()).data!;
    expect(running.stepRunStatus).toBe('WAITING_INPUT');
    expect(running.generationRuns.map((g) => [g.slotNo, g.status, g.resultImageAssetId])).toEqual([
      [1, 'RUNNING', null],
      [2, 'RUNNING', null],
    ]);

    demo.world.flush();
    expect(thumbnailPhase(demo.world.s.thumbnail)).toBe('GENERATED');
    expect(demo.world.progress().busy).toBe(false);
    expect(demo.world.progress().next?.id).toBe('domesticPrice');
    const done = (await output()).data!;
    expect(done.stepRunStatus).toBe('WAITING_INPUT');
    expect(
      done.generationRuns.map((g) => [
        g.slotNo,
        g.attemptNo,
        g.status,
        g.resultImageAssetId,
        g.adopted,
      ]),
    ).toEqual([
      [1, 1, 'SUCCEEDED', 901, false],
      [2, 1, 'SUCCEEDED', 902, false],
    ]);
    expect(done.generationRuns[0]).toMatchObject({
      generationRunId: 701,
      faceOption: 'FULL_FACE',
      promptAdjusted: false,
      requestedSizePx: 1024,
      provider: 'AGY',
      refusalReason: null,
      errorMessage: null,
    });
    expect(done.generationRuns[0]?.finishedAt).not.toBeNull();

    // 시도 한 건: 프롬프트 전문
    const detail = await api.GET('/generation-runs/{generationRunId}', {
      params: { path: { generationRunId: 701 } },
    });
    expect(detail.data).toMatchObject({
      generationRunId: 701,
      stepRunId: run,
      candidateId: id,
      status: 'SUCCEEDED',
      adopted: false,
    });
    expect(detail.data?.prompt).toContain('Model framing: full face.');
    expect(detail.data?.referenceSetSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(demo.world.s.steps.THUMBNAIL.status).toBe('WAITING_INPUT');
  });

  it('한 번호만 다시 만들면 2회차(OWNER_RETRY)이고, 조정 문구가 시도 기록에 남는다', async () => {
    const run = await generated();
    const res = await generate(run, {
      slotNos: [1],
      faceOption: 'CHIN_CROP',
      promptAdjustment: 'warmer tone',
    });
    expect(res.data?.generationRuns).toEqual([
      {
        generationRunId: 703,
        slotNo: 1,
        attemptNo: 2,
        triggerType: 'OWNER_RETRY',
        status: 'RUNNING',
      },
    ]);
    demo.world.flush();
    const out = (await output()).data!;
    expect(
      out.generationRuns.map((g) => [g.slotNo, g.attemptNo, g.promptAdjusted, g.faceOption]),
    ).toEqual([
      [1, 1, false, 'FULL_FACE'],
      [1, 2, true, 'CHIN_CROP'],
      [2, 1, false, 'FULL_FACE'],
    ]);
    const detail = await api.GET('/generation-runs/{generationRunId}', {
      params: { path: { generationRunId: 703 } },
    });
    expect(detail.data?.prompt).toContain('crop at chin (face not shown)');
    expect(detail.data?.prompt.endsWith('\n\nwarmer tone')).toBe(true);
  });
});

describe('G3 썸네일 선택', () => {
  it('모양 오류 · 현재 버전이 아님 · 체크리스트 · 이미지 규칙의 오류 순서와 문구', async () => {
    const run = await generated();
    const ok = {
      basisStepRunId: run,
      representativeImageAssetId: 901,
      additionalImageAssetIds: [902],
      checklist: CHECKLIST,
    };
    const shape = await passG3({ basisStepRunId: 'x', additionalImageAssetIds: [901], extra: 1 });
    expect(shape.response.status).toBe(422);
    expect(shape.error?.code).toBe('VALIDATION_FAILED');
    expect(shape.error?.fieldErrors?.map((f) => f.field)).toEqual([
      'extra',
      'basisStepRunId',
      'representativeImageAssetId',
      'checklist',
    ]);
    const sameInBoth = await passG3({ ...ok, additionalImageAssetIds: [901] });
    expect(sameInBoth.error?.fieldErrors?.[0]).toMatchObject({
      field: 'additionalImageAssetIds',
      message: '대표이미지를 추가이미지에 다시 넣을 수 없습니다.',
    });
    expect((await passG3({ ...ok, basisStepRunId: run + 9 })).error).toMatchObject({
      code: 'VERSION_NOT_CURRENT',
      message: '화면을 연 뒤 값이 바뀌었습니다. 새로 고친 뒤 다시 해 주세요.',
      details: { stepCode: 'THUMBNAIL', currentStepRunId: run },
    });
    const incomplete = await passG3({
      ...ok,
      checklist: { ...CHECKLIST, noTextOrPrice: false, detailMatch: undefined },
    });
    expect(incomplete.response.status).toBe(422);
    expect(incomplete.error).toMatchObject({
      code: 'CHECKLIST_INCOMPLETE',
      message: '체크리스트를 모두 확인해 주세요.',
      details: { uncheckedKeys: ['detailMatch', 'noTextOrPrice'] },
    });
    const unknownKey = await passG3({ ...ok, checklist: { ...CHECKLIST, mystery: true } });
    expect(unknownKey.error?.fieldErrors?.[0]).toMatchObject({
      field: 'checklist.mystery',
      message: '받지 않는 항목입니다.',
    });
    const tooMany = await passG3({
      ...ok,
      additionalImageAssetIds: Array.from({ length: 10 }, (_, i) => 100 + i),
    });
    expect(tooMany.error).toMatchObject({
      code: 'IMAGE_COUNT_INVALID',
      details: { additionalCount: 10, max: 9 },
    });
    const missing = await passG3({ ...ok, additionalImageAssetIds: [8888] });
    expect(missing.response.status).toBe(404);
    expect(missing.error).toMatchObject({ code: 'IMAGE_ASSET_NOT_FOUND' });
    const original = await passG3({ ...ok, representativeImageAssetId: 1 });
    expect(original.error).toMatchObject({
      code: 'IMAGE_NOT_ALLOWED',
      message:
        '이 이미지는 여기에 쓸 수 없습니다(라쿠텐 원본·참조 전용 이미지는 대표·추가이미지로 고를 수 없습니다).',
      details: { imageAssetId: 1, reason: 'NOT_GENERATED' },
    });
    expect(demo.world.s.gates.G3).toBeNull();
    expect((await stepOf('THUMBNAIL')).status).toBe('WAITING_INPUT');
  });

  it('생성 중에는 409 ALREADY_IN_PROGRESS, 이 ⑤에서 만들지 않은 생성본은 422 OTHER_RUN', async () => {
    const run = await withReferences();
    const body = {
      basisStepRunId: run,
      representativeImageAssetId: 901,
      additionalImageAssetIds: [],
      checklist: CHECKLIST,
    };
    // 아직 만든 생성본이 없다
    expect((await passG3(body)).error).toMatchObject({
      code: 'IMAGE_NOT_ALLOWED',
      message: '이 이미지는 여기에 쓸 수 없습니다(이 ⑤ 버전에서 만든 AI 생성 후보가 아닙니다).',
      details: { reason: 'OTHER_RUN' },
    });
    await generate(run, { slotNos: [1, 2], faceOption: 'FULL_FACE' });
    demo.world.flush();
    await generate(run, { slotNos: [2], faceOption: 'FULL_FACE' });
    expect((await passG3(body)).error).toMatchObject({
      code: 'ALREADY_IN_PROGRESS',
      message: '썸네일 생성이 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
      details: { job: 'GENERATION', runningCount: 1 },
    });
    demo.world.flush();
    expect((await passG3(body)).response.status).toBe(201);
  });

  it('통과 201: ⑤가 같은 실행으로 완료되고 선택본·G3이 기록된다 → 같은 선택이면 200', async () => {
    const run = await generated();
    expect(demo.world.progress().next?.id).toBe('domesticPrice');
    const body = {
      basisStepRunId: run,
      representativeImageAssetId: 901,
      additionalImageAssetIds: [902],
      checklist: CHECKLIST,
    };
    const res = await passG3(body);
    expect(res.response.status).toBe(201);
    expect(res.data).toMatchObject({
      gate: 'G3',
      basisStepRunId: run,
      candidateStatus: 'WORKING',
      statusChanged: false,
      thumbnailSelectionId: 1,
      thumbnailStepRunId: run,
      warnings: [],
    });
    expect(res.data?.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const item = await stepOf('THUMBNAIL');
    expect(item).toMatchObject({ status: 'COMPLETED', currentStepRunId: run });
    expect(item.currentRun).toMatchObject({ version: 1, status: 'COMPLETED' });
    const out = (await output()).data!;
    expect(out).toMatchObject({
      stepRunId: run,
      stepRunStatus: 'COMPLETED',
      isCurrent: true,
      g3: {
        gatePassId: res.data!.gatePassId,
        basisStepRunId: run,
        valid: true,
        changedBasisKeys: [],
      },
    });
    expect(out.selection).toMatchObject({
      thumbnailSelectionId: 1,
      checklist: { version: 'M1-2', ...CHECKLIST },
      sameProductColorConfirmedAt: null,
    });
    expect(
      out.selection?.images.map((i) => [i.imageAssetId, i.role, i.sortOrder, i.generationRunId]),
    ).toEqual([
      [901, 'REPRESENTATIVE', 0, 701],
      [902, 'ADDITIONAL', 1, 702],
    ]);
    expect(out.generationRuns.map((g) => g.adopted)).toEqual([true, true]);
    expect(await g3State()).toMatchObject({
      passed: true,
      fingerprintValid: true,
      gatePassId: res.data!.gatePassId,
      basisStepRunId: run,
    });
    expect(demo.world.progress().next?.id).toBe('domesticPrice');
    const detail = await api.GET('/generation-runs/{generationRunId}', {
      params: { path: { generationRunId: 701 } },
    });
    expect(detail.data?.adopted).toBe(true);

    // 같은 선택으로 다시 누르면 200(기존 기록)
    const again = await passG3(body);
    expect(again.response.status).toBe(200);
    expect(again.data).toMatchObject({
      gatePassId: res.data!.gatePassId,
      thumbnailSelectionId: null,
      thumbnailStepRunId: null,
    });
    // 끝난 ⑤에는 레퍼런스도 생성도 보낼 수 없다
    const notWaiting = {
      code: 'STEP_RUN_NOT_WAITING_INPUT',
      message: '이 실행은 입력을 기다리고 있지 않습니다. 바꾸려면 다시 실행하거나 수정해 주세요.',
    };
    expect(
      (
        await putRefs(run, {
          references: [{ imageAssetId: 1, sortOrder: 1 }],
          noPersonConfirmed: true,
        })
      ).error,
    ).toMatchObject(notWaiting);
    expect((await generate(run, { slotNos: [1], faceOption: 'FULL_FACE' })).error).toMatchObject(
      notWaiting,
    );
  });

  it('완료 뒤 다른 선택으로 다시 고르면 오너 수정 새 버전(v2)이 열리고 선택본이 바뀐다', async () => {
    const run = await generated();
    const first = await passG3({
      basisStepRunId: run,
      representativeImageAssetId: 901,
      additionalImageAssetIds: [902],
      checklist: CHECKLIST,
    });
    const second = await passG3({
      basisStepRunId: run,
      representativeImageAssetId: 902,
      additionalImageAssetIds: [901],
      checklist: CHECKLIST,
    });
    expect(second.response.status).toBe(201);
    expect(second.data!.gatePassId).toBeGreaterThan(first.data!.gatePassId);
    expect(second.data!.thumbnailStepRunId).not.toBe(run);
    const item = await stepOf('THUMBNAIL');
    expect(item).toMatchObject({
      status: 'COMPLETED',
      currentStepRunId: second.data!.thumbnailStepRunId,
    });
    expect(item.currentRun).toMatchObject({ version: 2, executionMode: 'OWNER_EDIT' });
    const out = (await output()).data!;
    expect(out).toMatchObject({ version: 2, stepRunStatus: 'COMPLETED' });
    expect(out.selection?.images.map((i) => [i.imageAssetId, i.role])).toEqual([
      [902, 'REPRESENTATIVE'],
      [901, 'ADDITIONAL'],
    ]);
    expect(out.references).toHaveLength(1);
    expect(out.g3).toMatchObject({ gatePassId: second.data!.gatePassId, valid: true });
  });
});

describe('⑤ 다시 실행 · 처음부터 다시', () => {
  it('완료된 ⑤를 다시 실행하면 레퍼런스·생성본·선택본이 비고 G3이 무효가 되며 원본은 그대로다', async () => {
    const run = await generated();
    const g3 = await passG3({
      basisStepRunId: run,
      representativeImageAssetId: 901,
      additionalImageAssetIds: [],
      checklist: CHECKLIST,
    });
    const rerun = await runThumbnail();
    expect(rerun.data).toMatchObject({ version: 2, status: 'RUNNING' });
    const newRun = rerun.data!.stepRunId;
    // 새 실행: 산출물은 비어 있고 G3은 기록은 있지만 유효하지 않다
    expect((await output()).data).toMatchObject({
      stepRunId: newRun,
      stepRunStatus: 'RUNNING',
      references: [],
      generationRuns: [],
      selection: null,
      g3: { gatePassId: g3.data!.gatePassId, valid: false },
    });
    expect(await g3State()).toMatchObject({ passed: false, gatePassId: g3.data!.gatePassId });
    expect((await sources()).data?.items).toHaveLength(3);
    demo.world.flush();
    expect((await stepOf('THUMBNAIL')).status).toBe('WAITING_INPUT');
    expect(thumbnailPhase(demo.world.s.thumbnail)).toBe('NONE');
    // 지난 실행 id로는 레퍼런스를 보낼 수 없다
    expect(
      (
        await putRefs(run, {
          references: [{ imageAssetId: 1, sortOrder: 1 }],
          noPersonConfirmed: true,
        })
      ).error,
    ).toMatchObject({ code: 'STEP_RUN_NOT_WAITING_INPUT' });
    expect(
      (
        await putRefs(newRun, {
          references: [{ imageAssetId: 1, sortOrder: 1 }],
          noPersonConfirmed: true,
        })
      ).response.status,
    ).toBe(200);
    // 생성본은 새 버전에서 새로 만든다 — 지난 생성본 id로 G3을 통과할 수 없다
    const old = await passG3({
      basisStepRunId: newRun,
      representativeImageAssetId: 901,
      additionalImageAssetIds: [],
      checklist: CHECKLIST,
    });
    expect(old.error).toMatchObject({ code: 'IMAGE_NOT_ALLOWED' });
  });

  it('생성이 한창일 때 다시 실행·처음부터 다시를 해도 늦게 온 결과가 상태를 건드리지 않는다', async () => {
    const run = await withReferences();
    await generate(run, { slotNos: [1, 2], faceOption: 'FULL_FACE' });
    // ⑤ 입력 대기에서는 다시 실행할 수 없다(입력 대기 문구) → 처음부터 다시로 맡긴 일을 취소
    expect((await runThumbnail()).error).toMatchObject({ code: 'STEP_ALREADY_RUNNING' });
    demo.world.reset();
    expect(demo.world.pendingTasks).toBe(0);
    expect(demo.world.s.thumbnail.generations).toEqual([]);
    expect(thumbnailPhase(demo.world.s.thumbnail)).toBe('NONE');
    demo.world.flush();
    expect(demo.world.s.thumbnail.generations).toEqual([]);
  });

  it('③④까지 거친 뒤 ⑤ 입력 대기: 띠의 다음 일은 레퍼런스이고 여정 상태는 작업중이다', async () => {
    await reachCategoryDone(demo);
    await runThumbnail();
    demo.world.flush();
    expect((await api.GET('/candidates/{candidateId}', path)).data?.status).toBe('WORKING');
    expect(demo.world.progress().next?.id).toBe('references');
    // G2를 이미 통과했으니 ⑤ 레일에 비용 경고가 없다
    expect((await stepOf('THUMBNAIL')).warnings).toEqual([]);
  });
});
