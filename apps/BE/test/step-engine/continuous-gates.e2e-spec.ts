import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../../src/common/events/progress-events.service.js';
import type { StepCode } from '../../src/modules/step-engine/domain/steps.js';
import { StepExecutor } from '../../src/modules/step-engine/execution/step-executor.js';
import { RestartRecoveryService } from '../../src/modules/step-engine/recovery/restart-recovery.service.js';
import { createCandidate, SAMPLE } from '../fixtures/step-engine/candidate.factory.js';
import { CHAIN_SCENARIOS } from '../fixtures/step-engine/chain-scenarios.js';
import { FakeStepRunnersModule } from '../fixtures/step-engine/fake-runners.module.js';
import { FakeStepWorld } from '../fixtures/step-engine/fake-runners.js';
import {
  FakeGateBasisModule,
  FakeGateWorld,
  judgement,
} from '../fixtures/step-engine/gate-basis.fakes.js';
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

interface ChainDetail {
  id: number;
  candidateId: number;
  kind: string;
  startStepCode: StepCode | null;
  startedAt: string;
  endedAt: string | null;
  stopReason: string | null;
  stopStepCode: StepCode | null;
  stepRuns: { id: number; stepCode: StepCode; executionMode: string; stepChainId: number }[];
  skippedStepCodes: StepCode[];
}

interface GateState {
  gate: string;
  passed: boolean;
  gatePassId: number | null;
  passedAt: string | null;
  basisStepRunId: number | null;
  registrationId: number | null;
  fingerprintValid: boolean | null;
  changedBasisKeys: string[];
  blockedReasons: { code: string; message: string; details?: Record<string, unknown> }[];
  warnings: { code: string; message: string }[];
}

interface GatePassBody {
  gatePassId: number;
  gate: string;
  fingerprint: string;
  basisStepRunId: number;
  passedAt: string;
  candidateStatus: string;
  statusChanged: boolean;
  thumbnailSelectionId: number | null;
  thumbnailStepRunId: number | null;
  warnings: unknown[];
}

/** 05-2 ContinuousRunAccepted required */
const ACCEPTED_KEYS = [
  'stepChainId',
  'candidateId',
  'kind',
  'startStepCode',
  'startedAt',
  'status',
  'stepRunId',
  'stepCode',
].sort();

/** 05-2 ContinuousRunDetail = ContinuousRunSummary + stepRuns·skippedStepCodes */
const DETAIL_KEYS = [
  'id',
  'candidateId',
  'kind',
  'startStepCode',
  'startedAt',
  'endedAt',
  'stopReason',
  'stopStepCode',
  'stepRuns',
  'skippedStepCodes',
].sort();

/** 05-2 GatePassResult required */
const PASS_KEYS = [
  'gatePassId',
  'gate',
  'fingerprint',
  'basisStepRunId',
  'passedAt',
  'candidateStatus',
  'statusChanged',
  'thumbnailSelectionId',
  'thumbnailStepRunId',
  'warnings',
].sort();

/** 05-2 CandidateGateState required */
const GATE_STATE_KEYS = [
  'gate',
  'passed',
  'gatePassId',
  'passedAt',
  'basisStepRunId',
  'registrationId',
  'fingerprintValid',
  'changedBasisKeys',
  'blockedReasons',
  'warnings',
].sort();

