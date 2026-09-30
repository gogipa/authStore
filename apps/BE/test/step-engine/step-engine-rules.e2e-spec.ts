import { readFileSync } from 'node:fs';
import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../../src/common/events/progress-events.service.js';
import type { AppSettings } from '../../src/modules/settings/schema/settings.types.js';
import {
  settingsFilePath,
  writeSettingsFileAtomically,
} from '../../src/modules/settings/settings-file.loader.js';
import type { StepCode } from '../../src/modules/step-engine/domain/steps.js';
import { StepExecutionService } from '../../src/modules/step-engine/execution/step-execution.service.js';
import { StepExecutor } from '../../src/modules/step-engine/execution/step-executor.js';
import { isOneOpenRunViolation } from '../../src/modules/step-engine/execution/step-run-store.js';
import {
  INTERRUPTED_ERROR,
  RestartRecoveryService,
} from '../../src/modules/step-engine/recovery/restart-recovery.service.js';
import { StepEngineApi } from '../../src/modules/step-engine/step-engine.api.js';
import {
  allRequiredCompleted,
  createCandidate,
} from '../fixtures/step-engine/candidate.factory.js';
import { FakeStepRunnersModule } from '../fixtures/step-engine/fake-runners.module.js';
import { FakeStepWorld } from '../fixtures/step-engine/fake-runners.js';
import { FakeGateBasisModule, recordGatePass } from '../fixtures/step-engine/gate-basis.fakes.js';
import { insertStepRun } from '../fixtures/step-engine/step-run.factory.js';
import { truncateStepEngine } from '../fixtures/step-engine/truncate.js';
import { createTestApp, TEST_START_MS, type TestApp } from '../helpers/test-app.js';
import { seedUsableAiEngine } from '../support/fake-ai-engines.js';

/** setup-env.cjs가 이 파일에 준 임시 데이터 폴더 */
const DATA_DIR = process.env.APP_DATA_DIR!;

