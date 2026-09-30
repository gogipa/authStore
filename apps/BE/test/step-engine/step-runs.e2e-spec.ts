import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../../src/common/events/progress-events.service.js';
import { StepExecutor } from '../../src/modules/step-engine/execution/step-executor.js';
import type { StepCode } from '../../src/modules/step-engine/domain/steps.js';
import { createCandidate } from '../fixtures/step-engine/candidate.factory.js';
import { FakeStepRunnersModule } from '../fixtures/step-engine/fake-runners.module.js';
import { FakeStepWorld } from '../fixtures/step-engine/fake-runners.js';
import { truncateStepEngine } from '../fixtures/step-engine/truncate.js';
import { createTestApp, TEST_START_MS, type TestApp } from '../helpers/test-app.js';
import { seedUsableAiEngine } from '../support/fake-ai-engines.js';

interface ErrorBody {
  code: string;
  message: string;
  status: number;
  fieldErrors?: { field: string; message: string }[];
  details?: Record<string, unknown>;
}

interface AcceptedBody {
  stepRunId: number;
  stepRunIds: number[];
  candidateId: number;
  stepCode: StepCode;
  version: number;
  executionMode: string;
  aiEngine: string | null;
  aiModel: string | null;
  aiCliVersion: string | null;
  status: string;
  warnings: { code: string; message: string }[];
}

interface RailItem {
  stepCode: StepCode;
  status: string;
  currentStepRunId: number | null;
  staleInputs: string[];
  actions: Record<
    'run' | 'continuousRun' | 'edit',
    { enabled: boolean; disabledReason: { code: string; message: string } | null }
  >;
  warnings: { code: string }[];
  currentRun: { id: number; version: number } | null;
  inputs: { inputKey: string; sourceType: string }[];
}

/** 05-2 StepRunAccepted required */
const ACCEPTED_KEYS = [
  'stepRunId',
  'stepRunIds',
  'candidateId',
  'stepCode',
  'version',
  'executionMode',
  'aiEngine',
  'aiModel',
  'aiCliVersion',
  'status',
  'warnings',
].sort();

/** 05-2 StepRunDetail = StepRunSummary required + isCurrent·inputs */
const STEP_RUN_DETAIL_KEYS = [
  'id',
  'candidateId',
  'stepCode',
  'version',
  'executionMode',
  'ownerAction',
  'baseStepRunId',
  'stepChainId',
  'settingsSnapshotId',
  'aiEngine',
  'aiModel',
  'aiCliVersion',
  'status',
  'failureKind',
  'errorCode',
  'errorMessage',
  'rerunReasonInputs',
  'waitingSince',
  'waitSecondsTotal',
  'startedAt',
  'endedAt',
  'isCurrent',
  'inputs',
].sort();

/** 05-2 CandidateStepRailItem required */
const RAIL_ITEM_KEYS = [
  'id',
  'stepCode',
  'status',
  'currentStepRunId',
  'lastVersion',
  'staleInputs',
  'staleSince',
  'updatedAt',
  'currentRun',
  'inputs',
  'actions',
  'warnings',
].sort();

