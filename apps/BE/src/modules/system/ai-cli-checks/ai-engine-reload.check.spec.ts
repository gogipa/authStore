import type { SettingsReloadedEvent } from '../../../common/events/progress-event.types.js';
import type { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type { AiCliCheck } from '../../../generated/prisma/client.js';
import type { AiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';
import type { Clock } from '../../integrations/http/clock.token.js';
import { DEFAULT_SETTINGS } from '../../settings/defaults/default-settings.js';
import type { AiSettings, AppSettings } from '../../settings/schema/settings.types.js';
import type { SettingsService } from '../../settings/settings.service.js';
import { AiCliCheckLock } from './ai-cli-check.lock.js';
import type { AiCliCheckQueryService } from './ai-cli-check.query.js';
import type { AiCliCheckOptions, AiCliCheckRecorder } from './ai-cli-check.recorder.js';
import { AiEngineReloadCheck, selectedEngineChanged } from './ai-engine-reload.check.js';

const NOW = Date.parse('2026-09-30T05:00:00Z');

function setup(ai: AiSettings, recentPass: AiCliCheck | null = null) {
  const checks: { engines: AiEngineCode[]; options: AiCliCheckOptions }[] = [];
  const passQueries: unknown[][] = [];
  const lock = new AiCliCheckLock();
  const service = new AiEngineReloadCheck(
    { enabled: true },
    {} as ProgressEventsService,
    {
      currentOrNull: () => ({ ...(DEFAULT_SETTINGS as AppSettings), ai }),
    } as unknown as SettingsService,
    {
      findRecentPass: (...args: unknown[]) => {
        passQueries.push(args);
        return Promise.resolve(recentPass);
      },
    } as unknown as AiCliCheckQueryService,
    {
      check: (engines: readonly AiEngineCode[], options: AiCliCheckOptions) => {
        checks.push({ engines: [...engines], options });
        return Promise.resolve([]);
      },
    } as unknown as AiCliCheckRecorder,
    lock,
    { now: () => new Date(NOW), sleep: () => Promise.resolve() } satisfies Clock,
  );
  (service as unknown as { logger: object }).logger = {
    log: () => undefined,
    warn: () => undefined,
  };
  return { service, checks, passQueries, lock };
}

const agy: AiSettings = {
  engine: 'AGY',
  models: {
    CLAUDE: { text: 'sonnet', vision: 'sonnet' },
    AGY: { text: 'gemini-3.8-flash-medium', vision: 'gemini-3.8-flash-high' },
    CODEX: { text: null, vision: null },
  },
};

const reloaded = (changedKeys: string[], patch: Partial<SettingsReloadedEvent> = {}) => ({
  settingsSnapshotId: 3,
  changedKeys,
  valid: true,
  errors: [],
  rerunRequiredStepCount: 0,
  ...patch,
});

describe('설정 다시 읽기 뒤 선택 엔진 점검(P1-11 Proposed, 05-1 §7.5-51)', () => {
  it('선택 엔진·그 텍스트 모델 키만 본다', () => {
    expect(selectedEngineChanged(['ai.engine'], 'AGY')).toBe(true);
    expect(selectedEngineChanged(['ai.models.AGY.text'], 'AGY')).toBe(true);
    expect(selectedEngineChanged(['ai.models.AGY.vision'], 'AGY')).toBe(false);
    expect(selectedEngineChanged(['ai.models.CLAUDE.text'], 'AGY')).toBe(false);
    expect(selectedEngineChanged(['costs.miscCostKrw'], 'AGY')).toBe(false);
  });

  it('파일을 고쳐 AGY로 바꾸고 10분 안 통과가 없으면 AGY 하나만 계약 테스트(trigger STARTUP)', async () => {
    const t = setup(agy);
    expect(await t.service.handle(reloaded(['ai.engine', 'ai.models.AGY.text']))).toBe(true);
    expect(t.checks).toEqual([
      {
        engines: ['AGY'],
        options: {
          smokeTest: ['AGY'],
          models: { AGY: 'gemini-3.8-flash-medium' },
          trigger: 'STARTUP',
        },
      },
    ]);
    expect(t.passQueries).toEqual([['AGY', 'gemini-3.8-flash-medium', NOW - 10 * 60 * 1000]]);
    expect(t.lock.busy).toBe(false);
  });

  it('10분 안에 통과했으면(PUT /settings/ai-engine 저장) 부르지 않는다(쿼터 보호)', async () => {
    const t = setup(agy, { id: 1 } as AiCliCheck);
    expect(await t.service.handle(reloaded(['ai.engine']))).toBe(false);
    expect(t.checks).toEqual([]);
  });

  it('선택 엔진과 상관없는 변경·실패한 다시 읽기·잠금 중이면 부르지 않는다', async () => {
    const t = setup(agy);
    expect(await t.service.handle(reloaded(['costs.miscCostKrw']))).toBe(false);
    expect(
      await t.service.handle(reloaded(['ai.engine'], { valid: false, settingsSnapshotId: null })),
    ).toBe(false);
    const release = t.lock.tryAcquire()!;
    expect(await t.service.handle(reloaded(['ai.engine']))).toBe(false);
    release();
    expect(t.checks).toEqual([]);
  });
});
