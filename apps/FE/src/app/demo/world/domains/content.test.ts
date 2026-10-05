import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, installApiRuntime } from '@/shared/api/client';
import { createDemoApi, type DemoApi } from '../../demoApi';
import { reachThumbnailDone, startDemoKit } from '../testkit';

/**
 * ⑥ 상세 콘텐츠(D-32) — 화면이 보내는 요청 그대로: 단계 [실행]·⑥ 묶음(`throughStepCode`)·[여기부터 연속 실행]. 지연은 0이고
 * `world.flush()`가 맡겨 둔 결과를 지금 낸다.
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

const candidateId = 1;
const path = { params: { path: { candidateId } } };

const rail = async () => {
  const res = await api.GET('/candidates/{candidateId}/steps', path);
  return Object.fromEntries(res.data!.items.map((item) => [item.stepCode, item]));
};

const runStep = (stepCode: 'COPY' | 'NOTICE_RAW' | 'NOTICE_HTML', body: object = {}) =>
  api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
    params: { path: { candidateId, stepCode } },
    body,
  });

const copy = (query: { stepRunId?: number } = {}) =>
  api.GET('/candidates/{candidateId}/content-copy', {
    params: { path: { candidateId }, query },
  });
const fact = () => api.GET('/candidates/{candidateId}/content-fact', path);
const assembly = () => api.GET('/candidates/{candidateId}/content-assembly', path);

describe('⑥ — 실행 전', () => {
  it('산출물 조회는 실제 BE처럼 404 STEP_OUTPUT_NOT_FOUND(단계 이름 문구)', async () => {
    await reachThumbnailDone(demo);
    const copyRes = await copy();
    expect(copyRes.response.status).toBe(404);
    expect(copyRes.error).toMatchObject({
      code: 'STEP_OUTPUT_NOT_FOUND',
      message: '아직 ⑥-1 카피를 실행하지 않았습니다.',
      status: 404,
      details: { stepCode: 'COPY' },
    });
    expect((await fact()).error).toMatchObject({
      code: 'STEP_OUTPUT_NOT_FOUND',
      message: '아직 ⑥-2 원산지·소재를 실행하지 않았습니다.',
      details: { stepCode: 'NOTICE_RAW' },
    });
    expect((await assembly()).error).toMatchObject({
      code: 'STEP_OUTPUT_NOT_FOUND',
      message: '아직 ⑥-3 고시·HTML를 실행하지 않았습니다.',
      details: { stepCode: 'NOTICE_HTML' },
    });
  });

  it('⑥-3은 ⑥-1·⑥-2 전에 막힌다(409 STEP_START_CONDITION_UNMET, 빠진 입력 이름)', async () => {
    await reachThumbnailDone(demo);
    const res = await runStep('NOTICE_HTML');
    expect(res.response.status).toBe(409);
    expect(res.error).toMatchObject({
      code: 'STEP_START_CONDITION_UNMET',
      message: '시작에 필요한 값이 없습니다: ⑥-1 카피, ⑥-2 원산지·소재.',
    });
    const items = await rail();
    expect(items.NOTICE_HTML!.actions.run).toMatchObject({
      enabled: false,
      disabledReason: { code: 'STEP_START_CONDITION_UNMET' },
    });
    expect(items.COPY!.actions.run.enabled).toBe(true);
  });
});

describe('⑥-1 카피', () => {
  it('실행 중에는 산출물이 없고(404), 끝나면 레일 현재 실행과 같은 stepRunId로 읽힌다', async () => {
    await reachThumbnailDone(demo);
    const started = await runStep('COPY');
    expect(started.response.status).toBe(202);
    expect(started.data).toMatchObject({
      stepCode: 'COPY',
      version: 1,
      status: 'RUNNING',
      aiEngine: 'CLAUDE',
    });
    const running = (await rail()).COPY!;
    expect(running).toMatchObject({ status: 'RUNNING', currentStepRunId: started.data!.stepRunId });
    expect((await copy()).error).toMatchObject({ code: 'STEP_OUTPUT_NOT_FOUND' });

    demo.world.flush();
    const done = (await rail()).COPY!;
    expect(done.status).toBe('COMPLETED');
    const output = (await copy()).data!;
    expect(output).toMatchObject({
      stepRunId: done.currentStepRunId,
      version: 1,
      stepRunStatus: 'COMPLETED',
      isCurrent: true,
      keepAsIsAllowed: false,
      fields: [],
    });
    expect(output.copy).toEqual(output.generatedCopy);
    expect((output.copy as { selling_points: string[] }).selling_points).toHaveLength(3);
    // 이어서 시작하지 않는다 — 다른 단계는 그대로
    expect((await rail()).NOTICE_RAW!.status).toBe('NOT_RUN');
  });

  it('다시 실행하면 새 버전이 생기고, 옛 버전은 ?stepRunId=로 읽힌다(isCurrent false)', async () => {
    await reachThumbnailDone(demo);
    const first = await runStep('COPY');
    demo.world.flush();
    const second = await runStep('COPY');
    expect(second.data!.version).toBe(2);
    // 새 실행이 RUNNING인 동안은 현재 버전 포인터가 새 실행이라 산출물이 없다
    expect((await copy()).error).toMatchObject({ code: 'STEP_OUTPUT_NOT_FOUND' });
    const old = await copy({ stepRunId: first.data!.stepRunId });
    expect(old.data).toMatchObject({ version: 1, isCurrent: false });
    demo.world.flush();
    expect((await copy()).data).toMatchObject({
      stepRunId: second.data!.stepRunId,
      version: 2,
      isCurrent: true,
    });
  });

  it('조회 쿼리 오류: 모르는 조건·잘못된 번호 422, 이 단계 실행이 아니면 404 STEP_RUN_NOT_FOUND', async () => {
    await reachThumbnailDone(demo);
    await runStep('COPY');
    demo.world.flush();
    const zero = await copy({ stepRunId: 0 });
    expect(zero.response.status).toBe(422);
    expect(zero.error).toMatchObject({
      code: 'INVALID_QUERY_PARAMETER',
      message: '목록 조건이 올바르지 않습니다.',
      fieldErrors: [{ field: 'stepRunId', message: '1 이상의 정수여야 합니다.' }],
    });
    const unknown = await api.GET('/candidates/{candidateId}/content-copy', {
      params: { path: { candidateId }, query: { foo: '1' } as never },
    });
    expect(unknown.error).toMatchObject({
      code: 'INVALID_QUERY_PARAMETER',
      fieldErrors: [{ field: 'foo', message: '받지 않는 조건입니다.' }],
    });
    const other = await copy({ stepRunId: 99999 });
    expect(other.response.status).toBe(404);
    expect(other.error).toMatchObject({
      code: 'STEP_RUN_NOT_FOUND',
      message: '실행 기록을 찾을 수 없습니다.',
    });
  });
});

describe('⑥ 묶음 실행(throughStepCode) · ⑥-2 · ⑥-3', () => {
  it('COPY + throughStepCode=NOTICE_HTML: ⑥-1 → ⑥-2 → ⑥-3 순서로 각자 v1이 되고 입력 대기 없이 끝난다', async () => {
    await reachThumbnailDone(demo);
    const started = await runStep('COPY', { throughStepCode: 'NOTICE_HTML' });
    expect(started.response.status).toBe(202);
    // 첫 실행만 돌려준다
    expect(started.data!.stepRunIds).toEqual([started.data!.stepRunId]);

    demo.world.flush();
    const items = await rail();
    for (const code of ['COPY', 'NOTICE_RAW', 'NOTICE_HTML'] as const) {
      expect(items[code]).toMatchObject({ status: 'COMPLETED', lastVersion: 1 });
      expect(items[code]!.currentRun).toMatchObject({ version: 1, executionMode: 'STEP' });
    }
    expect(items.COPY!.currentRun!.aiEngine).toBe('CLAUDE');
    expect(items.NOTICE_RAW!.currentRun!.aiEngine).toBe('CLAUDE');
    expect(items.NOTICE_HTML!.currentRun!.aiEngine).toBeNull();
    // ⑦·⑧은 이 묶음이 시작하지 않는다
    expect(items.TAGS!.status).toBe('NOT_RUN');
    expect(items.UPLOAD!.status).toBe('NOT_RUN');

    const factOut = (await fact()).data!;
    expect(factOut).toMatchObject({
      stepRunId: items.NOTICE_RAW!.currentStepRunId,
      stepRunStatus: 'COMPLETED',
      pendingInputs: [],
      sourceItemCode: 'shop-a:10000123',
    });
    expect(factOut.fields.map((f) => f.fieldKey)).toEqual([
      'fact.origin',
      'fact.material_upper',
      'fact.material_lining',
      'fact.material_sole',
      'fact.heel_height',
      'fact.color_ko',
      'fact.caution',
    ]);
    expect(factOut.fields[0]).toMatchObject({
      value: ['베트남'],
      valueSource: 'GENERATED',
      extractionMethod: 'DESCRIPTION_PATTERN',
      recheckRequired: false,
    });
    expect(new Set(factOut.fields.map((f) => f.stepRunId))).toEqual(
      new Set([items.NOTICE_RAW!.currentStepRunId]),
    );

    const out = (await assembly()).data!;
    expect(out).toMatchObject({
      stepRunId: items.NOTICE_HTML!.currentStepRunId,
      stepRunStatus: 'COMPLETED',
      isCurrent: true,
      productName: '아식스 젤카야노14 1201A019-108 러닝화 크림 남성',
      originAreaCode: '0200036',
      parallelImport: false,
      disclosureTemplateMatched: true,
    });
    expect(out.noticeFields.material).toBe('겉감 합성섬유·합성가죽 / 안감 합성섬유 / 밑창 고무');
    expect(out.specBlockHtml).toContain('안감 합성섬유');
    expect(out.previewUrl.startsWith('data:text/html')).toBe(true);
    // 샘플 가게 값은 응답을 보낼 때 채워진다
    expect(JSON.stringify(out)).not.toContain('[내 상호]');
    expect(demo.world.s.content.outputs.COPY).toHaveLength(1);
  });

  it('묶음은 단계 사이 지연마다 하나씩 진행한다(⑥-1 완료 순간 ⑥-2는 RUNNING이라 산출물이 아직 없다)', async () => {
    vi.useFakeTimers();
    try {
      const slow = createDemoApi({ delays: { short: 100, medium: 100, long: 100 } });
      const offSlow = installApiRuntime(slow);
      await reachThumbnailDone(slow);
      await runStep('COPY', { throughStepCode: 'NOTICE_HTML' });
      await vi.advanceTimersByTimeAsync(100);
      const items = await rail();
      expect(items.COPY!.status).toBe('COMPLETED');
      expect(items.NOTICE_RAW!.status).toBe('RUNNING');
      expect(items.NOTICE_HTML!.status).toBe('NOT_RUN');
      expect((await copy()).data).toMatchObject({ stepRunStatus: 'COMPLETED' });
      expect((await fact()).error).toMatchObject({ code: 'STEP_OUTPUT_NOT_FOUND' });
      await vi.advanceTimersByTimeAsync(100);
      expect((await rail()).NOTICE_HTML!.status).toBe('RUNNING');
      expect((await fact()).data).toMatchObject({ stepRunStatus: 'COMPLETED' });
      slow.world.flush();
      expect((await rail()).NOTICE_HTML!.status).toBe('COMPLETED');
      offSlow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('단계 하나만 실행하면 묶음이 이어지지 않는다(⑥-2 [실행] → ⑥-2만)', async () => {
    await reachThumbnailDone(demo);
    expect((await runStep('NOTICE_RAW')).response.status).toBe(202);
    demo.world.flush();
    const items = await rail();
    expect(items.NOTICE_RAW!.status).toBe('COMPLETED');
    expect(items.NOTICE_HTML!.status).toBe('NOT_RUN');
    expect((await fact()).data!.stepRunId).toBe(items.NOTICE_RAW!.currentStepRunId);
  });

  it('⑥-3 미리보기 주소(/content-assembly/preview)는 text/html 문서를 준다', async () => {
    await reachThumbnailDone(demo);
    await runStep('COPY', { throughStepCode: 'NOTICE_HTML' });
    demo.world.flush();
    const res = await demo.fetch(
      new Request('http://localhost/api/v1/candidates/1/content-assembly/preview'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('data-autostore-detail');
    expect(html).toContain('정복상회(예시)');
  });
});

describe('[여기부터 연속 실행] ⑥-1 → … → AWAIT_G4', () => {
  it('⑥-1부터 ⑧까지 돌고 최종 승인 앞(AWAIT_G4)에서 멈춘다 — 여정은 승인대기', async () => {
    await reachThumbnailDone(demo);
    const started = await api.POST('/candidates/{candidateId}/continuous-runs', {
      ...path,
      body: { kind: 'FROM_HERE', startStepCode: 'COPY' },
    });
    expect(started.response.status).toBe(202);
    expect(started.data).toMatchObject({
      kind: 'FROM_HERE',
      startStepCode: 'COPY',
      status: 'RUNNING',
      stepCode: 'COPY',
    });
    // 진행 중에는 모든 단계의 [연속 실행]이 꺼진다
    const items = await rail();
    expect(items.TAGS!.actions.continuousRun).toMatchObject({
      enabled: false,
      disabledReason: { code: 'CONTINUOUS_RUN_ALREADY_OPEN' },
    });
    const sameAgain = await api.POST('/candidates/{candidateId}/continuous-runs', {
      ...path,
      body: { kind: 'FROM_HERE', startStepCode: 'COPY' },
    });
    expect(sameAgain.error).toMatchObject({ code: 'CONTINUOUS_RUN_ALREADY_OPEN' });

    demo.world.flush();
    const done = await rail();
    for (const code of ['COPY', 'NOTICE_RAW', 'NOTICE_HTML', 'TAGS', 'UPLOAD'] as const) {
      expect(done[code]).toMatchObject({ status: 'COMPLETED' });
      expect(done[code]!.currentRun).toMatchObject({
        executionMode: 'CHAIN',
        stepChainId: started.data!.stepChainId,
      });
    }
    const chain = await api.GET('/continuous-runs/{stepChainId}', {
      params: { path: { stepChainId: started.data!.stepChainId } },
    });
    expect(chain.data).toMatchObject({
      stopReason: 'AWAIT_G4',
      stopStepCode: 'REGISTER',
      skippedStepCodes: [],
    });
    expect(chain.data!.endedAt).not.toBeNull();
    expect(chain.data!.stepRuns.map((run) => run.stepCode)).toEqual([
      'COPY',
      'NOTICE_RAW',
      'NOTICE_HTML',
      'TAGS',
      'UPLOAD',
    ]);
    const detail = await api.GET('/candidates/{candidateId}', path);
    expect(detail.data).toMatchObject({ status: 'AWAITING_APPROVAL', openContinuousRun: null });
    // 산출물은 모두 레일 현재 실행과 같은 stepRunId다
    expect((await copy()).data!.stepRunId).toBe(done.COPY!.currentStepRunId);
    expect((await fact()).data!.stepRunId).toBe(done.NOTICE_RAW!.currentStepRunId);
    expect((await assembly()).data!.stepRunId).toBe(done.NOTICE_HTML!.currentStepRunId);
  });

  it('오너 수정(owner-edits)·원산지 직접 넣기(PUT)는 체험에서 403 안내다', async () => {
    await reachThumbnailDone(demo);
    await runStep('COPY');
    demo.world.flush();
    const edit = await api.POST('/candidates/{candidateId}/steps/{stepCode}/owner-edits', {
      params: { path: { candidateId, stepCode: 'COPY' } },
      body: { ownerAction: 'KEEP_AS_IS', baseStepRunId: 1 },
    });
    expect(edit.response.status).toBe(403);
    expect(edit.error).toMatchObject({ code: 'DEMO_READ_ONLY' });
    const put = await api.PUT('/step-runs/{stepRunId}/content-fields/{fieldKey}', {
      params: { path: { stepRunId: 1, fieldKey: 'fact.origin' } },
      body: { value: '베트남', evidenceUrl: 'item.rakuten.co.jp/x/' },
    });
    expect(put.response.status).toBe(403);
    expect(demo.readOnlyRequests).toEqual([
      'POST /candidates/1/steps/COPY/owner-edits',
      'PUT /step-runs/1/content-fields/fact.origin',
    ]);
  });
});
