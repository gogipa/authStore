import type { UserActionLogService } from '../../../common/audit/user-action-log.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import type { AiCliCheck } from '../../../generated/prisma/client.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { AgyModelsProvider } from '../../integrations/ai-engine/agy-models.provider.js';
import type { Clock } from '../../integrations/http/clock.token.js';
import { AiCliCheckQueryService } from '../../system/ai-cli-checks/ai-cli-check.query.js';
import { DEFAULT_SETTINGS } from '../defaults/default-settings.js';
import type { AiSettings, AppSettings } from '../schema/settings.types.js';
import type {
  AiSectionReplaceOptions,
  AiSectionReplaceOutcome,
  SettingsService,
} from '../settings.service.js';
import { AiEngineSettingsService } from './ai-engine-settings.service.js';

const NOW = Date.parse('2026-09-30T05:00:00Z');
const SEC = 1000;
const MIN = 60 * SEC;
const AGY_TEXT = 'gemini-3.8-flash-medium';

type Where = {
  engineCode?: string;
  model?: string;
  smokeStatus?: string;
  checkedAt?: { gte: Date };
};

/** ai_cli_check·settings_snapshot 표만 흉내 내는 가짜 Prisma(findFirst의 where·정렬을 실제와 같게) */
class FakePrisma {
  checks: AiCliCheck[] = [];
  aiCliCheck = {
    findFirst: ({ where }: { where: Where }) => {
      const rows = this.checks
        .filter(
          (r) =>
            (where.engineCode === undefined || r.engineCode === where.engineCode) &&
            (where.model === undefined || r.model === where.model) &&
            (where.smokeStatus === undefined || r.smokeStatus === where.smokeStatus) &&
            (where.checkedAt === undefined || r.checkedAt >= where.checkedAt.gte),
        )
        .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime() || b.id - a.id);
      return Promise.resolve(rows[0] ?? null);
    },
  };
  settingsSnapshot = {
    findUnique: ({ where }: { where: { id: number } }) =>
      Promise.resolve({ id: where.id, lastLoadedAt: new Date(NOW - 5 * MIN) }),
  };
}

function check(patch: Partial<AiCliCheck>): AiCliCheck {
  return {
    id: 1,
    engineCode: 'AGY',
    trigger: 'BEFORE_SAVE',
    installed: true,
    binPath: '/usr/local/bin/agy',
    cliVersion: '1.2.9',
    versionSupported: null,
    authStatus: 'UNKNOWN',
    smokeStatus: 'PASSED',
    model: AGY_TEXT,
    latencyMs: 900,
    errorCode: null,
    errorMessage: null,
    checkedAt: new Date(NOW),
    ...patch,
  };
}

function setup() {
  const prisma = new FakePrisma();
  let ai: AiSettings = structuredClone(DEFAULT_SETTINGS.ai);
  const replaced: AiSettings[] = [];
  const settings = {
    current: () => ({ ...(DEFAULT_SETTINGS as AppSettings), ai }),
    currentSnapshotId: () => 7,
    replaceAiSection: (next: AiSettings, _options?: AiSectionReplaceOptions) => {
      replaced.push(next);
      ai = next;
      return Promise.resolve<AiSectionReplaceOutcome>({
        changed: true,
        snapshotId: 8,
        changedKeys: ['ai.engine'],
      });
    },
  } as unknown as SettingsService;
  const clock: Clock = { now: () => new Date(NOW), sleep: () => Promise.resolve() };
  const agyModels = { list: () => Promise.resolve(null) } as unknown as AgyModelsProvider;
  const service = new AiEngineSettingsService(
    prisma as unknown as PrismaService,
    settings,
    new AiCliCheckQueryService(prisma as unknown as PrismaService),
    agyModels,
    { record: () => Promise.resolve({}) } as unknown as UserActionLogService,
    clock,
  );
  return { prisma, service, replaced };
}

const agyBody = {
  selectedEngine: 'AGY' as const,
  models: {
    CLAUDE: { text: 'sonnet', vision: 'sonnet' },
    AGY: { text: AGY_TEXT, vision: 'gemini-3.8-flash-high' },
    CODEX: { text: null, vision: null },
  },
};