describe('단계 실행 API(step-engine, P1-05) e2e — autostore_test·가짜 실행기', () => {
  let t: TestApp;
  let world: FakeStepWorld;
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;

  const http = () => request(t.app.getHttpServer());
  const post = (path: string, body?: object) => {
    const req = http().post(`/api/v1${path}`).set('X-AutoStore-Client', '1');
    return body ? req.send(body) : req;
  };
  const get = (path: string) => http().get(`/api/v1${path}`);
  const idle = () => t.app.get(StepExecutor).whenIdle();
  const errorOf = (res: { body: unknown }) => res.body as ErrorBody;
  const runStep = (candidateId: number, stepCode: string, body?: object) =>
    post(`/candidates/${candidateId}/steps/${stepCode}/runs`, body);
  const stepRow = (candidateId: number, stepCode: StepCode) =>
    t.prisma.candidateStep.findUniqueOrThrow({
      where: { candidateId_stepCode: { candidateId, stepCode } },
    });
  /** 차례로 실행해 끝까지 기다린다(각각 202) */
  const complete = async (candidateId: number, ...codes: StepCode[]) => {
    for (const code of codes) {
      const res = await runStep(candidateId, code);
      expect([code, res.status]).toEqual([code, 202]);
      await idle();
    }
  };
  const rail = async (candidateId: number): Promise<RailItem[]> => {
    const res = await get(`/candidates/${candidateId}/steps`);
    expect(res.status).toBe(200);
    return (res.body as { items: RailItem[] }).items;
  };
  const newCandidate = async (patch: Parameters<typeof createCandidate>[1] = {}) =>
    (await createCandidate(t.prisma, { gender: 'MALE', ...patch })).candidate;

  beforeAll(async () => {
    t = await createTestApp({ imports: [FakeStepRunnersModule] });
    // 가짜 AI 단계(⑤·⑥-1·⑥-2)는 선택 엔진이 쓸 수 있어야 시작한다(P1-10 규칙 11)
    await seedUsableAiEngine(t.prisma);
    world = t.app.get(FakeStepWorld);
    const sub = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
  });

  beforeEach(async () => {
    world.releaseAll();
    await idle();
    await truncateStepEngine(t.prisma);
    world.reset();
    t.clock.ms = TEST_START_MS;
    events.length = 0;
  });

  afterAll(async () => {
    world.releaseAll();
    await idle();
    unsubscribe();
    await t.app.close();
  });

  describe('POST …/steps/{stepCode}/runs — 단계 하나 실행·다시 실행', () => {
    it('SOURCING → 202 + Location, version 1·STEP·RUNNING·aiEngine null. 끝나면 COMPLETED·입력 출처, 다시 → version 2', async () => {
      const c = await newCandidate();
      const res = await runStep(c.id, 'SOURCING');
      expect(res.status).toBe(202);
      const body = res.body as AcceptedBody;
      expect(Object.keys(body).sort()).toEqual(ACCEPTED_KEYS);
      expect(res.headers.location).toBe(`/api/v1/step-runs/${body.stepRunId}`);
      expect(body).toMatchObject({
        candidateId: c.id,
        stepCode: 'SOURCING',
        version: 1,
        executionMode: 'STEP',
        status: 'RUNNING',
        aiEngine: null,
        aiModel: null,
        aiCliVersion: null,
        stepRunIds: [body.stepRunId],
        warnings: [],
      });
      await idle();

      const detail = await get(`/step-runs/${body.stepRunId}`);
      expect(detail.status).toBe(200);
      expect(Object.keys(detail.body as object).sort()).toEqual(STEP_RUN_DETAIL_KEYS);
      const d = detail.body as {
        status: string;
        isCurrent: boolean;
        endedAt: string | null;
        inputFingerprintEnd?: string;
        inputs: {
          inputKey: string;
          sourceType: string;
          isStartCondition: boolean;
          valueHash: string;
        }[];
      };
      expect(d).toMatchObject({ status: 'COMPLETED', isCurrent: true });
      expect(d.endedAt).not.toBeNull();
      expect(d.inputs.find((i) => i.inputKey === 'candidate.rakutenQuery')).toMatchObject({
        sourceType: 'OWNER_INPUT',
        isStartCondition: true,
      });
      expect(d.inputs.find((i) => i.inputKey === 'settings.sourcing.minSizeCount')).toMatchObject({
        sourceType: 'SETTINGS',
      });
      for (const input of d.inputs) expect(input.valueHash).toMatch(/^[0-9a-f]{64}$/);
      // 실행 중 오너 입력은 지문 밖(is_start_condition=false)
      expect(d.inputs.find((i) => i.inputKey === 'owner.searchKeyword')?.isStartCondition).toBe(
        false,
      );
      expect(await stepRow(c.id, 'SOURCING')).toMatchObject({
        status: 'COMPLETED',
        currentStepRunId: body.stepRunId,
        lastVersion: 1,
      });

      const again = await runStep(c.id, 'SOURCING');
      expect(again.status).toBe(202);
      expect((again.body as AcceptedBody).version).toBe(2);
      await idle();
      const v1 = await get(`/step-runs/${body.stepRunId}`);
      expect((v1.body as { isCurrent: boolean }).isCurrent).toBe(false);
    });

    it('다음 단계를 자동으로 시작하지 않는다(② 완료 뒤 ③은 미실행)', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING');
      expect((await stepRow(c.id, 'PRICING')).status).toBe('NOT_RUN');
      expect(world.callsOf('PRICING')).toHaveLength(0);
    });

    it('REGISTER·FOO → 422 INVALID_STEP_CODE', async () => {
      const c = await newCandidate();
      for (const code of ['REGISTER', 'FOO']) {
        const res = await runStep(c.id, code);
        expect(res.status).toBe(422);
        expect(errorOf(res).code).toBe('INVALID_STEP_CODE');
      }
    });

    it('② 전에 ③ → 409 STEP_START_CONDITION_UNMET + fieldErrors(빠진 입력 키)', async () => {
      const c = await newCandidate();
      const res = await runStep(c.id, 'PRICING');
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: 'STEP_START_CONDITION_UNMET',
        details: { stepCode: 'PRICING' },
      });
      expect(errorOf(res).fieldErrors?.map((f) => f.field)).toEqual(['sourcing.targetSkus']);
      expect(errorOf(res).message).toBe('시작에 필요한 값이 없습니다: ② 목표 사이즈 SKU가·재고.');
      // 성별이 없으면 candidate.gender
      const noGender = await newCandidate({ gender: null });
      await complete(noGender.id, 'SOURCING');
      const res2 = await runStep(noGender.id, 'PRICING');
      expect(errorOf(res2).fieldErrors?.map((f) => f.field)).toEqual(['candidate.gender']);
    });

    it('같은 단계를 동시에 두 번 → 하나는 409 STEP_ALREADY_RUNNING', async () => {
      const c = await newCandidate();
      world.script('SOURCING', { kind: 'HOLD' });
      const [a, b] = await Promise.all([runStep(c.id, 'SOURCING'), runStep(c.id, 'SOURCING')]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([202, 409]);
      const conflict = a.status === 409 ? a : b;
      expect(errorOf(conflict)).toMatchObject({
        code: 'STEP_ALREADY_RUNNING',
        details: { stepCode: 'SOURCING', status: 'RUNNING' },
      });
      world.release('SOURCING');
      await idle();
      expect(await t.prisma.stepRun.count({ where: { candidateId: c.id } })).toBe(1);
    });

    it('입력 대기 중인 단계에 새 실행 → 409 STEP_ALREADY_RUNNING(새 실행을 열지 않는다, Proposed)', async () => {
      const c = await newCandidate();
      world.script('SOURCING', { kind: 'WAIT', waitingReasonCode: 'ANCHOR_REQUIRED' });
      await complete(c.id, 'SOURCING');
      expect((await stepRow(c.id, 'SOURCING')).status).toBe('WAITING_INPUT');
      const res = await runStep(c.id, 'SOURCING');
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: 'STEP_ALREADY_RUNNING',
        details: { status: 'WAITING_INPUT' },
      });
      expect(errorOf(res).message).toContain('입력을 기다리고');
    });

    it('잠긴 후보 409 CANDIDATE_LOCKED, 제외 후보 409 CANDIDATE_EXCLUDED', async () => {
      const locked = await newCandidate({ status: 'REGISTERING' });
      const res = await runStep(locked.id, 'SOURCING');
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: 'CANDIDATE_LOCKED',
        details: { status: 'REGISTERING' },
      });
      const excluded = await newCandidate({ status: 'EXCLUDED' });
      const res2 = await runStep(excluded.id, 'SOURCING');
      expect(res2.status).toBe(409);
      expect(errorOf(res2).code).toBe('CANDIDATE_EXCLUDED');
      const missing = await runStep(999_999, 'SOURCING');
      expect(missing.status).toBe(404);
      expect(errorOf(missing).code).toBe('CANDIDATE_NOT_FOUND');
    });

    it('ownerInputs가 단계에 맞지 않거나 모르는 칸이면 422 VALIDATION_FAILED, throughStepCode는 COPY만', async () => {
      const c = await newCandidate();
      const wrong = await runStep(c.id, 'SOURCING', { ownerInputs: { couponYen: 100 } });
      expect(wrong.status).toBe(422);
      expect(errorOf(wrong)).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(errorOf(wrong).fieldErrors?.[0]?.field).toBe('ownerInputs.couponYen');
      const unknown = await runStep(c.id, 'SOURCING', { ownerInputs: { nope: 1 } });
      expect(unknown.status).toBe(422);
      const through = await runStep(c.id, 'SOURCING', { throughStepCode: 'NOTICE_HTML' });
      expect(through.status).toBe(422);
      expect(errorOf(through).fieldErrors?.[0]?.field).toBe('throughStepCode');
      const ok = await runStep(c.id, 'SOURCING', {
        ownerInputs: { searchKeyword: 'ASICS 1201A019' },
      });
      expect(ok.status).toBe(202);
      await idle();
      expect(world.callsOf('SOURCING')[0]?.ownerInputs).toEqual({
        searchKeyword: 'ASICS 1201A019',
      });
    });

    it('G2 전 THUMBNAIL → 202 + warnings[0].code=PRE_G2_AI_COST(막지 않는다)', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING');
      const res = await runStep(c.id, 'THUMBNAIL');
      expect(res.status).toBe(202);
      const body = res.body as AcceptedBody;
      expect(body.warnings[0]).toEqual({
        code: 'PRE_G2_AI_COST',
        message:
          '판정(G2) 전에 썸네일을 만들면 팔지 않을 상품에도 AI 사용량이 듭니다. 실행은 막지 않습니다.',
      });
      await idle();
      // ⑤는 ③ 없이 된다(흐름 순서와 관계없이)
      expect((await stepRow(c.id, 'THUMBNAIL')).status).toBe('COMPLETED');
    });

    it('COPY + throughStepCode=NOTICE_HTML → ⑥-1·⑥-2·⑥-3 차례로 완료(응답은 첫 실행만)', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING');
      const res = await runStep(c.id, 'COPY', { throughStepCode: 'NOTICE_HTML' });
      expect(res.status).toBe(202);
      const body = res.body as AcceptedBody;
      expect(body.stepCode).toBe('COPY');
      expect(body.stepRunIds).toEqual([body.stepRunId]);
      await idle();
      const order = world.calls
        .map((call) => call.stepCode)
        .filter((code) => code !== 'SOURCING' && code !== 'PRICING');
      expect(order).toEqual(['COPY', 'NOTICE_RAW', 'NOTICE_HTML']);
      for (const code of ['COPY', 'NOTICE_RAW', 'NOTICE_HTML'] as const) {
        expect((await stepRow(c.id, code)).status).toBe('COMPLETED');
      }
      const runs = await t.prisma.stepRun.findMany({
        where: { candidateId: c.id, stepCode: { in: ['COPY', 'NOTICE_RAW', 'NOTICE_HTML'] } },
      });
      expect(runs.map((r) => r.executionMode)).toEqual(['STEP', 'STEP', 'STEP']);
    });

    it('⑥ 묶음 중간 실패: ⑥-1 실패 → ⑥-2는 돌고 ⑥-3은 시작하지 않는다(Proposed)', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING');
      world.script('COPY', { kind: 'FAIL', failureKind: 'AI', errorCode: 'AI_TIMEOUT' });
      await runStep(c.id, 'COPY', { throughStepCode: 'NOTICE_HTML' });
      await idle();
      expect((await stepRow(c.id, 'COPY')).status).toBe('FAILED');
      expect((await stepRow(c.id, 'NOTICE_RAW')).status).toBe('COMPLETED');
      expect((await stepRow(c.id, 'NOTICE_HTML')).status).toBe('NOT_RUN');
    });
  });

  describe('GET …/steps — 단계 레일', () => {
    it('items 10개. 꺼진 run의 disabledReason.code는 같은 단계 실행 API의 409 코드와 같다', async () => {
      const c = await newCandidate();
      const items = await rail(c.id);
      expect(items).toHaveLength(10);
      expect(Object.keys(items[0]!).sort()).toEqual(RAIL_ITEM_KEYS);
      expect(items.map((i) => i.stepCode)).toEqual([
        'SOURCING',
        'PRICING',
        'CATEGORY',
        'THUMBNAIL',
        'COPY',
        'NOTICE_RAW',
        'NOTICE_HTML',
        'TAGS',
        'UPLOAD',
        'REGISTER',
      ]);
      expect(items[0]!.actions.run).toEqual({ enabled: true, disabledReason: null });
      for (const item of items.filter((i) => !i.actions.run.enabled)) {
        const res = await runStep(c.id, item.stepCode);
        expect([item.stepCode, res.status >= 400 ? errorOf(res).code : 'OK']).toEqual([
          item.stepCode,
          item.actions.run.disabledReason!.code,
        ]);
        expect(errorOf(res).message).toBe(item.actions.run.disabledReason!.message);
      }
      // ⑨는 G4에서만
      expect(items[9]!.actions.run.disabledReason?.code).toBe('INVALID_STEP_CODE');
      // G2 전 ⑤·⑥-1·⑥-2 경고
      expect(
        items
          .filter((i) => i.warnings.some((w) => w.code === 'PRE_G2_AI_COST'))
          .map((i) => i.stepCode),
      ).toEqual(['THUMBNAIL', 'COPY', 'NOTICE_RAW']);
    });

    it('실행 중 잠금: ② RUNNING이면 ③ run은 STEP_LOCKED_BY_RUNNING_STEP, ② 자신은 STEP_ALREADY_RUNNING', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING');
      world.script('SOURCING', { kind: 'HOLD' });
      await runStep(c.id, 'SOURCING');
      const items = await rail(c.id);
      const byCode = Object.fromEntries(items.map((i) => [i.stepCode, i]));
      expect(byCode.SOURCING!.status).toBe('RUNNING');
      expect(byCode.SOURCING!.actions.run.disabledReason?.code).toBe('STEP_ALREADY_RUNNING');
      expect(byCode.PRICING!.actions.run.disabledReason?.code).toBe('STEP_LOCKED_BY_RUNNING_STEP');
      expect(byCode.PRICING!.actions.run.disabledReason?.message).toBe(
        '② 소싱이 실행 중이라 지금은 할 수 없습니다. 끝난 뒤 다시 해 주세요.',
      );
      const res = await runStep(c.id, 'PRICING');
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: 'STEP_LOCKED_BY_RUNNING_STEP',
        details: { stepCode: 'SOURCING' },
      });
      world.release('SOURCING');
      await idle();
    });

    it('현재 버전·입력 출처·재실행 사유를 준다', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING');
      const items = await rail(c.id);
      const pricing = items.find((i) => i.stepCode === 'PRICING')!;
      expect(pricing.status).toBe('COMPLETED');
      expect(pricing.currentRun?.version).toBe(1);
      expect(pricing.inputs.find((i) => i.inputKey === 'sourcing.targetSkus')?.sourceType).toBe(
        'PREV_STEP',
      );
    });

    it('없는 후보 404 CANDIDATE_NOT_FOUND', async () => {
      const res = await get('/candidates/999999/steps');
      expect(res.status).toBe(404);
      expect(errorOf(res).code).toBe('CANDIDATE_NOT_FOUND');
    });
  });

  describe('GET …/runs · GET /step-runs/{id} · GET …/stale-diff', () => {
    it('버전 이력: sort=version,desc 페이지와 isCurrent', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'SOURCING', 'SOURCING');
      const res = await get(`/candidates/${c.id}/steps/SOURCING/runs?sort=version,desc&size=2`);
      expect(res.status).toBe(200);
      const body = res.body as {
        content: { version: number; isCurrent: boolean }[];
        page: { number: number; size: number; totalElements: number; totalPages: number };
      };
      expect(body.content.map((r) => [r.version, r.isCurrent])).toEqual([
        [3, true],
        [2, false],
      ]);
      expect(body.page).toEqual({ number: 0, size: 2, totalElements: 3, totalPages: 2 });
      const asc = await get(`/candidates/${c.id}/steps/SOURCING/runs?sort=version,asc`);
      expect(
        (asc.body as { content: { version: number }[] }).content.map((r) => r.version),
      ).toEqual([1, 2, 3]);
      const badSort = await get(`/candidates/${c.id}/steps/SOURCING/runs?sort=startedAt,desc`);
      expect(badSort.status).toBe(422);
      expect(errorOf(badSort).code).toBe('INVALID_QUERY_PARAMETER');
    });

    it('없는 실행 404 STEP_RUN_NOT_FOUND', async () => {
      for (const id of ['999999', 'abc', '0']) {
        const res = await get(`/step-runs/${id}`);
        expect(res.status).toBe(404);
        expect(errorOf(res).code).toBe('STEP_RUN_NOT_FOUND');
      }
    });

    it('stale-diff: 재실행 필요 아님 409 STEP_NOT_RERUN_REQUIRED, COPY 재실행 필요 → keepAsIsAllowed=true', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'COPY', 'NOTICE_RAW');
      const notStale = await get(`/candidates/${c.id}/steps/COPY/stale-diff`);
      expect(notStale.status).toBe(409);
      expect(errorOf(notStale).code).toBe('STEP_NOT_RERUN_REQUIRED');

      world.set(c.id, 'sourcing.itemText', 'アシックス ゲルカヤノ14 新しい説明');
      await complete(c.id, 'SOURCING');
      expect(await stepRow(c.id, 'COPY')).toMatchObject({
        status: 'RERUN_REQUIRED',
        staleInputs: ['sourcing.itemText'],
      });
      const res = await get(`/candidates/${c.id}/steps/COPY/stale-diff`);
      expect(res.status).toBe(200);
      const body = res.body as {
        keepAsIsAllowed: boolean;
        staleInputs: string[];
        inputs: {
          inputKey: string;
          changed: boolean;
          usedSourceStepRunId: number | null;
          currentSourceStepRunId: number | null;
        }[];
      };
      expect(body.keepAsIsAllowed).toBe(true);
      expect(body.staleInputs).toEqual(['sourcing.itemText']);
      const itemText = body.inputs.find((i) => i.inputKey === 'sourcing.itemText')!;
      expect(itemText.changed).toBe(true);
      expect(itemText.usedSourceStepRunId).not.toBe(itemText.currentSourceStepRunId);
      expect(body.inputs.find((i) => i.inputKey === 'sourcing.skuAttributes')?.changed).toBe(false);
      // ⑥-2도 같은 입력을 읽지 않아(②의 속성·선택만) 그대로다
      expect((await stepRow(c.id, 'NOTICE_RAW')).status).toBe('COMPLETED');
      const notice = await get(`/candidates/${c.id}/steps/NOTICE_RAW/stale-diff`);
      expect(notice.status).toBe(409);
    });
  });

  describe('POST …/owner-edits — 오너 수정 새 버전', () => {
    it('옛 baseStepRunId → 409 VERSION_NOT_CURRENT', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'COPY', 'COPY');
      const runs = await t.prisma.stepRun.findMany({
        where: { candidateId: c.id, stepCode: 'COPY' },
        orderBy: { version: 'asc' },
      });
      const res = await post(`/candidates/${c.id}/steps/COPY/owner-edits`, {
        ownerAction: 'EDIT',
        baseStepRunId: runs[0]!.id,
        fields: [{ fieldKey: 'copy.headline', value: '가볍고 편한 러닝화' }],
      });
      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('VERSION_NOT_CURRENT');
    });

    it('NOTICE_RAW KEEP_AS_IS → 422 KEEP_AS_IS_NOT_ALLOWED', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'NOTICE_RAW');
      const current = (await stepRow(c.id, 'NOTICE_RAW')).currentStepRunId!;
      const res = await post(`/candidates/${c.id}/steps/NOTICE_RAW/owner-edits`, {
        ownerAction: 'KEEP_AS_IS',
        baseStepRunId: current,
      });
      expect(res.status).toBe(422);
      expect(errorOf(res).code).toBe('KEEP_AS_IS_NOT_ALLOWED');
    });

    it('KEEP_AS_IS(COPY): 재실행 필요가 아니면 409 STEP_NOT_RERUN_REQUIRED, 재실행 필요면 201 새 지문 + OWNER_CONFIRMED 기록', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'COPY');
      const v1 = (await stepRow(c.id, 'COPY')).currentStepRunId!;
      const notStale = await post(`/candidates/${c.id}/steps/COPY/owner-edits`, {
        ownerAction: 'KEEP_AS_IS',
        baseStepRunId: v1,
      });
      expect(notStale.status).toBe(409);
      expect(errorOf(notStale).code).toBe('STEP_NOT_RERUN_REQUIRED');

      world.set(c.id, 'sourcing.skuAttributes', { sizes: [260, 265] });
      await complete(c.id, 'SOURCING');
      expect((await stepRow(c.id, 'COPY')).status).toBe('RERUN_REQUIRED');
      const res = await post(`/candidates/${c.id}/steps/COPY/owner-edits`, {
        ownerAction: 'KEEP_AS_IS',
        baseStepRunId: v1,
      });
      expect(res.status).toBe(201);
      const body = res.body as {
        stepRunId: number;
        version: number;
        status: string;
        ownerAction: string;
      };
      expect(res.headers.location).toBe(`/api/v1/step-runs/${body.stepRunId}`);
      expect(body).toMatchObject({ version: 2, status: 'COMPLETED', ownerAction: 'KEEP_AS_IS' });
      expect(await stepRow(c.id, 'COPY')).toMatchObject({
        status: 'COMPLETED',
        currentStepRunId: body.stepRunId,
        staleInputs: [],
        staleSince: null,
      });
      const [old, kept] = await Promise.all([
        t.prisma.stepRun.findUniqueOrThrow({ where: { id: v1 } }),
        t.prisma.stepRun.findUniqueOrThrow({ where: { id: body.stepRunId } }),
      ]);
      expect(kept.inputFingerprintStart).not.toBe(old.inputFingerprintStart);
      expect(kept).toMatchObject({ executionMode: 'OWNER_EDIT', baseStepRunId: v1 });
      const log = await t.prisma.userActionLog.findFirstOrThrow({
        where: { candidateId: c.id, eventType: 'OWNER_CONFIRMED' },
      });
      expect(log).toMatchObject({ stepRunId: body.stepRunId, stepCode: 'COPY' });
      expect((log.detail as { staleInputs: string[] }).staleInputs).toEqual([
        'sourcing.skuAttributes',
      ]);
    });

    it('현재 버전 RESTORE_VERSION → 409 STEP_RUN_ALREADY_CURRENT, v1 다시 고르기 → 201 v3 + propagatedSteps', async () => {
      const c = await newCandidate();
      world.set(c.id, 'sourcing.itemText', '설명 A');
      await complete(c.id, 'SOURCING', 'COPY');
      const v1 = (await stepRow(c.id, 'SOURCING')).currentStepRunId!;
      world.set(c.id, 'sourcing.itemText', '설명 B');
      await complete(c.id, 'SOURCING');
      const v2 = (await stepRow(c.id, 'SOURCING')).currentStepRunId!;
      // ②가 바뀌어 ⑥-1이 재실행 필요 → 다시 실행해 v2 기준으로 맞춘다
      await complete(c.id, 'COPY');
      expect((await stepRow(c.id, 'COPY')).status).toBe('COMPLETED');

      const already = await post(`/candidates/${c.id}/steps/SOURCING/owner-edits`, {
        ownerAction: 'RESTORE_VERSION',
        baseStepRunId: v2,
      });
      expect(already.status).toBe(409);
      expect(errorOf(already).code).toBe('STEP_RUN_ALREADY_CURRENT');

      const res = await post(`/candidates/${c.id}/steps/SOURCING/owner-edits`, {
        ownerAction: 'RESTORE_VERSION',
        baseStepRunId: v1,
      });
      expect(res.status).toBe(201);
      const body = res.body as {
        version: number;
        status: string;
        baseStepRunId: number;
        executionMode: string;
        propagatedSteps: string[];
        staleDownstreamSteps: string[];
        warnings: unknown[];
      };
      expect(body).toMatchObject({
        version: 3,
        status: 'COMPLETED',
        baseStepRunId: v1,
        executionMode: 'OWNER_EDIT',
        propagatedSteps: ['COPY'],
        staleDownstreamSteps: ['COPY'],
        warnings: [],
      });
      expect(await stepRow(c.id, 'COPY')).toMatchObject({
        status: 'RERUN_REQUIRED',
        staleInputs: ['sourcing.itemText'],
      });
      // 이전 버전은 지우지 않는다
      expect(
        await t.prisma.stepRun.count({ where: { candidateId: c.id, stepCode: 'SOURCING' } }),
      ).toBe(3);
    });

    it('완료가 아닌 버전 다시 고르기 409 STEP_NOT_COMPLETED, 다른 앵커의 ② 버전 409 ANCHOR_KEY_MISMATCH', async () => {
      const c = await newCandidate({ anchor: { modelCode: '1201A019108', colorCode: '108' } });
      world.script('SOURCING', { kind: 'FAIL' });
      await complete(c.id, 'SOURCING');
      const failed = (await stepRow(c.id, 'SOURCING')).currentStepRunId!;
      world.set(c.id, 'fake.anchor', { anchorModelCode: 'OTHER-MODEL', anchorColorCode: '001' });
      await complete(c.id, 'SOURCING');
      const otherAnchor = (await stepRow(c.id, 'SOURCING')).currentStepRunId!;
      world.set(c.id, 'fake.anchor', { anchorModelCode: '1201A019108', anchorColorCode: '108' });
      await complete(c.id, 'SOURCING');

      const notCompleted = await post(`/candidates/${c.id}/steps/SOURCING/owner-edits`, {
        ownerAction: 'RESTORE_VERSION',
        baseStepRunId: failed,
      });
      expect(notCompleted.status).toBe(409);
      expect(errorOf(notCompleted)).toMatchObject({
        code: 'STEP_NOT_COMPLETED',
        details: { stepCode: 'SOURCING', status: 'FAILED' },
      });
      const mismatch = await post(`/candidates/${c.id}/steps/SOURCING/owner-edits`, {
        ownerAction: 'RESTORE_VERSION',
        baseStepRunId: otherAnchor,
      });
      expect(mismatch.status).toBe(409);
      expect(errorOf(mismatch).code).toBe('ANCHOR_KEY_MISMATCH');
    });

    it('EDIT: 편집 단계가 아니면 422 INVALID_STEP_CODE, 빈 fields 422 VALIDATION_FAILED, 현재 버전이면 201 새 버전', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING', 'COPY');
      const pricing = (await stepRow(c.id, 'PRICING')).currentStepRunId!;
      const notEditable = await post(`/candidates/${c.id}/steps/PRICING/owner-edits`, {
        ownerAction: 'EDIT',
        baseStepRunId: pricing,
        fields: [{ fieldKey: 'copy.headline', value: 'x' }],
      });
      expect(notEditable.status).toBe(422);
      expect(errorOf(notEditable).code).toBe('INVALID_STEP_CODE');
      const copy = (await stepRow(c.id, 'COPY')).currentStepRunId!;
      const empty = await post(`/candidates/${c.id}/steps/COPY/owner-edits`, {
        ownerAction: 'EDIT',
        baseStepRunId: copy,
        fields: [],
      });
      expect(empty.status).toBe(422);
      expect(errorOf(empty).code).toBe('VALIDATION_FAILED');
      const register = await post(`/candidates/${c.id}/steps/REGISTER/owner-edits`, {
        ownerAction: 'RESTORE_VERSION',
        baseStepRunId: copy,
      });
      expect(register.status).toBe(422);
      expect(errorOf(register).code).toBe('INVALID_STEP_CODE');

      const res = await post(`/candidates/${c.id}/steps/COPY/owner-edits`, {
        ownerAction: 'EDIT',
        baseStepRunId: copy,
        fields: [{ fieldKey: 'copy.headline', value: '가볍고 편한 러닝화', choose: 'OWNER' }],
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ version: 2, status: 'COMPLETED', ownerAction: 'EDIT' });
      const edited = await t.prisma.userActionLog.findFirstOrThrow({
        where: { candidateId: c.id, eventType: 'OWNER_EDITED' },
      });
      expect((edited.detail as { fieldKeys: string[] }).fieldKeys).toEqual(['copy.headline']);
    });

    it('TAGS EDIT → 202 OWNER_EDIT 실행(재검증 뒤 SSE로 완료)', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'TAGS');
      const tags = (await stepRow(c.id, 'TAGS')).currentStepRunId!;
      const res = await post(`/candidates/${c.id}/steps/TAGS/owner-edits`, {
        ownerAction: 'EDIT',
        baseStepRunId: tags,
        add: ['러닝화'],
        remove: [],
      });
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({
        executionMode: 'OWNER_EDIT',
        status: 'RUNNING',
        version: 2,
      });
      await idle();
      const ctx = world.callsOf('TAGS').at(-1)!;
      expect(ctx.ownerEdit).toEqual({
        ownerAction: 'EDIT',
        baseStepRunId: tags,
        edit: { add: ['러닝화'], remove: [] },
      });
      expect((await stepRow(c.id, 'TAGS')).status).toBe('COMPLETED');
    });
  });

  describe('DB 규칙·SSE', () => {
    it('닫힌 step_run UPDATE·DELETE → 트리거 오류(추가만)', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING');
      const id = (await stepRow(c.id, 'SOURCING')).currentStepRunId!;
      await expect(
        t.prisma.stepRun.update({ where: { id }, data: { errorMessage: 'x' } }),
      ).rejects.toThrow(/closed run cannot change/);
      await expect(t.prisma.stepRun.delete({ where: { id } })).rejects.toThrow(/append-only/);
      await expect(
        t.prisma.stepRunInput.updateMany({
          where: { stepRunId: id },
          data: { valueHash: 'b'.repeat(64) },
        }),
      ).rejects.toThrow(/cannot change/);
    });

    it('SSE: step-run.status-changed(RUNNING → COMPLETED)와 candidate-step.changed', async () => {
      const c = await newCandidate();
      const res = await runStep(c.id, 'SOURCING');
      const id = (res.body as AcceptedBody).stepRunId;
      await idle();
      const runEvents = events.filter(
        (e) =>
          e.name === 'step-run.status-changed' &&
          (e.data as { stepRunId: number }).stepRunId === id,
      );
      expect(runEvents.map((e) => (e.data as { status: string }).status)).toEqual([
        'RUNNING',
        'COMPLETED',
      ]);
      expect(runEvents[0]!.data).toMatchObject({
        candidateId: c.id,
        stepCode: 'SOURCING',
        version: 1,
        executionMode: 'STEP',
        stepChainId: null,
      });
      const stepEvents = events.filter((e) => e.name === 'candidate-step.changed');
      expect(stepEvents.map((e) => (e.data as { status: string }).status)).toEqual([
        'RUNNING',
        'COMPLETED',
      ]);
      expect(stepEvents[1]!.data).toMatchObject({
        candidateId: c.id,
        stepCode: 'SOURCING',
        currentStepRunId: id,
        staleInputs: [],
        staleSince: null,
      });
    });

    it('실행 중 실패는 HTTP 오류가 아니라 실행 기록(FAILED·failureKind·errorCode·한국어 문구)과 SSE', async () => {
      const c = await newCandidate();
      world.script('SOURCING', {
        kind: 'FAIL',
        failureKind: 'EXTERNAL_API',
        errorCode: 'EXTERNAL_API_ERROR',
        errorMessage: '라쿠텐 응답을 받지 못했습니다.',
      });
      const res = await runStep(c.id, 'SOURCING');
      expect(res.status).toBe(202);
      await idle();
      const detail = await get(`/step-runs/${(res.body as AcceptedBody).stepRunId}`);
      expect(detail.body).toMatchObject({
        status: 'FAILED',
        failureKind: 'EXTERNAL_API',
        errorCode: 'EXTERNAL_API_ERROR',
        errorMessage: '라쿠텐 응답을 받지 못했습니다.',
      });
      expect((await stepRow(c.id, 'SOURCING')).status).toBe('FAILED');
      const failed = events.find(
        (e) =>
          e.name === 'step-run.status-changed' &&
          (e.data as { status: string }).status === 'FAILED',
      );
      expect(failed?.data).toMatchObject({
        failureKind: 'EXTERNAL_API',
        errorCode: 'EXTERNAL_API_ERROR',
      });
    });

    it('실행기 예외는 FAILED(INPUT_VALIDATION·INTERNAL_ERROR)로 남기고 예외 글은 남기지 않는다', async () => {
      const c = await newCandidate();
      world.script('SOURCING', { kind: 'THROW', error: new Error('secret=abc /Users/x') });
      await complete(c.id, 'SOURCING');
      const run = await t.prisma.stepRun.findFirstOrThrow({ where: { candidateId: c.id } });
      expect(run).toMatchObject({
        status: 'FAILED',
        failureKind: 'INPUT_VALIDATION',
        errorCode: 'INTERNAL_ERROR',
      });
      expect(run.errorMessage).not.toContain('secret');
    });
  });
});