describe('단계 실행 엔진 규칙(P1-05) e2e — 전파·끝 지문·오너 입력·재시작·설정 변경', () => {
  let t: TestApp;
  let world: FakeStepWorld;
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;

  const http = () => request(t.app.getHttpServer());
  const post = (path: string, body?: object) => {
    const req = http().post(`/api/v1${path}`).set('X-AutoStore-Client', '1');
    return body ? req.send(body) : req;
  };
  const idle = () => t.app.get(StepExecutor).whenIdle();
  const runStep = (candidateId: number, stepCode: string, body?: object) =>
    post(`/candidates/${candidateId}/steps/${stepCode}/runs`, body);
  const stepRow = (candidateId: number, stepCode: StepCode) =>
    t.prisma.candidateStep.findUniqueOrThrow({
      where: { candidateId_stepCode: { candidateId, stepCode } },
    });
  const statuses = async (candidateId: number) =>
    Object.fromEntries(
      (await t.prisma.candidateStep.findMany({ where: { candidateId } })).map((r) => [
        r.stepCode,
        r.status,
      ]),
    ) as Record<StepCode, string>;
  const complete = async (candidateId: number, ...codes: StepCode[]) => {
    for (const code of codes) {
      const res = await runStep(candidateId, code);
      expect([code, res.status]).toEqual([code, 202]);
      await idle();
    }
  };
  const newCandidate = async (patch: Parameters<typeof createCandidate>[1] = {}) =>
    (await createCandidate(t.prisma, { gender: 'MALE', ...patch })).candidate;
  /** G3 통과 기록(P1-06: 지금 값으로 계산한 지문 — 가짜 게이트 공급자) */
  const passG3 = async (candidateId: number) => {
    await recordGatePass(t.app, t.prisma, candidateId, 'G3');
  };

  beforeAll(async () => {
    t = await createTestApp({ imports: [FakeStepRunnersModule, FakeGateBasisModule] });
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

  describe('재실행 필요 전파(규칙 6, US-33 AC3)', () => {
    it('⑤ 새 선택 완료 → ⑧만 RERUN_REQUIRED, ⑥-1·⑦은 COMPLETED(자동으로 다시 실행하지 않는다)', async () => {
      const c = await newCandidate();
      await complete(
        c.id,
        'SOURCING',
        'PRICING',
        'THUMBNAIL',
        'COPY',
        'NOTICE_RAW',
        'NOTICE_HTML',
        'TAGS',
      );
      await passG3(c.id);
      await complete(c.id, 'UPLOAD');
      const uploadRuns = world.callsOf('UPLOAD').length;

      world.set(c.id, 'thumbnail.selection', { sha256: 'd'.repeat(64) });
      await complete(c.id, 'THUMBNAIL');
      const s = await statuses(c.id);
      expect(s.UPLOAD).toBe('RERUN_REQUIRED');
      expect(s.COPY).toBe('COMPLETED');
      expect(s.TAGS).toBe('COMPLETED');
      expect(s.NOTICE_HTML).toBe('COMPLETED');
      expect(await stepRow(c.id, 'UPLOAD')).toMatchObject({
        staleInputs: ['thumbnail.selection'],
      });
      expect((await stepRow(c.id, 'UPLOAD')).staleSince).not.toBeNull();
      expect(world.callsOf('UPLOAD')).toHaveLength(uploadRuns);
      const changed = events.filter(
        (e) =>
          e.name === 'candidate-step.changed' &&
          (e.data as { stepCode: string }).stepCode === 'UPLOAD' &&
          (e.data as { status: string }).status === 'RERUN_REQUIRED',
      );
      expect(changed).toHaveLength(1);
    });

    it('③ 국내가만 바뀌고 판매 사이즈가 같으면 ⑥-3은 COMPLETED 그대로', async () => {
      const c = await newCandidate();
      world.set(c.id, 'owner.domesticPrice', 89000);
      await complete(c.id, 'SOURCING', 'PRICING', 'COPY', 'NOTICE_RAW', 'NOTICE_HTML');
      world.set(c.id, 'owner.domesticPrice', 99000);
      await complete(c.id, 'PRICING');
      expect((await statuses(c.id)).NOTICE_HTML).toBe('COMPLETED');
      // 판매 사이즈가 바뀌면 ⑥-3만 재실행 필요
      world.set(c.id, 'pricing.saleSizes', [255, 260]);
      await complete(c.id, 'PRICING');
      expect(await stepRow(c.id, 'NOTICE_HTML')).toMatchObject({
        status: 'RERUN_REQUIRED',
        staleInputs: ['pricing.saleSizes'],
      });
    });

    it('같은 값으로 ② 다시 실행 → 아무 단계도 안 바뀐다. 현재 버전이 없는(NOT_RUN) 단계는 표시하지 않는다', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING', 'COPY', 'TAGS');
      const before = await statuses(c.id);
      await complete(c.id, 'SOURCING');
      expect(await statuses(c.id)).toEqual(before);

      world.set(c.id, 'sourcing.genre', { genreId: '208025' });
      world.set(c.id, 'sourcing.itemText', '다른 설명');
      await complete(c.id, 'SOURCING');
      const after = await statuses(c.id);
      expect(after.CATEGORY).toBe('NOT_RUN');
      expect(after.THUMBNAIL).toBe('NOT_RUN');
      expect(after.COPY).toBe('RERUN_REQUIRED');
      expect(after.PRICING).toBe('COMPLETED');
    });

    // P3-01: ⑤는 이제 ② 산출물을 지문에 넣지 않아(설정 두 키뿐) ⑥-1(② 상품명·설명)로 본다
    it('입력 대기 중인 ⑥-1의 시작 조건이 바뀌면 step_run·candidate_step 모두 RERUN_REQUIRED(대기 시간 누적)', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING');
      world.script('COPY', { kind: 'WAIT', waitingReasonCode: 'FACT_REQUIRED' });
      await complete(c.id, 'COPY');
      const waiting = (await stepRow(c.id, 'COPY')).currentStepRunId!;
      expect((await t.prisma.stepRun.findUniqueOrThrow({ where: { id: waiting } })).status).toBe(
        'WAITING_INPUT',
      );
      // 입력 대기는 다른 단계를 잠그지 않는다 → ②를 다시 실행할 수 있다
      t.clock.advance(90_000);
      world.set(c.id, 'sourcing.itemText', '바뀐 설명');
      await complete(c.id, 'SOURCING');
      const run = await t.prisma.stepRun.findUniqueOrThrow({ where: { id: waiting } });
      expect(run).toMatchObject({
        status: 'RERUN_REQUIRED',
        rerunReasonInputs: ['sourcing.itemText'],
        waitingSince: null,
        waitSecondsTotal: 90,
      });
      expect(run.endedAt).not.toBeNull();
      expect(await stepRow(c.id, 'COPY')).toMatchObject({
        status: 'RERUN_REQUIRED',
        staleInputs: ['sourcing.itemText'],
      });
      // 닫혔으니 다시 실행할 수 있다
      await complete(c.id, 'COPY');
      expect((await stepRow(c.id, 'COPY')).status).toBe('COMPLETED');
    });

    it('P3-01 규칙 2: ⑤ 입력 대기 중 ② 산출물(원본 이미지·itemCode)만 바뀌면 ⑤는 그대로다(지문은 설정 두 키)', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING');
      world.script('THUMBNAIL', {
        kind: 'WAIT',
        waitingReasonCode: 'THUMBNAIL_REFERENCE_REQUIRED',
      });
      await complete(c.id, 'THUMBNAIL');
      const waiting = (await stepRow(c.id, 'THUMBNAIL')).currentStepRunId!;
      world.set(c.id, 'sourcing.images', [{ sha256: 'e'.repeat(64) }]);
      world.set(c.id, 'sourcing.selection', { itemCode: 'shop-b:20000456' });
      await complete(c.id, 'SOURCING');
      expect(await stepRow(c.id, 'THUMBNAIL')).toMatchObject({
        status: 'WAITING_INPUT',
        currentStepRunId: waiting,
        staleInputs: [],
      });
    });

    it('④가 끝나면 ④ 없이 돈 ⑦이 재실행 필요가 된다(선택 입력)', async () => {
      const c = await newCandidate();
      const start = await runStep(c.id, 'SOURCING');
      expect(start.status).toBe(202);
      await idle();
      const tags = await runStep(c.id, 'TAGS');
      expect((tags.body as { warnings: { code: string }[] }).warnings.map((w) => w.code)).toEqual([
        'CATEGORY_UNDECIDED',
      ]);
      await idle();
      await complete(c.id, 'CATEGORY');
      expect(await stepRow(c.id, 'TAGS')).toMatchObject({
        status: 'RERUN_REQUIRED',
        staleInputs: ['category.leafPath'],
      });
    });

    it('승인대기 후보의 단계가 재실행 필요가 되면 작업중(STEP_NOT_CURRENT)으로 돌아간다', async () => {
      const fx = await createCandidate(t.prisma, {
        status: 'AWAITING_APPROVAL',
        steps: allRequiredCompleted(),
      });
      const c = fx.candidate;
      // ②를 다시 실행하면(시작 트랜잭션) 필수 단계가 완료가 아니게 되어 작업중으로 돌아간다
      await complete(c.id, 'SOURCING');
      expect((await t.prisma.candidate.findUniqueOrThrow({ where: { id: c.id } })).status).toBe(
        'WORKING',
      );
      const history = await t.prisma.candidateStatusHistory.findMany({
        where: { candidateId: c.id },
        orderBy: { id: 'asc' },
      });
      expect(history.at(-1)).toMatchObject({ toStatus: 'WORKING', reason: 'STEP_NOT_CURRENT' });
    });
  });

  describe('끝 지문·완료 뒤 오너 입력(규칙 5·7)', () => {
    it('실행 중에 시작 조건 값을 바꾸면 결과는 저장하고 RERUN_REQUIRED + rerun_reason_inputs', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING');
      world.script('PRICING', {
        kind: 'HOLD',
        onHold: () => world.set(c.id, 'owner.coupon', 500),
      });
      const res = await runStep(c.id, 'PRICING');
      const id = (res.body as { stepRunId: number }).stepRunId;
      await new Promise((r) => setImmediate(r));
      world.release('PRICING');
      await idle();
      const run = await t.prisma.stepRun.findUniqueOrThrow({ where: { id } });
      expect(run).toMatchObject({ status: 'RERUN_REQUIRED', rerunReasonInputs: ['owner.coupon'] });
      expect(run.inputFingerprintEnd).not.toBe(run.inputFingerprintStart);
      expect(run.endedAt).not.toBeNull();
      expect(await stepRow(c.id, 'PRICING')).toMatchObject({
        status: 'RERUN_REQUIRED',
        staleInputs: ['owner.coupon'],
      });
      // 결과(산출물)는 저장했다
      expect(world.outputs.get(id)).toBeDefined();
    });

    it('완료 뒤 owner.domesticPrice 새 값 → ③ RERUN_REQUIRED. 다시 실행 때 실행기가 받은 기본값은 직전 국내 기준가', async () => {
      const c = await newCandidate();
      world.set(c.id, 'owner.domesticPrice', 89000);
      await complete(c.id, 'SOURCING', 'PRICING');
      const api = t.app.get(StepEngineApi);
      expect(await api.ownerInputChanged(c.id, 'owner.domesticPrice')).toEqual([]);

      world.set(c.id, 'owner.domesticPrice', 95000);
      expect(await api.ownerInputChanged(c.id, 'owner.domesticPrice')).toEqual(['PRICING']);
      expect(await stepRow(c.id, 'PRICING')).toMatchObject({
        status: 'RERUN_REQUIRED',
        staleInputs: ['owner.domesticPrice'],
      });
      await complete(c.id, 'PRICING');
      const ctx = world.callsOf('PRICING').at(-1)!;
      expect(ctx.previous?.ownerInputs['owner.domesticPrice']).toBe(89000);
      expect((await stepRow(c.id, 'PRICING')).status).toBe('COMPLETED');
    });

    it('URL 후보 쿠폰(owner.coupon, 시작 조건)은 입력 대기 중에 바뀌면 재실행 필요로 닫는다', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING');
      world.script('PRICING', { kind: 'WAIT', pendingInputs: ['owner.domesticPrice'] });
      await complete(c.id, 'PRICING');
      const api = t.app.get(StepEngineApi);
      // 실행 중 오너 입력(국내 기준가)은 정상 입력이라 입력 대기를 닫지 않는다
      world.set(c.id, 'owner.domesticPrice', 90000);
      expect(await api.ownerInputChanged(c.id, 'owner.domesticPrice')).toEqual([]);
      expect((await stepRow(c.id, 'PRICING')).status).toBe('WAITING_INPUT');
      world.set(c.id, 'owner.coupon', 300);
      expect(await api.ownerInputChanged(c.id, 'owner.coupon')).toEqual(['PRICING']);
      expect(await stepRow(c.id, 'PRICING')).toMatchObject({
        status: 'RERUN_REQUIRED',
        staleInputs: ['owner.coupon'],
      });
    });

    it('입력 대기 이어 가기(resumeWaiting data)·끝내기(outcome)', async () => {
      const c = await newCandidate();
      world.script('SOURCING', { kind: 'WAIT' });
      await complete(c.id, 'SOURCING');
      const api = t.app.get(StepEngineApi);
      const id = (await stepRow(c.id, 'SOURCING')).currentStepRunId!;
      t.clock.advance(120_000);
      await api.resumeWaiting(id, { data: { anchor: 'picked' } });
      await idle();
      expect(world.callsOf('SOURCING').at(-1)?.resume).toEqual({ data: { anchor: 'picked' } });
      const run = await t.prisma.stepRun.findUniqueOrThrow({ where: { id } });
      expect(run).toMatchObject({ status: 'COMPLETED', waitSecondsTotal: 120, version: 1 });
      await expect(api.resumeWaiting(id, { data: null })).rejects.toMatchObject({
        code: 'STEP_RUN_NOT_WAITING_INPUT',
      });

      world.script('THUMBNAIL', { kind: 'WAIT' });
      await complete(c.id, 'THUMBNAIL');
      const thumb = (await stepRow(c.id, 'THUMBNAIL')).currentStepRunId!;
      await api.resumeWaiting(thumb, { outcome: { kind: 'COMPLETED', output: {} } });
      expect((await stepRow(c.id, 'THUMBNAIL')).status).toBe('COMPLETED');
      expect((await api.currentCompletedRun(c.id, 'THUMBNAIL'))?.id).toBe(thumb);
      expect(await api.currentCompletedRun(c.id, 'PRICING')).toBeNull();
    });
  });

  describe('재시작 정리(규칙 12, US-29 AC3)', () => {
    it('RUNNING 2건 → FAILED/INTERRUPTED, WAITING_INPUT은 그대로. 요청 전에 돈다(onApplicationBootstrap)', async () => {
      const a = await newCandidate();
      const b = await newCandidate();
      const runA = await insertStepRun(t.prisma, {
        candidateId: a.id,
        stepCode: 'SOURCING',
        status: 'RUNNING',
      });
      const runB = await insertStepRun(t.prisma, {
        candidateId: b.id,
        stepCode: 'SOURCING',
        status: 'RUNNING',
      });
      const waiting = await insertStepRun(t.prisma, {
        candidateId: a.id,
        stepCode: 'THUMBNAIL',
        status: 'WAITING_INPUT',
      });
      const result = await t.app.get(RestartRecoveryService).recover();
      expect(result.interruptedStepRunIds.sort()).toEqual([runA.id, runB.id].sort());
      for (const id of [runA.id, runB.id]) {
        const run = await t.prisma.stepRun.findUniqueOrThrow({ where: { id } });
        expect(run).toMatchObject({
          status: 'FAILED',
          failureKind: 'INTERRUPTED',
          errorCode: INTERRUPTED_ERROR.errorCode,
          errorMessage: INTERRUPTED_ERROR.errorMessage,
        });
        expect(run.endedAt).not.toBeNull();
      }
      expect((await stepRow(a.id, 'SOURCING')).status).toBe('FAILED');
      expect((await stepRow(b.id, 'SOURCING')).status).toBe('FAILED');
      expect((await t.prisma.stepRun.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe(
        'WAITING_INPUT',
      );
      expect((await stepRow(a.id, 'THUMBNAIL')).status).toBe('WAITING_INPUT');
      // 정리 뒤 다시 실행할 수 있다
      await complete(a.id, 'SOURCING');
    });

    it('⑨ 훅이 돌려준 RESULT_CHECK_REQUIRED/APP_RESTART·AWAITING_APPROVAL/RESTART_REVERTED가 이력에 그대로 남는다', async () => {
      const recovery = t.app.get(RestartRecoveryService);
      const steps = allRequiredCompleted();
      const c1 = (await createCandidate(t.prisma, { status: 'REGISTERING', steps })).candidate;
      const reg1 = await insertStepRun(t.prisma, {
        candidateId: c1.id,
        stepCode: 'REGISTER',
        status: 'RUNNING',
      });
      world.registerInterruptEffect = { toStatus: 'RESULT_CHECK_REQUIRED', reason: 'APP_RESTART' };
      await recovery.recover();
      expect(world.interruptedRuns).toEqual([reg1.id]);
      const h1 = await t.prisma.candidateStatusHistory.findMany({
        where: { candidateId: c1.id },
        orderBy: { id: 'asc' },
      });
      expect(h1.at(-1)).toMatchObject({
        fromStatus: 'REGISTERING',
        toStatus: 'RESULT_CHECK_REQUIRED',
        reason: 'APP_RESTART',
        stepRunId: reg1.id,
      });

      const c2 = (await createCandidate(t.prisma, { status: 'REGISTERING', steps })).candidate;
      const reg2 = await insertStepRun(t.prisma, {
        candidateId: c2.id,
        stepCode: 'REGISTER',
        status: 'RUNNING',
      });
      world.registerInterruptEffect = { toStatus: 'AWAITING_APPROVAL', reason: 'RESTART_REVERTED' };
      await recovery.recover();
      const h2 = await t.prisma.candidateStatusHistory.findMany({
        where: { candidateId: c2.id },
        orderBy: { id: 'asc' },
      });
      expect(h2.at(-1)).toMatchObject({
        toStatus: 'AWAITING_APPROVAL',
        reason: 'RESTART_REVERTED',
        stepRunId: reg2.id,
      });
      expect((await t.prisma.candidate.findUniqueOrThrow({ where: { id: c2.id } })).status).toBe(
        'AWAITING_APPROVAL',
      );
      expect((await stepRow(c2.id, 'REGISTER')).status).toBe('FAILED');
    });
  });

  describe('단일 진입점·시작 트랜잭션·버전(규칙 1·3·8·11·13·15)', () => {
    it('연속 실행(P1-06)도 같은 진입점: mode=CHAIN이면 execution_mode CHAIN + step_chain_id', async () => {
      const c = await newCandidate();
      const chain = await t.prisma.stepChain.create({
        data: { candidateId: c.id, kind: 'FROM_HERE', startStepCode: 'SOURCING' },
      });
      const result = await t.app
        .get(StepExecutionService)
        .start(c.id, 'SOURCING', { mode: 'CHAIN', stepChainId: chain.id });
      await idle();
      expect(result.run).toMatchObject({
        executionMode: 'CHAIN',
        stepChainId: chain.id,
        version: 1,
      });
      expect((await stepRow(c.id, 'SOURCING')).status).toBe('COMPLETED');
    });

    it('시작 트랜잭션에서 포인터를 옮기고(RUNNING·사유 비움), 실패하면 현재 버전은 실패한 실행이라 뒷단계가 읽지 못한다', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING', 'COPY', 'NOTICE_RAW');
      world.set(c.id, 'sourcing.itemText', '다른 설명');
      await complete(c.id, 'SOURCING');
      expect((await stepRow(c.id, 'COPY')).status).toBe('RERUN_REQUIRED');
      world.script('COPY', { kind: 'HOLD', then: { kind: 'FAIL', failureKind: 'AI' } });
      const res = await runStep(c.id, 'COPY');
      const id = (res.body as { stepRunId: number }).stepRunId;
      expect(await stepRow(c.id, 'COPY')).toMatchObject({
        status: 'RUNNING',
        currentStepRunId: id,
        staleInputs: [],
        staleSince: null,
        lastVersion: 2,
      });
      world.release('COPY');
      await idle();
      expect(await stepRow(c.id, 'COPY')).toMatchObject({ status: 'FAILED', currentStepRunId: id });
      const blocked = await runStep(c.id, 'NOTICE_HTML');
      expect(blocked.status).toBe(409);
      expect(
        (blocked.body as { fieldErrors: { field: string }[] }).fieldErrors.map((f) => f.field),
      ).toEqual(['copy.draft']);
    });

    it('다시 실행은 입력이 같아도 새 버전·실행기를 다시 부른다(결과 캐시 없음). 직전 완료 버전 id를 넘긴다', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'COPY');
      const v1 = (await stepRow(c.id, 'COPY')).currentStepRunId!;
      await complete(c.id, 'COPY');
      const calls = world.callsOf('COPY');
      expect(calls).toHaveLength(2);
      expect(calls[0]!.previous).toBeNull();
      expect(calls[1]!.previous?.stepRunId).toBe(v1);
      expect(calls[1]!.version).toBe(2);
      const runs = await t.prisma.stepRun.findMany({
        where: { candidateId: c.id, stepCode: 'COPY' },
        orderBy: { version: 'asc' },
      });
      expect(runs.map((r) => r.version)).toEqual([1, 2]);
      expect(runs[0]!.inputFingerprintStart).toBe(runs[1]!.inputFingerprintStart);
      // 입력 출처: PREV_STEP은 읽은 앞 단계 버전을 남긴다(ck_step_run_input_prev)
      const inputs = await t.prisma.stepRunInput.findMany({ where: { stepRunId: runs[1]!.id } });
      const sourcing = (await stepRow(c.id, 'SOURCING')).currentStepRunId;
      expect(inputs.find((i) => i.inputKey === 'sourcing.itemText')).toMatchObject({
        sourceType: 'PREV_STEP',
        sourceStepRunId: sourcing,
        isStartCondition: true,
      });
    });

    it('URL로 만든 후보는 ② 뒤 원하는 단계를 바로 실행할 수 있다(⑤를 ③ 없이)', async () => {
      const c = await newCandidate({ creationPath: 'RAKUTEN_URL' });
      await complete(c.id, 'SOURCING');
      const res = await runStep(c.id, 'THUMBNAIL');
      expect(res.status).toBe(202);
      await idle();
      expect((await stepRow(c.id, 'THUMBNAIL')).status).toBe('COMPLETED');
    });
  });

  describe('시간(규칙 13)·DB 유일 제약', () => {
    it('started_at·ended_at·wait_seconds_total을 남긴다(FakeClock)', async () => {
      const c = await newCandidate();
      world.script('SOURCING', { kind: 'WAIT' });
      await complete(c.id, 'SOURCING');
      const id = (await stepRow(c.id, 'SOURCING')).currentStepRunId!;
      t.clock.advance(120_000);
      await t.app
        .get(StepEngineApi)
        .resumeWaiting(id, { outcome: { kind: 'COMPLETED', output: {} } });
      const run = await t.prisma.stepRun.findUniqueOrThrow({ where: { id } });
      expect(run.startedAt.toISOString()).toBe(new Date(TEST_START_MS).toISOString());
      expect(run.endedAt?.toISOString()).toBe(new Date(TEST_START_MS + 120_000).toISOString());
      expect(run.waitSecondsTotal).toBe(120);
    });

    it('uq_step_run_one_open 위반을 STEP_ALREADY_RUNNING으로 바꿀 수 있게 알아본다', async () => {
      const c = await newCandidate();
      await insertStepRun(t.prisma, {
        candidateId: c.id,
        stepCode: 'SOURCING',
        status: 'WAITING_INPUT',
      });
      const error = await insertStepRun(t.prisma, {
        candidateId: c.id,
        stepCode: 'SOURCING',
        status: 'RUNNING',
        makeCurrent: false,
      }).catch((e: unknown) => e);
      expect(isOneOpenRunViolation(error)).toBe(true);
    });
  });

  describe('설정 변경 전파(settings.reloaded changedKeys)', () => {
    it('바뀐 설정 키를 읽은 단계만 재실행 필요, 잠긴 후보는 건너뛰고 rerunRequiredStepCount로 알린다', async () => {
      const c = await newCandidate();
      await complete(c.id, 'SOURCING', 'PRICING', 'COPY');
      const locked = (
        await createCandidate(t.prisma, { status: 'REGISTERING', steps: allRequiredCompleted() })
      ).candidate;
      await t.prisma.stepRunInput.create({
        data: {
          stepRunId: (await stepRow(locked.id, 'PRICING')).currentStepRunId!,
          inputKey: 'settings.costs',
          sourceType: 'SETTINGS',
          isStartCondition: true,
          valueHash: 'f'.repeat(64),
        },
      });

      const file = settingsFilePath(DATA_DIR);
      const original = readFileSync(file, 'utf8');
      const next = JSON.parse(original) as AppSettings;
      next.costs.targetMarginPct = next.costs.targetMarginPct + 1;
      await writeSettingsFileAtomically(DATA_DIR, next);
      try {
        const res = await post('/settings-snapshots');
        expect([200, 201]).toContain(res.status);
        const body = res.body as { changedKeys: string[]; rerunRequiredStepCount: number };
        expect(body.changedKeys).toEqual(['costs.targetMarginPct']);
        expect(body.rerunRequiredStepCount).toBe(1);
        expect(await stepRow(c.id, 'PRICING')).toMatchObject({
          status: 'RERUN_REQUIRED',
          staleInputs: ['settings.costs'],
        });
        expect((await statuses(c.id)).SOURCING).toBe('COMPLETED');
        expect((await statuses(c.id)).COPY).toBe('COMPLETED');
        expect((await stepRow(locked.id, 'PRICING')).status).toBe('COMPLETED');
        // SSE: settings.reloaded 뒤에 candidate-step.changed
        const names = events.map((e) => e.name);
        const reloadedAt = names.indexOf('settings.reloaded');
        const changedAt = names.findIndex(
          (n, i) => n === 'candidate-step.changed' && i > reloadedAt,
        );
        expect(reloadedAt).toBeGreaterThanOrEqual(0);
        expect(changedAt).toBeGreaterThan(reloadedAt);
      } finally {
        await writeSettingsFileAtomically(DATA_DIR, original);
        await post('/settings-snapshots');
      }
    });
  });
});