describe('연속 실행·게이트(step-engine, P1-06) e2e — autostore_test·가짜 실행기·가짜 게이트 공급자', () => {
  let t: TestApp;
  let world: FakeStepWorld;
  let gates: FakeGateWorld;
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
  const startChain = (candidateId: number, body: object) =>
    post(`/candidates/${candidateId}/continuous-runs`, body);
  const pass = (candidateId: number, gate: string, body: object) =>
    post(`/candidates/${candidateId}/gates/${gate}/pass`, body);
  const current = async (candidateId: number, stepCode: StepCode) =>
    (
      await t.prisma.candidateStep.findUniqueOrThrow({
        where: { candidateId_stepCode: { candidateId, stepCode } },
      })
    ).currentStepRunId!;
  const statusOf = async (candidateId: number, stepCode: StepCode) =>
    (
      await t.prisma.candidateStep.findUniqueOrThrow({
        where: { candidateId_stepCode: { candidateId, stepCode } },
      })
    ).status;
  const complete = async (candidateId: number, ...codes: StepCode[]) => {
    for (const code of codes) {
      const res = await runStep(candidateId, code);
      expect([code, res.status, (res.body as ErrorBody).code]).toEqual([code, 202, undefined]);
      await idle();
    }
  };
  const chainDetail = async (stepChainId: number): Promise<ChainDetail> => {
    const res = await get(`/continuous-runs/${stepChainId}`);
    expect(res.status).toBe(200);
    return res.body as ChainDetail;
  };
  const gateList = async (candidateId: number): Promise<GateState[]> => {
    const res = await get(`/candidates/${candidateId}/gates`);
    expect(res.status).toBe(200);
    return (res.body as { items: GateState[] }).items;
  };
  const gateOf = async (candidateId: number, gate: string) =>
    (await gateList(candidateId)).find((g) => g.gate === gate)!;
  /** 승인대기에 필요한 값(ck_candidate_ready)을 채운 작업중 후보(단계 모두 미실행) */
  const newCandidate = async (patch: Parameters<typeof createCandidate>[1] = {}) =>
    (
      await createCandidate(t.prisma, {
        gender: 'MALE',
        itemCode: SAMPLE.itemCode,
        anchor: { modelCode: SAMPLE.anchorModelCode, colorCode: SAMPLE.anchorColorCode },
        leafCategoryId: SAMPLE.leafCategoryId,
        ...patch,
      })
    ).candidate;
  const passG2 = async (candidateId: number) => {
    const res = await pass(candidateId, 'G2', {
      basisStepRunId: await current(candidateId, 'PRICING'),
    });
    expect([res.status, errorOf(res).code]).toEqual([201, undefined]);
    return res.body as GatePassBody;
  };
  const g3Body = async (candidateId: number) => ({
    basisStepRunId: await current(candidateId, 'THUMBNAIL'),
    representativeImageAssetId: 1,
    additionalImageAssetIds: [],
    checklist: {
      shoeRatioOver70: true,
      detailMatch: true,
      colorMatchesSelectedColor: true,
      referenceNoPerson: true,
      noRealPersonResemblance: true,
      noTextOrPrice: true,
      singleProductSingleModel: true,
    },
  });
  const stoppedEvents = (stepChainId: number) =>
    events.filter(
      (e) =>
        e.name === 'continuous-run.stopped' &&
        (e.data as { stepChainId: number }).stepChainId === stepChainId,
    );

  beforeAll(async () => {
    t = await createTestApp({ imports: [FakeStepRunnersModule, FakeGateBasisModule] });
    // 가짜 AI 단계(⑤·⑥-1·⑥-2)는 선택 엔진이 쓸 수 있어야 시작한다(P1-10 규칙 11)
    await seedUsableAiEngine(t.prisma);
    world = t.app.get(FakeStepWorld);
    gates = t.app.get(FakeGateWorld);
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
    gates.reset();
    t.clock.ms = TEST_START_MS;
    events.length = 0;
  });

  afterAll(async () => {
    world.releaseAll();
    await idle();
    unsubscribe();
    await t.app.close();
  });

  // ── 연속 실행 ──────────────────────────────────────────────────────────

  describe('POST …/continuous-runs · GET /continuous-runs/{id}', () => {
    it('G2 전 FROM_HERE SOURCING → 202 + Location. ② → ③(국내 기준가 대기) → AWAIT_G2/PRICING, 실행은 모두 CHAIN, SSE continuous-run.stopped', async () => {
      const c = await newCandidate();
      CHAIN_SCENARIOS.pricingAwaitsDomesticPrice(world);
      const res = await startChain(c.id, { kind: 'FROM_HERE', startStepCode: 'SOURCING' });
      expect(res.status).toBe(202);
      const accepted = res.body as { stepChainId: number; stepRunId: number };
      expect(Object.keys(accepted).sort()).toEqual(ACCEPTED_KEYS);
      expect(res.headers.location).toBe(`/api/v1/continuous-runs/${accepted.stepChainId}`);
      expect(res.body).toMatchObject({
        candidateId: c.id,
        kind: 'FROM_HERE',
        startStepCode: 'SOURCING',
        status: 'RUNNING',
        stepCode: 'SOURCING',
      });
      await idle();

      const chain = await chainDetail(accepted.stepChainId);
      expect(Object.keys(chain).sort()).toEqual(DETAIL_KEYS);
      expect(chain.stepRuns.map((r) => r.stepCode)).toEqual(['SOURCING', 'PRICING']);
      expect(chain.stepRuns[0]!.id).toBe(accepted.stepRunId);
      expect(chain.stepRuns.every((r) => r.executionMode === 'CHAIN')).toBe(true);
      expect(chain.stepRuns.every((r) => r.stepChainId === accepted.stepChainId)).toBe(true);
      expect(chain).toMatchObject({
        skippedStepCodes: [],
        stopReason: 'AWAIT_G2',
        stopStepCode: 'PRICING',
      });
      expect(chain.endedAt).not.toBeNull();
      expect(await statusOf(c.id, 'PRICING')).toBe('WAITING_INPUT');
      expect(world.callsOf('CATEGORY')).toHaveLength(0);
      expect(stoppedEvents(accepted.stepChainId)).toEqual([
        expect.objectContaining({
          data: {
            stepChainId: accepted.stepChainId,
            candidateId: c.id,
            kind: 'FROM_HERE',
            stopReason: 'AWAIT_G2',
            stopStepCode: 'PRICING',
            endedAt: chain.endedAt,
          },
        }),
      ]);
      // 닫힌 묶음은 후보 상세의 열린 연속 실행이 아니다
      const detail = (await get(`/candidates/${c.id}`)).body as { openContinuousRun: unknown };
      expect(detail.openContinuousRun).toBeNull();
    });

    it('G2 뒤 FROM_HERE SOURCING: 완료·최신 ③·④는 건너뛰고, ⑤가 레퍼런스를 기다려도 ⑥-1·⑥-2·⑥-3·⑦은 돈다(⑧은 안 돔) → NO_RUNNABLE_STEP/THUMBNAIL', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING');
      await passG2(c.id);
      await complete(c.id, 'CATEGORY');
      CHAIN_SCENARIOS.thumbnailAwaitsReference(world);
      const res = await startChain(c.id, { kind: 'FROM_HERE', startStepCode: 'SOURCING' });
      expect(res.status).toBe(202);
      await idle();
      const chain = await chainDetail((res.body as { stepChainId: number }).stepChainId);
      expect(chain.stepRuns.map((r) => r.stepCode)).toEqual([
        'SOURCING',
        'THUMBNAIL',
        'COPY',
        'NOTICE_RAW',
        'NOTICE_HTML',
        'TAGS',
      ]);
      expect(chain.skippedStepCodes).toEqual(['PRICING', 'CATEGORY']);
      expect(chain).toMatchObject({ stopReason: 'NO_RUNNABLE_STEP', stopStepCode: 'THUMBNAIL' });
      expect(world.callsOf('UPLOAD')).toHaveLength(0);
      expect(await statusOf(c.id, 'THUMBNAIL')).toBe('WAITING_INPUT');
    });

    it('⑥-2 실패 → ⑥-3·⑧(⑥-2를 읽음)만 멈추고 ⑦은 돈다. ⑤가 완료인데 G3이 무효라 ⑧ 앞 AWAIT_G3로 끝난다', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING');
      await passG2(c.id);
      CHAIN_SCENARIOS.noticeRawFails(world);
      const res = await startChain(c.id, { kind: 'FROM_HERE', startStepCode: 'CATEGORY' });
      expect(res.status).toBe(202);
      await idle();
      const chain = await chainDetail((res.body as { stepChainId: number }).stepChainId);
      expect(chain.stepRuns.map((r) => r.stepCode)).toEqual([
        'CATEGORY',
        'THUMBNAIL',
        'COPY',
        'NOTICE_RAW',
        'TAGS',
      ]);
      expect(await statusOf(c.id, 'NOTICE_RAW')).toBe('FAILED');
      expect(world.callsOf('NOTICE_HTML')).toHaveLength(0);
      expect(chain).toMatchObject({ stopReason: 'AWAIT_G3', stopStepCode: 'THUMBNAIL' });
    });

    it('⑤ 완료·G3 무효 → ⑧ 앞 AWAIT_G3/THUMBNAIL. G3 통과 뒤 다시 → ⑧ 실행 → AWAIT_G4/REGISTER, 후보 승인대기', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING');
      await passG2(c.id);
      const first = await startChain(c.id, { kind: 'FROM_HERE', startStepCode: 'CATEGORY' });
      expect(first.status).toBe(202);
      await idle();
      const stopped = await chainDetail((first.body as { stepChainId: number }).stepChainId);
      expect(stopped).toMatchObject({ stopReason: 'AWAIT_G3', stopStepCode: 'THUMBNAIL' });
      expect(world.callsOf('UPLOAD')).toHaveLength(0);

      const g3 = await pass(c.id, 'G3', await g3Body(c.id));
      expect(g3.status).toBe(201);
      const second = await startChain(c.id, { kind: 'FROM_HERE', startStepCode: 'TAGS' });
      expect(second.status).toBe(202);
      await idle();
      const done = await chainDetail((second.body as { stepChainId: number }).stepChainId);
      expect(done.stepRuns.map((r) => r.stepCode)).toEqual(['TAGS', 'UPLOAD']);
      expect(done).toMatchObject({ stopReason: 'AWAIT_G4', stopStepCode: 'REGISTER' });
      expect((await t.prisma.candidate.findUniqueOrThrow({ where: { id: c.id } })).status).toBe(
        'AWAITING_APPROVAL',
      );
    });

    it('판정 페이지가 7시간 전 → ③을 건너뛰지 않고 ② 재조회(refetch) → ③ 재판정. G2 지문이 같으면 G2는 그대로 유효', async () => {
      const c = await newCandidate();
      const now = new Date(TEST_START_MS);
      CHAIN_SCENARIOS.judgementPage7HoursAgo(world, c.id, now);
      await complete(c.id, 'SOURCING', 'PRICING');
      await passG2(c.id);
      await complete(c.id, 'CATEGORY', 'THUMBNAIL', 'COPY', 'NOTICE_RAW', 'NOTICE_HTML', 'TAGS');
      const oldPricing = await current(c.id, 'PRICING');
      CHAIN_SCENARIOS.pageRefetchedAt(world, c.id, now);

      const res = await startChain(c.id, { kind: 'FROM_HERE', startStepCode: 'PRICING' });
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ stepCode: 'SOURCING' });
      await idle();
      const chain = await chainDetail((res.body as { stepChainId: number }).stepChainId);
      expect(chain.stepRuns.map((r) => r.stepCode)).toEqual(['SOURCING', 'PRICING']);
      expect(world.refetchCallsOf('SOURCING')).toBe(1);
      const newPricing = await current(c.id, 'PRICING');
      expect(newPricing).not.toBe(oldPricing);
      expect(world.judgementPageAt.get(newPricing)).toEqual(now);
      // ③을 다시 돌렸지만 판정 값이 같아 G2는 유효 → ⑧ 앞 G3에서 멈춘다
      expect((await gateOf(c.id, 'G2')).fingerprintValid).toBe(true);
      expect(chain.skippedStepCodes).toEqual([
        'CATEGORY',
        'THUMBNAIL',
        'COPY',
        'NOTICE_RAW',
        'NOTICE_HTML',
        'TAGS',
      ]);
      expect(chain).toMatchObject({ stopReason: 'AWAIT_G3', stopStepCode: 'THUMBNAIL' });
    });

    it('RERUN_STALE: ③이 다시 돌아 ⑥-3이 새로 재실행 필요 → ⑥-3까지 이어서 실행', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING');
      await passG2(c.id);
      await complete(c.id, 'CATEGORY', 'THUMBNAIL', 'COPY', 'NOTICE_RAW', 'NOTICE_HTML', 'TAGS');
      // ② 목표 사이즈 SKU가가 바뀌어 ③이 재실행 필요, ③을 다시 돌리면 판매 사이즈가 바뀌어 ⑥-3이 재실행 필요
      world.set(c.id, 'sourcing.targetSkus', { '250': 12100 });
      await complete(c.id, 'SOURCING');
      expect(await statusOf(c.id, 'PRICING')).toBe('RERUN_REQUIRED');
      expect(await statusOf(c.id, 'NOTICE_HTML')).toBe('COMPLETED');
      world.set(c.id, 'pricing.saleSizes', [245, 250]);

      const res = await startChain(c.id, { kind: 'RERUN_STALE' });
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({
        kind: 'RERUN_STALE',
        startStepCode: null,
        stepCode: 'PRICING',
      });
      await idle();
      const chain = await chainDetail((res.body as { stepChainId: number }).stepChainId);
      expect(chain.stepRuns.map((r) => r.stepCode)).toEqual(['PRICING', 'NOTICE_HTML']);
      expect(await statusOf(c.id, 'NOTICE_HTML')).toBe('COMPLETED');
      expect(chain.skippedStepCodes).toEqual([]);
      expect(chain).toMatchObject({ stopReason: 'NO_RUNNABLE_STEP', stopStepCode: 'UPLOAD' });
    });

    it('422·409·404: startStepCode 없음·REGISTER·G2 전 ④·열린 묶음·재실행 필요 없음·없는 묶음', async () => {
      const c = await newCandidate();
      const missing = await startChain(c.id, { kind: 'FROM_HERE' });
      expect([missing.status, errorOf(missing).code]).toEqual([422, 'VALIDATION_FAILED']);
      expect(errorOf(missing).fieldErrors?.[0]?.field).toBe('startStepCode');
      const register = await startChain(c.id, { kind: 'FROM_HERE', startStepCode: 'REGISTER' });
      expect([register.status, errorOf(register).code]).toEqual([422, 'INVALID_STEP_CODE']);
      const unknown = await startChain(c.id, { kind: 'FROM_HERE', startStepCode: 'NOPE' });
      expect([unknown.status, errorOf(unknown).code]).toEqual([422, 'INVALID_STEP_CODE']);
      const badKind = await startChain(c.id, { kind: 'ALL' });
      expect([badKind.status, errorOf(badKind).code]).toEqual([422, 'VALIDATION_FAILED']);
      const beforeG2 = await startChain(c.id, { kind: 'FROM_HERE', startStepCode: 'CATEGORY' });
      expect([beforeG2.status, errorOf(beforeG2).code]).toEqual([409, 'CONTINUOUS_RUN_BEFORE_G2']);
      const noRerun = await startChain(c.id, { kind: 'RERUN_STALE' });
      expect([noRerun.status, errorOf(noRerun).code]).toEqual([409, 'NO_RERUN_REQUIRED_STEPS']);
      expect(await t.prisma.stepChain.count()).toBe(0);

      world.script('SOURCING', { kind: 'HOLD' });
      const first = await startChain(c.id, { kind: 'FROM_HERE', startStepCode: 'SOURCING' });
      expect(first.status).toBe(202);
      const second = await startChain(c.id, { kind: 'FROM_HERE', startStepCode: 'PRICING' });
      expect([second.status, errorOf(second).code]).toEqual([409, 'CONTINUOUS_RUN_ALREADY_OPEN']);
      // 레일 '여기부터 연속 실행'도 같은 코드로 꺼지고, 후보 상세에 열린 묶음이 보인다
      const rail = (await get(`/candidates/${c.id}/steps`)).body as {
        items: {
          stepCode: string;
          actions: { continuousRun: { disabledReason: { code: string } | null } };
        }[];
      };
      expect(
        rail.items.find((i) => i.stepCode === 'PRICING')!.actions.continuousRun.disabledReason
          ?.code,
      ).toBe('CONTINUOUS_RUN_ALREADY_OPEN');
      const detail = (await get(`/candidates/${c.id}`)).body as {
        openContinuousRun: { id: number; endedAt: string | null } | null;
      };
      expect(detail.openContinuousRun).toMatchObject({
        id: (first.body as { stepChainId: number }).stepChainId,
        endedAt: null,
      });
      world.release('SOURCING');
      await idle();

      const notFound = await get('/continuous-runs/999999');
      expect([notFound.status, errorOf(notFound).code]).toEqual([404, 'CONTINUOUS_RUN_NOT_FOUND']);
      const badId = await get('/continuous-runs/abc');
      expect([badId.status, errorOf(badId).code]).toEqual([404, 'CONTINUOUS_RUN_NOT_FOUND']);
      const noClient = await http()
        .post(`/api/v1/candidates/${c.id}/continuous-runs`)
        .send({ kind: 'RERUN_STALE' });
      expect(noClient.status).toBe(403);
    });

    it('잠긴·제외 후보 → 409 CANDIDATE_LOCKED·CANDIDATE_EXCLUDED(묶음을 만들지 않는다)', async () => {
      const locked = await newCandidate({ status: 'REGISTERING', itemCode: 'shop-z:1' });
      const excluded = await newCandidate({ status: 'EXCLUDED', itemCode: 'shop-z:2' });
      const a = await startChain(locked.id, { kind: 'FROM_HERE', startStepCode: 'SOURCING' });
      expect([a.status, errorOf(a).code]).toEqual([409, 'CANDIDATE_LOCKED']);
      const b = await startChain(excluded.id, { kind: 'FROM_HERE', startStepCode: 'SOURCING' });
      expect([b.status, errorOf(b).code]).toEqual([409, 'CANDIDATE_EXCLUDED']);
      expect(await t.prisma.stepChain.count()).toBe(0);
    });

    it('재시작 정리를 부르면 열린 묶음이 APP_RESTART로 닫힌다(다시 이어 가지 않는다)', async () => {
      const c = await newCandidate();
      world.script('SOURCING', { kind: 'HOLD' });
      const res = await startChain(c.id, { kind: 'FROM_HERE', startStepCode: 'SOURCING' });
      expect(res.status).toBe(202);
      const stepChainId = (res.body as { stepChainId: number }).stepChainId;
      const result = await t.app.get(RestartRecoveryService).recover();
      expect(result.closedStepChainIds).toEqual([stepChainId]);
      world.release('SOURCING');
      await idle();
      const chain = await chainDetail(stepChainId);
      expect(chain).toMatchObject({ stopReason: 'APP_RESTART', stopStepCode: 'SOURCING' });
      expect(chain.endedAt).not.toBeNull();
      expect(world.callsOf('PRICING')).toHaveLength(0);
      expect(
        stoppedEvents(stepChainId).map((e) => (e.data as { stopReason: string }).stopReason),
      ).toEqual(['APP_RESTART']);
    });
  });

  // ── 게이트 ─────────────────────────────────────────────────────────────

  describe('POST …/gates/{gateCode}/pass · GET …/gates', () => {
    it('G4·G1·모르는 게이트 → 422 INVALID_GATE_CODE, X-AutoStore-Client 없으면 403(웹 화면 전용)', async () => {
      const c = await newCandidate();
      for (const gate of ['G4', 'G1', 'G9']) {
        const res = await pass(c.id, gate, { basisStepRunId: 1 });
        expect([gate, res.status, errorOf(res).code]).toEqual([gate, 422, 'INVALID_GATE_CODE']);
      }
      const noClient = await http()
        .post(`/api/v1/candidates/${c.id}/gates/G2/pass`)
        .send({ basisStepRunId: 1 });
      expect(noClient.status).toBe(403);
      const badBody = await pass(c.id, 'G2', { basisStepRunId: 0 });
      expect([badBody.status, errorOf(badBody).code]).toEqual([422, 'VALIDATION_FAILED']);
      const g3Fields = await pass(c.id, 'G2', { basisStepRunId: 1, checklist: {} });
      expect([g3Fields.status, errorOf(g3Fields).code]).toEqual([422, 'VALIDATION_FAILED']);
    });

    it('옛 ③ 버전 → 409 VERSION_NOT_CURRENT, ③ 입력 대기 → 409 STEP_NOT_COMPLETED', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING');
      const v1 = await current(c.id, 'PRICING');
      await complete(c.id, 'PRICING');
      const old = await pass(c.id, 'G2', { basisStepRunId: v1 });
      expect([old.status, errorOf(old).code]).toEqual([409, 'VERSION_NOT_CURRENT']);
      CHAIN_SCENARIOS.pricingAwaitsDomesticPrice(world);
      await complete(c.id, 'PRICING');
      const waiting = await pass(c.id, 'G2', { basisStepRunId: await current(c.id, 'PRICING') });
      expect([waiting.status, errorOf(waiting).code]).toEqual([409, 'STEP_NOT_COMPLETED']);
      expect(errorOf(waiting).details).toMatchObject({
        stepCode: 'PRICING',
        status: 'WAITING_INPUT',
      });
      expect(await t.prisma.gatePass.count()).toBe(0);
    });

    it('판매 후보 아님 → 409 NOT_SALE_CANDIDATE', async () => {
      const c = await newCandidate();
      world.set(c.id, 'pricing.judgement', judgement({ saleCandidate: false }));
      await complete(c.id, 'SOURCING', 'PRICING');
      const res = await pass(c.id, 'G2', { basisStepRunId: await current(c.id, 'PRICING') });
      expect([res.status, errorOf(res).code]).toEqual([409, 'NOT_SALE_CANDIDATE']);
      const g2 = await gateOf(c.id, 'G2');
      expect(g2.blockedReasons.map((r) => r.code)).toEqual(['NOT_SALE_CANDIDATE']);
    });

    it("비교 안 한 URL 후보·'비교 없이 확정' 없음 → 409 NO_COMPARISON_NOT_CONFIRMED, 체크하면 통과", async () => {
      const c = await newCandidate({ creationPath: 'RAKUTEN_URL', rakutenQuery: null });
      await complete(c.id, 'SOURCING', 'PRICING');
      const basisStepRunId = await current(c.id, 'PRICING');
      const res = await pass(c.id, 'G2', { basisStepRunId });
      expect([res.status, errorOf(res).code]).toEqual([409, 'NO_COMPARISON_NOT_CONFIRMED']);
      await t.prisma.candidate.update({
        where: { id: c.id },
        data: { noComparisonConfirmedAt: new Date(TEST_START_MS) },
      });
      expect((await pass(c.id, 'G2', { basisStepRunId })).status).toBe(201);
    });

    it('통과 → 201 + Location, gate_pass·user_action_log(GATE_PASSED) 1행, SSE gate.passed. 같은 요청 다시 → 200 같은 gatePassId, 행 수 그대로', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING');
      const basisStepRunId = await current(c.id, 'PRICING');
      const res = await pass(c.id, 'G2', { basisStepRunId });
      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(`/api/v1/candidates/${c.id}/gates`);
      const body = res.body as GatePassBody;
      expect(Object.keys(body).sort()).toEqual(PASS_KEYS);
      expect(body).toMatchObject({
        gate: 'G2',
        basisStepRunId,
        candidateStatus: 'WORKING',
        statusChanged: false,
        thumbnailSelectionId: null,
        thumbnailStepRunId: null,
        warnings: [],
      });
      expect(body.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      const row = await t.prisma.gatePass.findUniqueOrThrow({ where: { id: body.gatePassId } });
      expect(row).toMatchObject({ basisStepCode: 'PRICING', fingerprint: body.fingerprint });
      expect(row.fingerprintBasis).toMatchObject({
        itemCode: SAMPLE.itemCode,
        selectedColor: SAMPLE.selectedColor,
        saleCandidate: true,
        saleSizes: [245, 250, 255],
        salePrices: { '250': 129000 },
      });
      const logs = await t.prisma.userActionLog.findMany({ where: { candidateId: c.id } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        eventType: 'GATE_PASSED',
        gate: 'G2',
        stepRunId: basisStepRunId,
        stepCode: 'PRICING',
      });
      expect(events.filter((e) => e.name === 'gate.passed').map((e) => e.data)).toEqual([
        { candidateId: c.id, gate: 'G2', gatePassId: body.gatePassId, passedAt: body.passedAt },
      ]);
      expect(gates.passes).toHaveLength(1);

      const again = await pass(c.id, 'G2', { basisStepRunId });
      expect(again.status).toBe(200);
      expect((again.body as GatePassBody).gatePassId).toBe(body.gatePassId);
      expect(await t.prisma.gatePass.count()).toBe(1);
      expect(await t.prisma.userActionLog.count()).toBe(1);

      // ③을 다시 돌려도 판정 값이 같으면(P_min만 바뀜) 새 버전으로 통과해도 기존 기록 200
      world.set(c.id, 'pricing.judgement', judgement({ pMinKrw: 121500 }));
      await complete(c.id, 'PRICING');
      expect((await gateOf(c.id, 'G2')).fingerprintValid).toBe(true);
      const newVersion = await pass(c.id, 'G2', {
        basisStepRunId: await current(c.id, 'PRICING'),
      });
      expect([newVersion.status, (newVersion.body as GatePassBody).gatePassId]).toEqual([
        200,
        body.gatePassId,
      ]);
    });

    it('9단계 완료 + G3 + G2 통과 → 승인대기(statusChanged). ③ 새 버전으로 판매가가 바뀌면 G2 무효·changedBasisKeys, 작업중(GATE_FINGERPRINT_CHANGED), SSE gate.invalidated', async () => {
      const c = await newCandidate();
      world.set(c.id, 'pricing.judgement', judgement());
      await complete(c.id, 'SOURCING', 'PRICING');
      const pricingV1 = await current(c.id, 'PRICING');
      const raised = judgement();
      raised.sizes[1]!.salePriceKrw = 129100;
      world.set(c.id, 'pricing.judgement', raised);
      await complete(c.id, 'PRICING');
      await complete(c.id, 'CATEGORY', 'THUMBNAIL', 'COPY', 'NOTICE_RAW', 'NOTICE_HTML', 'TAGS');
      const g3 = await pass(c.id, 'G3', await g3Body(c.id));
      expect(g3.status).toBe(201);
      expect(g3.body).toMatchObject({
        gate: 'G3',
        candidateStatus: 'WORKING',
        statusChanged: false,
      });
      await complete(c.id, 'UPLOAD');

      const g2 = await passG2(c.id);
      expect(g2).toMatchObject({ candidateStatus: 'AWAITING_APPROVAL', statusChanged: true });
      const history = await t.prisma.candidateStatusHistory.findFirstOrThrow({
        where: { candidateId: c.id, toStatus: 'AWAITING_APPROVAL' },
      });
      expect(history).toMatchObject({ reason: 'READY_FOR_APPROVAL', gatePassId: g2.gatePassId });
      const valid = await gateList(c.id);
      expect(valid.map((g) => [g.gate, g.passed])).toEqual([
        ['G1', false],
        ['G2', true],
        ['G3', true],
        ['G4', false],
      ]);
      events.length = 0;

      // 이전 ③ 버전(판매가 129,000원)을 다시 고른다 → 새 ③ 버전의 250mm 판매가가 달라진다
      const restore = await post(`/candidates/${c.id}/steps/PRICING/owner-edits`, {
        ownerAction: 'RESTORE_VERSION',
        baseStepRunId: pricingV1,
      });
      expect(restore.status).toBe(201);
      const g2State = await gateOf(c.id, 'G2');
      expect(Object.keys(g2State).sort()).toEqual(GATE_STATE_KEYS);
      expect(g2State).toMatchObject({
        passed: false,
        fingerprintValid: false,
        gatePassId: g2.gatePassId,
        changedBasisKeys: ['salePrices.250'],
      });
      const candidate = await t.prisma.candidate.findUniqueOrThrow({ where: { id: c.id } });
      expect(candidate.status).toBe('WORKING');
      const latest = await t.prisma.candidateStatusHistory.findFirstOrThrow({
        where: { candidateId: c.id },
        orderBy: { id: 'desc' },
      });
      expect(latest).toMatchObject({
        fromStatus: 'AWAITING_APPROVAL',
        toStatus: 'WORKING',
        reason: 'GATE_FINGERPRINT_CHANGED',
      });
      expect(events.filter((e) => e.name === 'gate.invalidated').map((e) => e.data)).toEqual([
        {
          candidateId: c.id,
          gate: 'G2',
          previousGatePassId: g2.gatePassId,
          changedBasisKeys: ['salePrices.250'],
        },
      ]);
      // 다시 통과하면 새 gate_pass 행 + 승인대기
      const again = await passG2(c.id);
      expect(again.gatePassId).not.toBe(g2.gatePassId);
      expect(again).toMatchObject({ candidateStatus: 'AWAITING_APPROVAL', statusChanged: true });
    });

    it('② 소싱 선택(itemCode)이 바뀌면 G2가 무효가 된다(SSE gate.invalidated 한 번)', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING');
      const g2 = await passG2(c.id);
      events.length = 0;
      world.script('SOURCING', {
        kind: 'COMPLETE',
        candidateEffects: {
          sourcingSelection: { itemCode: 'shop-b:20000456', selectedColor: SAMPLE.selectedColor },
        },
      });
      await complete(c.id, 'SOURCING');
      const state = await gateOf(c.id, 'G2');
      expect(state).toMatchObject({ fingerprintValid: false, changedBasisKeys: ['itemCode'] });
      expect(events.filter((e) => e.name === 'gate.invalidated').map((e) => e.data)).toEqual([
        {
          candidateId: c.id,
          gate: 'G2',
          previousGatePassId: g2.gatePassId,
          changedBasisKeys: ['itemCode'],
        },
      ]);
    });

    it('G3 없이 UPLOAD 실행 → 409 GATE_NOT_PASSED(details.gate=G3)', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING', 'THUMBNAIL', 'COPY', 'NOTICE_RAW', 'NOTICE_HTML');
      const res = await runStep(c.id, 'UPLOAD');
      expect([res.status, errorOf(res).code]).toEqual([409, 'GATE_NOT_PASSED']);
      expect(errorOf(res).details).toMatchObject({ gate: 'G3', stepCode: 'UPLOAD' });
    });

    it('게이트 목록: items 4개(G1~G4). 키워드 경로 G1 = keyword.selected_at, 다른 경로는 G1 없음. 막힌 이유 코드는 통과 API와 같다', async () => {
      const keyword = await newCandidate({ creationPath: 'KEYWORD' });
      const items = await gateList(keyword.id);
      expect(items.map((g) => g.gate)).toEqual(['G1', 'G2', 'G3', 'G4']);
      for (const item of items) expect(Object.keys(item).sort()).toEqual(GATE_STATE_KEYS);
      expect(items[0]).toMatchObject({ gate: 'G1', passed: true, fingerprintValid: null });
      expect(items[0]!.passedAt).not.toBeNull();
      expect(items[1]).toMatchObject({
        gate: 'G2',
        passed: false,
        fingerprintValid: false,
        gatePassId: null,
        blockedReasons: [
          expect.objectContaining({
            code: 'STEP_NOT_COMPLETED',
            details: { stepCode: 'PRICING', status: 'NOT_RUN' },
          }),
        ],
      });
      expect(items[3]).toMatchObject({
        gate: 'G4',
        passed: false,
        registrationId: null,
        fingerprintValid: null,
      });

      const search = await newCandidate({ itemCode: 'shop-y:1' });
      expect((await gateList(search.id))[0]).toMatchObject({
        gate: 'G1',
        passed: false,
        passedAt: null,
      });
      const missing = await get('/candidates/999999/gates');
      expect([missing.status, errorOf(missing).code]).toEqual([404, 'CANDIDATE_NOT_FOUND']);
    });

    it('gate_pass는 추가만: UPDATE·DELETE는 트리거 오류', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING');
      const g2 = await passG2(c.id);
      await expect(
        t.prisma.$executeRawUnsafe(
          `UPDATE gate_pass SET fingerprint = '${'0'.repeat(64)}' WHERE id = ${g2.gatePassId}`,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        t.prisma.$executeRawUnsafe(`DELETE FROM gate_pass WHERE id = ${g2.gatePassId}`),
      ).rejects.toThrow(/append-only/);
      expect(await t.prisma.gatePass.count()).toBe(1);
    });
  });
});
