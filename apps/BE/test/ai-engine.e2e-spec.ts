import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../src/common/events/progress-events.service.js';
import { AiEngineUnavailableError } from '../src/modules/integrations/ai-engine/ai-engine.errors.js';
import { DEFAULT_SETTINGS } from '../src/modules/settings/defaults/default-settings.js';
import type { AppSettings } from '../src/modules/settings/schema/settings.types.js';
import { writeSettingsFileAtomically } from '../src/modules/settings/settings-file.loader.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import { StepExecutor } from '../src/modules/step-engine/execution/step-executor.js';
import { StepEngineApi } from '../src/modules/step-engine/step-engine.api.js';
import { AiEngineStartupCheck } from '../src/modules/system/ai-cli-checks/ai-engine-startup.check.js';
import { AiEngineAvailabilityService } from '../src/modules/system/ai-cli-checks/ai-engine-availability.service.js';
import { createCandidate } from './fixtures/step-engine/candidate.factory.js';
import { FakeStepWorld } from './fixtures/step-engine/fake-runners.js';
import { truncateStepEngine } from './fixtures/step-engine/truncate.js';
import { createTestApp, TEST_START_MS, truncate, type TestApp } from './helpers/test-app.js';
import { seedAiCliCheck, seedUsableAiEngine } from './support/fake-ai-engines.js';
import { FakeAiStepRunnersModule, FakeAiStepWorld } from './support/fake-ai-step-runners.js';

interface ErrorBody {
  code: string;
  message: string;
  status: number;
  details?: Record<string, unknown>;
}

interface AcceptedBody {
  stepRunId: number;
  aiEngine: string | null;
  aiModel: string | null;
  aiCliVersion: string | null;
}

const DATA_DIR = process.env.APP_DATA_DIR!;

/**
 * AI 실행기(P1-10) e2e — autostore_test·가짜 어댑터(AI_ENGINE_ADAPTERS)·가짜 AI 단계 실행기(② SOURCING = AI 텍스트,
 * ③ PRICING = AI 없음). 진짜 CLI를 부르지 않는다. 앱 시작 점검은 켜서(가짜 어댑터로) 부팅 때 도는 것을 본다.
 */
