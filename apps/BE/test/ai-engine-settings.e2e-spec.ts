import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../src/common/events/progress-events.service.js';
import { DEFAULT_SETTINGS } from '../src/modules/settings/defaults/default-settings.js';
import type { AiSettings, AppSettings } from '../src/modules/settings/schema/settings.types.js';
import {
  settingsFilePath,
  writeSettingsFileAtomically,
} from '../src/modules/settings/settings-file.loader.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import { AiCliChecksService } from '../src/modules/system/ai-cli-checks/ai-cli-checks.service.js';
import { createCandidate } from './fixtures/step-engine/candidate.factory.js';
import { truncateStepEngine } from './fixtures/step-engine/truncate.js';
import { createTestApp, type TestApp, truncate } from './helpers/test-app.js';
import { agyModelsFixture, seedAiCliCheck } from './support/fake-ai-engines.js';

const DATA_DIR = process.env.APP_DATA_DIR!;
const AI_FIXTURES = join(import.meta.dirname, 'fixtures', 'settings', 'ai-section');
const aiFixture = (name: string): AiSettings =>
  JSON.parse(readFileSync(join(AI_FIXTURES, name), 'utf8')) as AiSettings;

interface ErrorBody {
  code: string;
  message: string;
  status: number;
  fieldErrors?: { field: string; message: string }[];
  details?: Record<string, unknown>;
}

interface EngineOption {
  engineCode: string;
  displayName: string;
  binName: string;
  modelOptions: string[];
  allowCustomModel: boolean;
  defaultModels: { text: string | null; vision: string | null };
  loginCommand: string;
  termsNote: string;
  experimental: boolean;
}

interface AiEngineSettingsBody {
  selectedEngine: string;
  models: AiSettings['models'];
  engines: EngineOption[];
  settingsSnapshotId: number;
  updatedAt: string;
}

interface CheckRow {
  engineCode: string;
  trigger: string;
  installed: boolean;
  binPath: string | null;
  smokeStatus: string;
  model: string | null;
  latencyMs: number | null;
  checkedAt: string;
}

const AGY_TEXT = 'gemini-3.8-flash-medium';

/** 기본 템플릿 모델 + AGY 기본 모델(화면이 보내는 모양) */
function modelsWith(patch: Partial<AiSettings['models']> = {}): AiSettings['models'] {
  return {
    CLAUDE: { text: 'sonnet', vision: 'sonnet' },
    AGY: { text: AGY_TEXT, vision: 'gemini-3.8-flash-high' },
    CODEX: { text: null, vision: null },
    ...patch,
  };
}

/**
 * P1-11 AI 엔진 설정(GET·PUT /settings/ai-engine)·AI CLI 점검(POST /ai-cli-checks, GET /ai-cli-checks[/latest]) e2e —
 * autostore_test·가짜 어댑터(기본: CLAUDE 설치·로그인, AGY 설치·UNKNOWN·모델 목록 fixture, CODEX 미설치). 진짜 CLI를 부르지 않는다.
 */