describe('앱 시작: 재시작 정리는 요청 전에 · 실행기가 없는 단계(P1-05 Proposed)', () => {
  let t: TestApp;
  let interruptedId = 0;

  beforeAll(async () => {
    // 앱을 켜기 전에 '실행중'으로 남은 실행을 만든다(앱이 꺼졌던 상황)
    t = await createTestApp({
      beforeInit: async (prisma) => {
        await truncateStepEngine(prisma);
        const c = (await createCandidate(prisma, { gender: 'MALE' })).candidate;
        interruptedId = (
          await insertStepRun(prisma, {
            candidateId: c.id,
            stepCode: 'SOURCING',
            status: 'RUNNING',
          })
        ).id;
      },
    });
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('앱이 켜질 때(요청을 받기 전) 실행중 → 실패(중단됨)', async () => {
    const run = await t.prisma.stepRun.findUniqueOrThrow({ where: { id: interruptedId } });
    expect(run).toMatchObject({ status: 'FAILED', failureKind: 'INTERRUPTED' });
    const detail = await request(t.app.getHttpServer()).get(`/api/v1/step-runs/${interruptedId}`);
    expect(detail.body).toMatchObject({
      status: 'FAILED',
      failureKind: 'INTERRUPTED',
      isCurrent: true,
    });
  });

  // ②(P2-02)·③(P2-05)·④(P2-06)·⑤(P3-01)·⑥-1·⑥-2(P3-03)·⑥-3(P3-04)는 운영 실행기가 있다. 아직 실행기가 없는 ⑦ TAGS(P3-05)로 본다
  it('실행 요청은 422 INVALID_STEP_CODE(NO_RUNNER), 레일 run도 같은 코드로 꺼진다', async () => {
    await truncateStepEngine(t.prisma);
    const c = (await createCandidate(t.prisma, { gender: 'MALE' })).candidate;
    const res = await request(t.app.getHttpServer())
      .post(`/api/v1/candidates/${c.id}/steps/TAGS/runs`)
      .set('X-AutoStore-Client', '1');
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: 'INVALID_STEP_CODE',
      details: { stepCode: 'TAGS', reason: 'NO_RUNNER' },
    });
    const rail = await request(t.app.getHttpServer()).get(`/api/v1/candidates/${c.id}/steps`);
    const items = (
      rail.body as {
        items: { actions: { run: { disabledReason: { code: string; message: string } } } }[];
      }
    ).items;
    expect(items[7]!.actions.run.disabledReason).toMatchObject({
      code: 'INVALID_STEP_CODE',
      message: (res.body as { message: string }).message,
    });
  });
});