describe('AI 실행기·엔진 고정·시작 거절(P1-10) e2e', () => {
  let t: TestApp;
  let world: FakeStepWorld;
  let aiWorld: FakeAiStepWorld;
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;

  const http = () => request(t.app.getHttpServer());
  const post = (path: string, body?: object) => {
    const req = http().post(`/api/v1${path}`).set('X-AutoStore-Client', '1');
    return body ? req.send(body) : req;
  };
  const idle = () => t.app.get(StepExecutor).whenIdle();
  const runStep = (candidateId: number, stepCode: string) =>
    post(`/candidates/${candidateId}/steps/${stepCode}/runs`);
  const newCandidate = async () => (await createCandidate(t.prisma, { gender: 'MALE' })).candidate;
  const stepRunCount = () => t.prisma.stepRun.count();
  const useSettings = async (settings: AppSettings) => {
    await writeSettingsFileAtomically(DATA_DIR, settings);
    await t.app.get(SettingsService).reload();
  };

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FakeAiStepRunnersModule],
      aiStartupCheck: true,
      beforeInit: async (prisma, moduleRef) => {
        await truncateStepEngine(prisma);
        await truncate(prisma, ['ai_cli_check', 'call_log']);
        // 부팅 때 도는 시작 점검의 SSE를 놓치지 않게 앱을 켜기 전에 구독한다
        const sub = moduleRef
          .get(ProgressEventsService)
          .stream()
          .subscribe((e) => events.push(e));
        unsubscribe = () => sub.unsubscribe();
      },
    });
    world = t.app.get(FakeStepWorld);
    aiWorld = t.app.get(FakeAiStepWorld);
    await t.app.get(AiEngineStartupCheck).whenDone();
  });

  afterAll(async () => {
    aiWorld.release();
    await idle();
    unsubscribe();
    await t.app.close();
  });

  describe('규칙 13: 앱 시작 점검', () => {
    it('선택 엔진 CLAUDE·codex 미설치 → ai_cli_check 3행(STARTUP), CLAUDE만 연결 테스트, SSE 3건(binPath 없음)', async () => {
      const rows = await t.prisma.aiCliCheck.findMany({ orderBy: { id: 'asc' } });
      expect(rows.map((r) => r.engineCode)).toEqual(['CLAUDE', 'AGY', 'CODEX']);
      expect(rows.every((r) => r.trigger === 'STARTUP')).toBe(true);
      expect(rows[0]).toMatchObject({
        installed: true,
        cliVersion: '2.1.269',
        authStatus: 'OK',
        smokeStatus: 'PASSED',
        model: 'sonnet',
        latencyMs: 1200,
        errorCode: null,
      });
      expect(rows[1]).toMatchObject({
        installed: true,
        cliVersion: '1.2.9',
        authStatus: 'UNKNOWN',
        smokeStatus: 'SKIPPED',
        model: null,
        latencyMs: null,
      });
      expect(rows[2]).toMatchObject({
        installed: false,
        binPath: null,
        cliVersion: null,
        smokeStatus: 'SKIPPED',
        model: null,
        latencyMs: null,
        errorCode: 'NOT_INSTALLED',
      });

      const completed = events.filter((e) => e.name === 'ai-cli-check.completed');
      expect(completed.map((e) => (e.data as { engineCode: string }).engineCode)).toEqual([
        'CLAUDE',
        'AGY',
        'CODEX',
      ]);
      for (const e of completed) {
        expect(Object.keys(e.data as object).sort()).toEqual(
          [
            'authStatus',
            'cliVersion',
            'engineCode',
            'errorCode',
            'installed',
            'latencyMs',
            'smokeStatus',
          ].sort(),
        );
      }
      expect(t.ai.claude.calls.smokeTest).toEqual(['sonnet']);
      expect(t.ai.agy.calls.smokeTest).toHaveLength(0);
      expect(t.ai.codex.calls.smokeTest).toHaveLength(0);
      // 연결 테스트 1회 = call_log 1행(규칙 15)
      const logs = await t.prisma.callLog.findMany();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ target: 'AI_CLAUDE_CLI', succeeded: true, stepRunId: null });
    });
  });

  describe('단계 시작·실행', () => {
    beforeEach(async () => {
      aiWorld.release();
      await idle();
      await truncateStepEngine(t.prisma);
      await truncate(t.prisma, ['ai_cli_check', 'call_log']);
      world.reset();
      aiWorld.reset();
      t.ai.resetCalls();
      t.ai.claude.runImpl = () => ({ match: true, reason: null });
      t.clock.ms = TEST_START_MS;
      events.length = 0;
    });

    it.each([
      ['installed=false', { installed: false, smokeStatus: 'SKIPPED' as const }, 'NOT_INSTALLED'],
      [
        'smoke_status=FAILED',
        { smokeStatus: 'FAILED' as const, errorCode: 'CONTRACT_FAILED' },
        'CONTRACT_FAILED',
      ],
      [
        'auth_status=NOT_LOGGED_IN',
        { authStatus: 'NOT_LOGGED_IN' as const, smokeStatus: 'SKIPPED' as const },
        'NOT_LOGGED_IN',
      ],
    ])(
      '규칙 11: 최신 CLAUDE 행 %s → 409 AI_ENGINE_UNAVAILABLE(%s), step_run 0행',
      async (_name, seed, reason) => {
        await seedAiCliCheck(t.prisma, { checkedAt: new Date('2026-09-27T00:00:00Z') });
        await seedAiCliCheck(t.prisma, seed);
        const c = await newCandidate();
        const res = await runStep(c.id, 'SOURCING');
        expect(res.status).toBe(409);
        const body = res.body as ErrorBody;
        expect(body.code).toBe('AI_ENGINE_UNAVAILABLE');
        expect(body.details).toEqual({
          engineCode: 'CLAUDE',
          reason,
          settingsPath: '/settings/ai-engine',
        });
        expect(body.message).toMatch(/^선택한 AI 엔진\(Claude Code\)을 지금 쓸 수 없습니다/);
        expect(await stepRunCount()).toBe(0);
        expect(t.ai.totalRuns()).toBe(0);
      },
    );

    it('규칙 11(Proposed): 선택 엔진 점검 행이 없으면 409 NOT_CHECKED', async () => {
      const c = await newCandidate();
      const res = await runStep(c.id, 'SOURCING');
      expect(res.status).toBe(409);
      expect((res.body as ErrorBody).details).toMatchObject({ reason: 'NOT_CHECKED' });
      expect(await stepRunCount()).toBe(0);
    });

    it('규칙 10·15: 쓸 수 있으면 202 + step_run.ai_*(CLAUDE·sonnet·2.1.269), 실행 문맥 pinnedAi, call_log 1행', async () => {
      await seedUsableAiEngine(t.prisma);
      const c = await newCandidate();
      const res = await runStep(c.id, 'SOURCING');
      expect(res.status).toBe(202);
      const body = res.body as AcceptedBody;
      expect(body).toMatchObject({
        aiEngine: 'CLAUDE',
        aiModel: 'sonnet',
        aiCliVersion: '2.1.269',
      });
      await idle();

      const run = await t.prisma.stepRun.findUniqueOrThrow({ where: { id: body.stepRunId } });
      expect(run).toMatchObject({
        status: 'COMPLETED',
        aiEngine: 'CLAUDE',
        aiModel: 'sonnet',
        aiCliVersion: '2.1.269',
      });
      expect(aiWorld.contexts[0]!.pinnedAi).toEqual({
        engine: 'CLAUDE',
        textModel: 'sonnet',
        visionModel: 'sonnet',
        cliVersion: '2.1.269',
        settingsSnapshotId: run.settingsSnapshotId,
        stepRunId: run.id,
        candidateId: c.id,
      });
      expect(aiWorld.results[0]).toMatchObject({ output: { match: true, reason: null } });

      const logs = await t.prisma.callLog.findMany({ where: { stepRunId: run.id } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        target: 'AI_CLAUDE_CLI',
        candidateId: c.id,
        succeeded: true,
        httpMethod: null,
        host: null,
        urlMasked: null,
        errorCode: null,
        errorMessage: null,
      });
      expect(logs[0]!.durationMs).not.toBeNull();
    });

    it('규칙 10: AI를 쓰지 않는 단계는 ai_* 셋 다 NULL, 사용 가능 판정을 부르지 않는다', async () => {
      await seedUsableAiEngine(t.prisma);
      const c = await newCandidate();
      expect((await runStep(c.id, 'SOURCING')).status).toBe(202);
      await idle();
      // ESM Jest라 jest.spyOn 대신 메서드를 감싸 센다
      const availability = t.app.get(AiEngineAvailabilityService);
      const original = availability.assertUsable.bind(availability);
      let calls = 0;
      availability.assertUsable = (engine) => {
        calls += 1;
        return original(engine);
      };
      try {
        const res = await runStep(c.id, 'PRICING');
        expect(res.status).toBe(202);
        expect(res.body).toMatchObject({ aiEngine: null, aiModel: null, aiCliVersion: null });
        await idle();
        expect(calls).toBe(0);
        const run = await t.prisma.stepRun.findUniqueOrThrow({
          where: { id: (res.body as AcceptedBody).stepRunId },
        });
        expect([run.aiEngine, run.aiModel, run.aiCliVersion]).toEqual([null, null, null]);
      } finally {
        availability.assertUsable = original;
      }
    });

    it('규칙 10: 열린(RUNNING) 실행의 ai_model을 바꾸려 하면 DB가 막는다(trg_step_run_append_only)', async () => {
      await seedUsableAiEngine(t.prisma);
      const c = await newCandidate();
      aiWorld.holdNext();
      const held = aiWorld.whenHeld();
      const res = await runStep(c.id, 'SOURCING');
      expect(res.status).toBe(202);
      await held;
      const id = (res.body as AcceptedBody).stepRunId;
      await expect(
        t.prisma.$executeRawUnsafe(`UPDATE step_run SET ai_model = 'opus' WHERE id = ${id}`),
      ).rejects.toThrow(/AI engine columns are fixed at start/);
      aiWorld.release();
      await idle();
      expect((await t.prisma.stepRun.findUniqueOrThrow({ where: { id } })).aiModel).toBe('sonnet');
    });

    it('규칙 10(R9): 실행 중 설정을 AGY로 바꿔도 진행 중 실행은 CLAUDE 어댑터로만 부르고 CLAUDE로 남는다', async () => {
      await seedUsableAiEngine(t.prisma);
      await seedAiCliCheck(t.prisma, { engineCode: 'AGY', model: 'gemini-3.8-flash-medium' });
      const c = await newCandidate();
      aiWorld.holdNext();
      const held = aiWorld.whenHeld();
      const res = await runStep(c.id, 'SOURCING');
      expect(res.status).toBe(202);
      await held;
      try {
        await useSettings({
          ...DEFAULT_SETTINGS,
          ai: {
            engine: 'AGY',
            models: {
              ...DEFAULT_SETTINGS.ai.models,
              AGY: { text: 'gemini-3.8-flash-medium', vision: 'gemini-3.8-flash-high' },
            },
          },
        });
        expect(t.app.get(SettingsService).current().ai.engine).toBe('AGY');
        aiWorld.release();
        await idle();
        expect(t.ai.claude.calls.runStructured).toHaveLength(1);
        expect(t.ai.agy.calls.runStructured).toHaveLength(0);
        const run = await t.prisma.stepRun.findUniqueOrThrow({
          where: { id: (res.body as AcceptedBody).stepRunId },
        });
        expect(run).toMatchObject({ status: 'COMPLETED', aiEngine: 'CLAUDE', aiModel: 'sonnet' });

        // 새로 시작하는 AI 단계부터 새 엔진(R9)
        const next = await runStep(c.id, 'SOURCING');
        expect(next.status).toBe(202);
        expect(next.body).toMatchObject({
          aiEngine: 'AGY',
          aiModel: 'gemini-3.8-flash-medium',
          aiCliVersion: '1.2.9',
        });
        await idle();
        expect(t.ai.agy.calls.runStructured).toHaveLength(1);
      } finally {
        aiWorld.release();
        await idle();
        await useSettings(DEFAULT_SETTINGS);
      }
    });

    it('규칙 10(R9): 입력 대기에서 이어 가도 시작 때 고정한 엔진·모델로 부른다(그사이 설정이 AGY로 바뀌어도)', async () => {
      await seedUsableAiEngine(t.prisma);
      await seedAiCliCheck(t.prisma, { engineCode: 'AGY', model: 'gemini-3.8-flash-medium' });
      world.script('SOURCING', { kind: 'WAIT', waitingReasonCode: 'AWAIT_SELECTION' });
      const c = await newCandidate();
      const res = await runStep(c.id, 'SOURCING');
      await idle();
      const id = (res.body as AcceptedBody).stepRunId;
      expect((await t.prisma.stepRun.findUniqueOrThrow({ where: { id } })).status).toBe(
        'WAITING_INPUT',
      );
      try {
        await useSettings({
          ...DEFAULT_SETTINGS,
          ai: {
            engine: 'AGY',
            models: {
              ...DEFAULT_SETTINGS.ai.models,
              AGY: { text: 'gemini-3.8-flash-medium', vision: 'gemini-3.8-flash-high' },
            },
          },
        });
        await t.app.get(StepEngineApi).resumeWaiting(id, { data: { selected: 1 } });
        await idle();
        expect(t.ai.claude.calls.runStructured.map((call) => call.model)).toEqual([
          'sonnet',
          'sonnet',
        ]);
        expect(t.ai.agy.calls.runStructured).toHaveLength(0);
        expect(aiWorld.contexts[1]!.pinnedAi).toMatchObject({
          engine: 'CLAUDE',
          textModel: 'sonnet',
          visionModel: 'sonnet',
          cliVersion: '2.1.269',
          stepRunId: id,
        });
        expect(await t.prisma.stepRun.findUniqueOrThrow({ where: { id } })).toMatchObject({
          status: 'COMPLETED',
          aiEngine: 'CLAUDE',
        });
      } finally {
        await useSettings(DEFAULT_SETTINGS);
      }
    });

    it('규칙 11(Proposed): 선택 엔진의 주 작업 모델이 설정에 없으면 409 MODEL_NOT_SET', async () => {
      await seedAiCliCheck(t.prisma, { engineCode: 'CODEX', model: 'gpt-5' });
      try {
        await useSettings({ ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, engine: 'CODEX' } });
        const c = await newCandidate();
        const res = await runStep(c.id, 'SOURCING');
        expect(res.status).toBe(409);
        expect((res.body as ErrorBody).details).toEqual({
          engineCode: 'CODEX',
          reason: 'MODEL_NOT_SET',
          settingsPath: '/settings/ai-engine',
        });
        expect(await stepRunCount()).toBe(0);
      } finally {
        await useSettings(DEFAULT_SETTINGS);
      }
    });

    it('규칙 12: 실행 중 어댑터가 ENOENT(NOT_INSTALLED) → FAILED·AI·AI_ENGINE_UNAVAILABLE, 다른 어댑터 0회, SSE', async () => {
      await seedUsableAiEngine(t.prisma);
      t.ai.claude.runImpl = () => {
        throw new AiEngineUnavailableError('CLAUDE', 'NOT_INSTALLED');
      };
      const c = await newCandidate();
      const res = await runStep(c.id, 'SOURCING');
      expect(res.status).toBe(202);
      await idle();
      const id = (res.body as AcceptedBody).stepRunId;
      const run = await t.prisma.stepRun.findUniqueOrThrow({ where: { id } });
      expect(run).toMatchObject({
        status: 'FAILED',
        failureKind: 'AI',
        errorCode: 'AI_ENGINE_UNAVAILABLE',
        aiEngine: 'CLAUDE',
      });
      expect(run.errorMessage).toMatch(/Claude Code.*설치되지 않음/);
      expect(t.ai.claude.calls.runStructured).toHaveLength(1);
      expect(t.ai.agy.calls.runStructured).toHaveLength(0);
      expect(t.ai.codex.calls.runStructured).toHaveLength(0);
      const failed = events.filter(
        (e) =>
          e.name === 'step-run.status-changed' &&
          (e.data as { stepRunId: number; status: string }).stepRunId === id &&
          (e.data as { status: string }).status === 'FAILED',
      );
      expect(failed).toHaveLength(1);
      expect(failed[0]!.data).toMatchObject({
        failureKind: 'AI',
        errorCode: 'AI_ENGINE_UNAVAILABLE',
      });
      const logs = await t.prisma.callLog.findMany({ where: { stepRunId: id } });
      expect(logs).toEqual([
        expect.objectContaining({
          target: 'AI_CLAUDE_CLI',
          succeeded: false,
          errorCode: 'AI_ENGINE_UNAVAILABLE',
        }),
      ]);
    });

    it('AI 결과가 스키마와 다르면 FAILED·AI·AI_OUTPUT_INVALID(재검증, 규칙 8)', async () => {
      await seedUsableAiEngine(t.prisma);
      t.ai.claude.runImpl = () => ({ match: 'yes', reason: null });
      const c = await newCandidate();
      const res = await runStep(c.id, 'SOURCING');
      await idle();
      const run = await t.prisma.stepRun.findUniqueOrThrow({
        where: { id: (res.body as AcceptedBody).stepRunId },
      });
      expect(run).toMatchObject({
        status: 'FAILED',
        failureKind: 'AI',
        errorCode: 'AI_OUTPUT_INVALID',
      });
    });

    it('규칙 11: AI 단계가 든 연속 실행 시작, 엔진 미설치 → 409 AI_ENGINE_UNAVAILABLE, step_chain 0행', async () => {
      await seedAiCliCheck(t.prisma, { installed: false, smokeStatus: 'SKIPPED' });
      const c = await newCandidate();
      const res = await post(`/candidates/${c.id}/continuous-runs`, {
        kind: 'FROM_HERE',
        startStepCode: 'SOURCING',
      });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'AI_ENGINE_UNAVAILABLE',
        details: {
          engineCode: 'CLAUDE',
          reason: 'NOT_INSTALLED',
          settingsPath: '/settings/ai-engine',
        },
      });
      expect(await t.prisma.stepChain.count()).toBe(0);
      expect(await stepRunCount()).toBe(0);
    });

    it('잠긴·제외 후보처럼 다른 이유로 막히면 그 이유가 먼저다(AI 판정은 시작 검사 뒤)', async () => {
      await seedAiCliCheck(t.prisma, { installed: false, smokeStatus: 'SKIPPED' });
      const c = (
        await createCandidate(t.prisma, {
          gender: 'MALE',
          status: 'EXCLUDED',
          excludedReason: 'OWNER_EXCLUDED',
        })
      ).candidate;
      const res = await runStep(c.id, 'SOURCING');
      expect(res.status).toBe(409);
      expect((res.body as ErrorBody).code).toBe('CANDIDATE_EXCLUDED');
    });
  });
});