describe('AI 엔진 설정·AI CLI 점검(P1-11) e2e', () => {
  let t: TestApp;
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;

  const http = () => request(t.app.getHttpServer());
  const put = (body: object) =>
    http().put('/api/v1/settings/ai-engine').set('X-AutoStore-Client', '1').send(body);
  const postCheck = (body: object) =>
    http().post('/api/v1/ai-cli-checks').set('X-AutoStore-Client', '1').send(body);
  const idle = () => t.app.get(AiCliChecksService).whenIdle();
  const settingsService = () => t.app.get(SettingsService);
  const useAi = async (ai: AiSettings) => {
    await writeSettingsFileAtomically(DATA_DIR, { ...(DEFAULT_SETTINGS as AppSettings), ai });
    await settingsService().reload();
  };
  const fileAi = () =>
    (JSON.parse(readFileSync(settingsFilePath(DATA_DIR), 'utf8')) as AppSettings).ai;
  const eventsNamed = (name: string) => events.filter((e) => e.name === name);
  /** 연결 테스트 PASSED 1행을 API로 만든다(가짜 어댑터) */
  const passSmoke = async (engine: 'CLAUDE' | 'AGY', model: string) => {
    await postCheck({
      engineCodes: [engine],
      smokeTest: true,
      models: { [engine]: model },
      trigger: 'BEFORE_SAVE',
    }).expect(202);
    await idle();
  };

  beforeAll(async () => {
    t = await createTestApp({
      beforeInit: async (prisma) => {
        await truncateStepEngine(prisma);
        // settings_snapshot도 비운다: 다른 스위트(P1-10 ai-engine 등)가 남긴 같은 내용(AGY 선택 등)의 스냅샷이 있으면
        // P1-03 내용 해시 중복 제거로 새 행이 생기지 않아 '스냅샷 +1'이 실행 순서에 따라 흔들린다
        await truncate(prisma, ['settings_snapshot', 'ai_cli_check', 'call_log']);
      },
    });
    const sub = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
  });

  beforeEach(async () => {
    await truncate(t.prisma, ['ai_cli_check', 'call_log', 'user_action_log']);
    await useAi(aiFixture('default.json'));
    t.ai.resetCalls();
    t.ai.claude.smokeGate = null;
    events.length = 0;
  });

  afterAll(async () => {
    unsubscribe();
    await t.app.close();
  });

  describe('GET /settings/ai-engine(규칙 1·2)', () => {
    it('설정 ai 섹션 + 엔진 안내 3개(CLAUDE·AGY·CODEX), 현재 스냅샷 id·읽은 시각. 설치 상태는 넣지 않는다', async () => {
      const res = await http().get('/api/v1/settings/ai-engine').expect(200);
      const body = res.body as AiEngineSettingsBody;
      expect(Object.keys(body).sort()).toEqual(
        ['engines', 'models', 'selectedEngine', 'settingsSnapshotId', 'updatedAt'].sort(),
      );
      expect(body.selectedEngine).toBe('CLAUDE');
      expect(body.models).toEqual(aiFixture('default.json').models);
      expect(body.engines.map((e) => e.engineCode)).toEqual(['CLAUDE', 'AGY', 'CODEX']);
      const [claude, agy, codex] = body.engines;
      expect(claude).toEqual({
        engineCode: 'CLAUDE',
        displayName: 'Claude Code',
        binName: 'claude',
        modelOptions: ['sonnet', 'opus', 'haiku'],
        allowCustomModel: false,
        defaultModels: { text: 'sonnet', vision: 'sonnet' },
        loginCommand: 'claude 실행 후 /login',
        termsNote:
          '본인 Claude 구독 한도를 씁니다. 대량·상시 사용은 Anthropic 약관상 제한될 수 있고, 계정 책임은 본인에게 있습니다.',
        experimental: false,
      });
      // AGY 목록 = agy models(가짜 어댑터의 fixture 출력을 실제 파서로)
      expect(agy!.modelOptions).toEqual(agyModelsFixture());
      expect(agy!.modelOptions).toContain(AGY_TEXT);
      expect(agy!.defaultModels).toEqual({ text: AGY_TEXT, vision: 'gemini-3.8-flash-high' });
      // M0 S7: AGY는 기준 미달(스키마 통과 86%)이라 '실험적'
      expect(agy!.experimental).toBe(true);
      expect(codex).toMatchObject({
        allowCustomModel: true,
        modelOptions: [],
        defaultModels: { text: null, vision: null },
        experimental: true,
      });
      const snapshot = await t.prisma.settingsSnapshot.findUnique({
        where: { id: settingsService().currentSnapshotId() },
      });
      expect(body.settingsSnapshotId).toBe(snapshot!.id);
      expect(body.updatedAt).toBe(snapshot!.lastLoadedAt.toISOString());
      expect(res.text).not.toContain('binPath');
    });
  });

  describe('PUT /settings/ai-engine(규칙 3·4·5·6)', () => {
    it('X-AutoStore-Client가 없으면 403 CLIENT_HEADER_REQUIRED', async () => {
      const res = await http()
        .put('/api/v1/settings/ai-engine')
        .send({ selectedEngine: 'CLAUDE', models: modelsWith() })
        .expect(403);
      expect((res.body as ErrorBody).code).toBe('CLIENT_HEADER_REQUIRED');
    });

    it('정의 밖 필드·빠진 키는 422 VALIDATION_FAILED', async () => {
      const extra = await put({ selectedEngine: 'CLAUDE', models: modelsWith(), note: 'x' }).expect(
        422,
      );
      expect((extra.body as ErrorBody).code).toBe('VALIDATION_FAILED');
      const missing = await put({
        selectedEngine: 'CLAUDE',
        models: { CLAUDE: { text: 'sonnet', vision: 'sonnet' }, AGY: { text: null, vision: null } },
      }).expect(422);
      expect((missing.body as ErrorBody).code).toBe('VALIDATION_FAILED');
      expect((missing.body as ErrorBody).fieldErrors?.map((e) => e.field)).toContain(
        'models.CODEX',
      );
    });

    it("규칙 3: CLAUDE 텍스트 'gpt-5' → 422 AI_MODEL_INVALID(fieldErrors[0].field = models.CLAUDE.text)", async () => {
      const res = await put({
        selectedEngine: 'CLAUDE',
        models: modelsWith({ CLAUDE: { text: 'gpt-5', vision: 'sonnet' } }),
      }).expect(422);
      const body = res.body as ErrorBody;
      expect(body.code).toBe('AI_MODEL_INVALID');
      expect(body.fieldErrors?.[0]?.field).toBe('models.CLAUDE.text');
      expect(body.message).toBe('Claude Code에서 쓸 수 없는 모델입니다: gpt-5.');
    });

    it('규칙 3: 선택 엔진의 모델이 null이면 422 AI_MODEL_INVALID(CODEX 선택·텍스트 null)', async () => {
      const res = await put({ selectedEngine: 'CODEX', models: modelsWith() }).expect(422);
      const body = res.body as ErrorBody;
      expect(body.code).toBe('AI_MODEL_INVALID');
      expect(body.fieldErrors?.map((e) => e.field)).toEqual([
        'models.CODEX.text',
        'models.CODEX.vision',
      ]);
    });

    it('규칙 4: 통과 기록 없이 AGY → 409 AI_ENGINE_NOT_VERIFIED details { engineCode, model }', async () => {
      const res = await put({ selectedEngine: 'AGY', models: modelsWith() }).expect(409);
      const body = res.body as ErrorBody;
      expect(body.code).toBe('AI_ENGINE_NOT_VERIFIED');
      expect(body.details).toEqual({ engineCode: 'AGY', model: AGY_TEXT });
      expect(body.message).toBe(
        `Antigravity CLI(${AGY_TEXT})으로 연결 테스트를 먼저 통과해 주세요. 통과한 지 10분이 지났으면 다시 해 주세요.`,
      );
      expect(fileAi().engine).toBe('CLAUDE');
    });

    it('규칙 4: FAILED·다른 모델·다른 엔진의 PASSED로는 저장하지 않는다', async () => {
      const now = t.clock.now();
      await seedAiCliCheck(t.prisma, {
        engineCode: 'AGY',
        smokeStatus: 'FAILED',
        model: AGY_TEXT,
        errorCode: 'CONTRACT_FAILED',
        checkedAt: now,
      });
      await seedAiCliCheck(t.prisma, {
        engineCode: 'AGY',
        smokeStatus: 'PASSED',
        model: 'gemini-3.1-pro-high',
        checkedAt: now,
      });
      await seedAiCliCheck(t.prisma, { engineCode: 'CLAUDE', model: AGY_TEXT, checkedAt: now });
      await put({ selectedEngine: 'AGY', models: modelsWith() }).expect(409);
    });

    it('규칙 5·6: AGY 연결 테스트 통과 뒤 저장 — 파일 ai.engine, 스냅샷 +1, SSE rerunRequiredStepCount 0, 끝난 AI 단계 그대로, 감사 기록', async () => {
      const { candidate } = await createCandidate(t.prisma, {
        steps: { SOURCING: 'COMPLETED', COPY: 'COMPLETED' },
      });
      await passSmoke('AGY', AGY_TEXT);
      const snapshotsBefore = await t.prisma.settingsSnapshot.count();
      const previousSnapshotId = settingsService().currentSnapshotId();
      // 이 내용(현재 설정 + AGY)은 이 스위트에서 처음 만든다(beforeInit에서 settings_snapshot을 비웠다).
      // fixture 스냅샷(ensureSettingsSnapshot)은 ai 섹션이 없다
      const agyRowsBefore = (await t.prisma.settingsSnapshot.findMany()).filter(
        (row) => (row.content as unknown as Partial<AppSettings>).ai?.engine === 'AGY',
      );
      expect(agyRowsBefore).toEqual([]);
      events.length = 0;

      const res = await put({ selectedEngine: 'AGY', models: modelsWith() }).expect(200);
      const body = res.body as AiEngineSettingsBody;
      expect(body.selectedEngine).toBe('AGY');
      expect(body.models.AGY).toEqual({ text: AGY_TEXT, vision: 'gemini-3.8-flash-high' });
      expect(body.settingsSnapshotId).toBe(settingsService().currentSnapshotId());
      expect(body.settingsSnapshotId).not.toBe(previousSnapshotId);

      expect(fileAi()).toEqual(aiFixture('agy-selected.json'));
      expect(await t.prisma.settingsSnapshot.count()).toBe(snapshotsBefore + 1);
      const snapshot = await t.prisma.settingsSnapshot.findUnique({
        where: { id: body.settingsSnapshotId },
      });
      expect((snapshot!.content as unknown as AppSettings).ai.engine).toBe('AGY');
      expect(snapshot!.firstLoadedAt.getTime()).toBe(snapshot!.lastLoadedAt.getTime());
      expect(settingsService().current().ai.engine).toBe('AGY');

      const reloaded = eventsNamed('settings.reloaded');
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0]!.data).toMatchObject({
        settingsSnapshotId: body.settingsSnapshotId,
        valid: true,
        errors: [],
        rerunRequiredStepCount: 0,
      });
      expect((reloaded[0]!.data as { changedKeys: string[] }).changedKeys).toEqual(
        expect.arrayContaining(['ai.engine', 'ai.models.AGY.text', 'ai.models.AGY.vision']),
      );
      // 규칙 6: 이미 만든 AI 단계 결과는 그대로(재실행 필요 없음)
      const steps = await t.prisma.candidateStep.findMany({
        where: { candidateId: candidate.id, stepCode: { in: ['SOURCING', 'COPY'] } },
      });
      expect(steps.map((s) => s.status)).toEqual(['COMPLETED', 'COMPLETED']);
      expect(await t.prisma.candidateStep.count({ where: { status: 'RERUN_REQUIRED' } })).toBe(0);
      // 감사 기록(SETTING_CHANGED, 값 없이 바뀐 키만 — Proposed)
      const audit = await t.prisma.userActionLog.findMany({
        where: { eventType: 'SETTING_CHANGED' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.detail).toMatchObject({ setting: 'AI_ENGINE' });

      // 규칙 10: 저장 뒤 최신 점검의 선택 엔진
      const latest = await http().get('/api/v1/ai-cli-checks/latest').expect(200);
      const latestBody = latest.body as {
        selectedEngine: string;
        items: { engineCode: string; selected: boolean }[];
      };
      expect(latestBody.selectedEngine).toBe('AGY');
      expect(latestBody.items.find((i) => i.engineCode === 'AGY')!.selected).toBe(true);
    });

    it('규칙 5: 값이 같으면 200 + 현재 설정, 스냅샷·파일 쓰기·SSE 없음', async () => {
      const before = await t.prisma.settingsSnapshot.count();
      const bytes = readFileSync(settingsFilePath(DATA_DIR));
      events.length = 0;
      const res = await put({
        selectedEngine: 'CLAUDE',
        models: {
          CLAUDE: { text: 'sonnet', vision: 'sonnet' },
          AGY: { text: null, vision: null },
          CODEX: { text: null, vision: null },
        },
      }).expect(200);
      expect((res.body as AiEngineSettingsBody).selectedEngine).toBe('CLAUDE');
      expect(await t.prisma.settingsSnapshot.count()).toBe(before);
      expect(readFileSync(settingsFilePath(DATA_DIR)).equals(bytes)).toBe(true);
      expect(eventsNamed('settings.reloaded')).toHaveLength(0);
    });

    it('규칙 5(Proposed): 예전에 쓴 ai 설정으로 돌아가면 새 행 없이 그 스냅샷의 last_loaded_at만 갱신하고 그 id를 준다(P1-03 중복 제거)', async () => {
      const defaultSnapshotId = settingsService().currentSnapshotId();
      await passSmoke('AGY', AGY_TEXT);
      await put({ selectedEngine: 'AGY', models: modelsWith() }).expect(200);
      const agySnapshotId = settingsService().currentSnapshotId();
      expect(agySnapshotId).not.toBe(defaultSnapshotId);
      const before = await t.prisma.settingsSnapshot.findUniqueOrThrow({
        where: { id: defaultSnapshotId },
      });
      const count = await t.prisma.settingsSnapshot.count();
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.length = 0;

      await passSmoke('CLAUDE', 'sonnet');
      const res = await put({
        selectedEngine: 'CLAUDE',
        models: {
          CLAUDE: { text: 'sonnet', vision: 'sonnet' },
          AGY: { text: null, vision: null },
          CODEX: { text: null, vision: null },
        },
      }).expect(200);
      const body = res.body as AiEngineSettingsBody;
      expect(body.selectedEngine).toBe('CLAUDE');
      expect(body.settingsSnapshotId).toBe(defaultSnapshotId);
      expect(settingsService().currentSnapshotId()).toBe(defaultSnapshotId);
      expect(await t.prisma.settingsSnapshot.count()).toBe(count);
      const after = await t.prisma.settingsSnapshot.findUniqueOrThrow({
        where: { id: defaultSnapshotId },
      });
      expect(after.lastLoadedAt.getTime()).toBeGreaterThan(before.lastLoadedAt.getTime());
      expect(body.updatedAt).toBe(after.lastLoadedAt.toISOString());
      expect(fileAi()).toEqual(aiFixture('default.json'));
      // 새 행이 아니어도 설정은 바뀌었으므로 SSE는 보낸다(그 스냅샷 id, valid true)
      const reloaded = eventsNamed('settings.reloaded');
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0]!.data).toMatchObject({
        settingsSnapshotId: defaultSnapshotId,
        valid: true,
        errors: [],
        rerunRequiredStepCount: 0,
      });
    });

    it('규칙 5: 앞선 다시 읽기가 실패한 상태(스키마 위반)에서 저장해도 SSE는 valid true·errors [](GET /settings는 파일 검사 결과 그대로)', async () => {
      const invalid = {
        ...(DEFAULT_SETTINGS as AppSettings),
        costs: { ...DEFAULT_SETTINGS.costs, cardSurchargePct: '2.5' },
      };
      await writeSettingsFileAtomically(DATA_DIR, invalid as unknown as AppSettings);
      await expect(settingsService().reload()).rejects.toMatchObject({
        code: 'SETTINGS_SCHEMA_INVALID',
      });
      await passSmoke('CLAUDE', 'opus');
      events.length = 0;
      await put({
        selectedEngine: 'CLAUDE',
        models: modelsWith({ CLAUDE: { text: 'opus', vision: 'sonnet' } }),
      }).expect(200);
      const reloaded = eventsNamed('settings.reloaded');
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0]!.data).toMatchObject({ valid: true, errors: [] });
      const view = await http().get('/api/v1/settings').expect(200);
      expect((view.body as { valid: boolean }).valid).toBe(false);
    });

    it('규칙 4: 10분 경계 — 9분 59초 전 통과는 저장, 10분 1초 지나면 409', async () => {
      await passSmoke('AGY', AGY_TEXT);
      t.clock.advance(10 * 60 * 1000 + 1000);
      await put({ selectedEngine: 'AGY', models: modelsWith() }).expect(409);
      t.clock.advance(-2000);
      await put({ selectedEngine: 'AGY', models: modelsWith() }).expect(200);
    });

    it('파일에 다시 읽지 않은 다른 수정이 있으면 ai 키만 바꾸고 나머지는 그대로 둔다(Proposed)', async () => {
      const edited = {
        ...(DEFAULT_SETTINGS as AppSettings),
        costs: { ...DEFAULT_SETTINGS.costs, miscCostKrw: 4321 },
      };
      await writeSettingsFileAtomically(DATA_DIR, edited);
      await passSmoke('CLAUDE', 'opus');
      await put({
        selectedEngine: 'CLAUDE',
        models: modelsWith({ CLAUDE: { text: 'opus', vision: 'sonnet' } }),
      }).expect(200);
      const file = JSON.parse(readFileSync(settingsFilePath(DATA_DIR), 'utf8')) as AppSettings;
      expect(file.costs.miscCostKrw).toBe(4321);
      expect(file.ai.models.CLAUDE.text).toBe('opus');
      // 스냅샷은 '현재 설정 + 새 ai'(다른 수정은 다음 다시 읽기 때)
      expect(settingsService().current().costs.miscCostKrw).toBe(
        DEFAULT_SETTINGS.costs.miscCostKrw,
      );
    });

    it('설정 파일이 JSON이 아니면 쓰지 않고 422 SETTINGS_SCHEMA_INVALID(Proposed)', async () => {
      await writeSettingsFileAtomically(DATA_DIR, '{ "schemaVersion": "1",\n');
      await passSmoke('CLAUDE', 'opus');
      const res = await put({
        selectedEngine: 'CLAUDE',
        models: modelsWith({ CLAUDE: { text: 'opus', vision: 'sonnet' } }),
      }).expect(422);
      expect((res.body as ErrorBody).code).toBe('SETTINGS_SCHEMA_INVALID');
      expect(readFileSync(settingsFilePath(DATA_DIR), 'utf8')).toBe('{ "schemaVersion": "1",\n');
    });
  });

  describe('POST /ai-cli-checks(규칙 7·8·9)', () => {
    it('규칙 8: smokeTest=true인데 engineCodes 없음 → 422 VALIDATION_FAILED', async () => {
      const res = await postCheck({ smokeTest: true, trigger: 'MANUAL' }).expect(422);
      expect((res.body as ErrorBody).code).toBe('VALIDATION_FAILED');
      expect((res.body as ErrorBody).fieldErrors?.[0]?.field).toBe('engineCodes');
    });

    it('규칙 9: trigger STARTUP은 422 VALIDATION_FAILED', async () => {
      const res = await postCheck({ smokeTest: false, trigger: 'STARTUP' }).expect(422);
      expect((res.body as ErrorBody).code).toBe('VALIDATION_FAILED');
    });

    it('규칙 8: CODEX 모델이 비어 있으면(설정 기본 null) 422 AI_MODEL_INVALID', async () => {
      const res = await postCheck({
        engineCodes: ['CODEX'],
        smokeTest: true,
        trigger: 'MANUAL',
      }).expect(422);
      const body = res.body as ErrorBody;
      expect(body.code).toBe('AI_MODEL_INVALID');
      expect(body.fieldErrors?.[0]?.field).toBe('models.CODEX');
      expect(await t.prisma.aiCliCheck.count()).toBe(0);
    });

    it('규칙 8: 설정 파일을 직접 고쳐 CODEX 선택·모델 null(codex-null-models.json)이면 GET은 그대로 보이고, 모델 없는 CODEX 연결 테스트는 422 AI_MODEL_INVALID', async () => {
      await useAi(aiFixture('codex-null-models.json'));
      const view = await http().get('/api/v1/settings/ai-engine').expect(200);
      const body = view.body as AiEngineSettingsBody;
      expect(body.selectedEngine).toBe('CODEX');
      expect(body.models.CODEX).toEqual({ text: null, vision: null });
      const res = await postCheck({
        engineCodes: ['CODEX'],
        smokeTest: true,
        trigger: 'MANUAL',
      }).expect(422);
      expect((res.body as ErrorBody).code).toBe('AI_MODEL_INVALID');
      expect((res.body as ErrorBody).fieldErrors?.[0]?.field).toBe('models.CODEX');
      expect(await t.prisma.aiCliCheck.count()).toBe(0);
      expect(t.ai.codex.calls.smokeTest).toEqual([]);
    });

    it('규칙 8: 목록 밖 모델(CLAUDE gpt-5)은 422 AI_MODEL_INVALID, 부르지 않는다', async () => {
      await postCheck({
        engineCodes: ['CLAUDE'],
        smokeTest: true,
        models: { CLAUDE: 'gpt-5' },
        trigger: 'MANUAL',
      }).expect(422);
      expect(t.ai.claude.calls.smokeTest).toEqual([]);
    });

    it('규칙 7·9: 감지만 → 202 + Location, 3행 모두 SKIPPED, SSE 3건(binPath 없음), 연결 테스트 0회', async () => {
      const res = await postCheck({ smokeTest: false, trigger: 'MANUAL' }).expect(202);
      expect(res.headers.location).toBe('/api/v1/ai-cli-checks/latest');
      const body = res.body as { engineCodes: string[]; status: string; acceptedAt: string };
      expect(body).toMatchObject({
        engineCodes: ['CLAUDE', 'AGY', 'CODEX'],
        smokeTest: false,
        trigger: 'MANUAL',
        status: 'RUNNING',
      });
      expect(body.acceptedAt).toBe(t.clock.now().toISOString());
      await idle();
      const rows = await t.prisma.aiCliCheck.findMany({ orderBy: { id: 'asc' } });
      expect(rows.map((r) => [r.engineCode, r.trigger, r.smokeStatus])).toEqual([
        ['CLAUDE', 'MANUAL', 'SKIPPED'],
        ['AGY', 'MANUAL', 'SKIPPED'],
        ['CODEX', 'MANUAL', 'SKIPPED'],
      ]);
      const completed = eventsNamed('ai-cli-check.completed');
      expect(completed).toHaveLength(3);
      for (const e of completed) expect(Object.keys(e.data as object)).not.toContain('binPath');
      expect(t.ai.claude.calls.smokeTest).toHaveLength(0);
      expect(t.ai.agy.calls.smokeTest).toHaveLength(0);
      expect(t.ai.codex.calls.smokeTest).toHaveLength(0);
      // 감지 때 agy models 목록을 다시 받는다(Proposed, 비용 없음)
      expect(t.ai.agy.calls.listModels).toBeGreaterThanOrEqual(1);
    });

    it('규칙 8·9: CLAUDE만 연결 테스트 → 1행 PASSED·sonnet·latency ≥ 0, AGY·CODEX 어댑터 0회', async () => {
      await postCheck({
        engineCodes: ['CLAUDE'],
        smokeTest: true,
        models: { CLAUDE: 'sonnet' },
        trigger: 'MANUAL',
      }).expect(202);
      await idle();
      const rows = await t.prisma.aiCliCheck.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        engineCode: 'CLAUDE',
        smokeStatus: 'PASSED',
        model: 'sonnet',
      });
      expect(rows[0]!.latencyMs).toBeGreaterThanOrEqual(0);
      expect(t.ai.claude.calls.smokeTest).toEqual(['sonnet']);
      for (const other of [t.ai.agy, t.ai.codex]) {
        expect(other.calls).toMatchObject({
          detect: 0,
          authStatus: 0,
          smokeTest: [],
          listModels: 0,
        });
      }
    });

    it('규칙 8: models가 없으면 설정의 그 엔진 텍스트 모델로 테스트한다', async () => {
      await postCheck({ engineCodes: ['CLAUDE'], smokeTest: true, trigger: 'MANUAL' }).expect(202);
      await idle();
      expect(t.ai.claude.calls.smokeTest).toEqual(['sonnet']);
    });

    it('규칙 9: 점검이 도는 중에 다시 POST → 409 ALREADY_IN_PROGRESS(details.job=AI_CLI_CHECK), 끝나면 다시 받는다', async () => {
      let open: () => void = () => undefined;
      t.ai.claude.smokeGate = new Promise<void>((resolve) => {
        open = resolve;
      });
      await postCheck({ engineCodes: ['CLAUDE'], smokeTest: true, trigger: 'MANUAL' }).expect(202);
      const busy = await postCheck({ smokeTest: false, trigger: 'MANUAL' }).expect(409);
      const body = busy.body as ErrorBody;
      expect(body.code).toBe('ALREADY_IN_PROGRESS');
      expect(body.details).toEqual({ job: 'AI_CLI_CHECK' });
      expect(body.message).toBe('AI 엔진 점검이 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.');
      open();
      await idle();
      t.ai.claude.smokeGate = null;
      await postCheck({ smokeTest: false, trigger: 'MANUAL' }).expect(202);
      await idle();
    });

    it('규칙 9: 미설치 CODEX에 smokeTest(models.CODEX x) → installed=false·SKIPPED·model·latency NULL', async () => {
      await postCheck({
        engineCodes: ['CODEX'],
        smokeTest: true,
        models: { CODEX: 'x' },
        trigger: 'MANUAL',
      }).expect(202);
      await idle();
      const rows = await t.prisma.aiCliCheck.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        engineCode: 'CODEX',
        installed: false,
        smokeStatus: 'SKIPPED',
        model: null,
        latencyMs: null,
        errorCode: 'NOT_INSTALLED',
      });
      expect(t.ai.codex.calls.smokeTest).toEqual([]);
    });
  });

  describe('GET /ai-cli-checks/latest·GET /ai-cli-checks(규칙 10, Proposed 이력)', () => {
    it('latest는 엔진마다 checked_at·id 내림차순 첫 행과 binPath(§1.2 예외)를 준다', async () => {
      await seedAiCliCheck(t.prisma, { engineCode: 'CLAUDE', model: 'opus' });
      await seedAiCliCheck(t.prisma, { engineCode: 'CLAUDE', model: 'sonnet' });
      const res = await http().get('/api/v1/ai-cli-checks/latest').expect(200);
      const items = (res.body as { items: { engineCode: string; latest: CheckRow | null }[] })
        .items;
      expect(items.map((i) => i.engineCode)).toEqual(['CLAUDE', 'AGY', 'CODEX']);
      expect(items[0]!.latest).toMatchObject({ model: 'sonnet', binPath: '/usr/local/bin/claude' });
      expect(items[1]!.latest).toBeNull();
    });

    it('이력은 최신순 페이지(content·page), engineCode로 거른다. 허용 밖 정렬은 422', async () => {
      const base = t.clock.now().getTime();
      await seedAiCliCheck(t.prisma, { engineCode: 'CLAUDE', checkedAt: new Date(base - 3000) });
      await seedAiCliCheck(t.prisma, {
        engineCode: 'AGY',
        smokeStatus: 'SKIPPED',
        checkedAt: new Date(base - 2000),
      });
      await seedAiCliCheck(t.prisma, {
        engineCode: 'CODEX',
        installed: false,
        smokeStatus: 'SKIPPED',
        checkedAt: new Date(base - 1000),
      });
      const res = await http().get('/api/v1/ai-cli-checks?size=2').expect(200);
      const body = res.body as {
        content: CheckRow[];
        page: { number: number; size: number; totalElements: number; totalPages: number };
      };
      expect(body.content.map((r) => r.engineCode)).toEqual(['CODEX', 'AGY']);
      expect(body.page).toEqual({ number: 0, size: 2, totalElements: 3, totalPages: 2 });
      const agy = await http().get('/api/v1/ai-cli-checks?engineCode=AGY').expect(200);
      expect((agy.body as { content: CheckRow[] }).content.map((r) => r.engineCode)).toEqual([
        'AGY',
      ]);
      const bad = await http().get('/api/v1/ai-cli-checks?sort=id,desc').expect(422);
      expect((bad.body as ErrorBody).code).toBe('INVALID_QUERY_PARAMETER');
      const badEngine = await http().get('/api/v1/ai-cli-checks?engineCode=GEMINI').expect(422);
      expect((badEngine.body as ErrorBody).code).toBe('INVALID_QUERY_PARAMETER');
    });
  });

  describe('로드된 설정이 없을 때(규칙 1)', () => {
    afterAll(async () => {
      await writeSettingsFileAtomically(DATA_DIR, DEFAULT_SETTINGS);
      await settingsService().initialize();
    });

    it('GET·PUT /settings/ai-engine은 503 SETTINGS_INVALID', async () => {
      await truncate(t.prisma, ['settings_snapshot']);
      await writeSettingsFileAtomically(DATA_DIR, '{ broken');
      await settingsService().initialize();
      const get = await http().get('/api/v1/settings/ai-engine').expect(503);
      expect((get.body as ErrorBody).code).toBe('SETTINGS_INVALID');
      const res = await put({ selectedEngine: 'CLAUDE', models: modelsWith() }).expect(503);
      expect((res.body as ErrorBody).code).toBe('SETTINGS_INVALID');
    });
  });
});