async function rejection(p: Promise<unknown>): Promise<ApiException> {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiException);
  return error as ApiException;
}

describe('AI 엔진 저장 조건 10분(P1-11 규칙 4, 고정 시계)', () => {
  it('PASSED가 9분 59초 전 → 저장', async () => {
    const t = setup();
    t.prisma.checks.push(check({ checkedAt: new Date(NOW - 9 * MIN - 59 * SEC) }));
    const view = await t.service.update(agyBody);
    expect(view.selectedEngine).toBe('AGY');
    expect(t.replaced).toHaveLength(1);
  });

  it('정확히 10분 전은 통과로 본다(경계 포함)', async () => {
    const t = setup();
    t.prisma.checks.push(check({ checkedAt: new Date(NOW - 10 * MIN) }));
    await t.service.update(agyBody);
    expect(t.replaced).toHaveLength(1);
  });

  it.each([
    ['PASSED가 10분 1초 전', check({ checkedAt: new Date(NOW - 10 * MIN - SEC) })],
    ['FAILED가 1분 전', check({ smokeStatus: 'FAILED', checkedAt: new Date(NOW - MIN) })],
    ['PASSED인데 모델이 다름', check({ model: 'gemini-3.1-pro-high' })],
    ['다른 엔진의 PASSED', check({ engineCode: 'CLAUDE', model: AGY_TEXT })],
  ])('%s → 409 AI_ENGINE_NOT_VERIFIED, 저장하지 않는다', async (_name, row) => {
    const t = setup();
    t.prisma.checks.push(row);
    const e = await rejection(t.service.update(agyBody));
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('AI_ENGINE_NOT_VERIFIED');
    expect(e.details).toEqual({ engineCode: 'AGY', model: AGY_TEXT });
    expect(t.replaced).toHaveLength(0);
  });

  it('CLAUDE: PASSED 모델 opus인데 저장 텍스트 모델 sonnet → 409', async () => {
    const t = setup();
    t.prisma.checks.push(check({ engineCode: 'CLAUDE', model: 'opus' }));
    const e = await rejection(
      t.service.update({
        selectedEngine: 'CLAUDE',
        models: { ...agyBody.models, CLAUDE: { text: 'sonnet', vision: 'opus' } },
      }),
    );
    expect(e.details).toEqual({ engineCode: 'CLAUDE', model: 'sonnet' });
  });

  it('비전 모델은 조건에 들지 않는다(텍스트 모델 PASSED만 본다)', async () => {
    const t = setup();
    t.prisma.checks.push(check({ engineCode: 'CLAUDE', model: 'sonnet' }));
    await t.service.update({
      selectedEngine: 'CLAUDE',
      models: { ...agyBody.models, CLAUDE: { text: 'sonnet', vision: 'haiku' } },
    });
    expect(t.replaced).toHaveLength(1);
  });
});

describe('AI 엔진 저장 순서(P1-11 규칙 5, Proposed)', () => {
  it('같은 값이면 10분 조건을 보지 않고 쓰지도 않는다', async () => {
    const t = setup();
    const view = await t.service.update({
      selectedEngine: 'CLAUDE',
      models: {
        CLAUDE: { text: 'sonnet', vision: 'sonnet' },
        AGY: { text: null, vision: null },
        CODEX: { text: null, vision: null },
      },
    });
    expect(view.selectedEngine).toBe('CLAUDE');
    expect(view.settingsSnapshotId).toBe(7);
    expect(t.replaced).toHaveLength(0);
  });

  it('모델 검사(422)가 10분 조건(409)보다 먼저다', async () => {
    const t = setup();
    const e = await rejection(
      t.service.update({
        ...agyBody,
        models: { ...agyBody.models, AGY: { text: 'gemini-9', vision: null } },
      }),
    );
    expect(e.code).toBe('AI_MODEL_INVALID');
    expect(e.fieldErrors?.map((f) => f.field)).toEqual(['models.AGY.text', 'models.AGY.vision']);
  });
});
