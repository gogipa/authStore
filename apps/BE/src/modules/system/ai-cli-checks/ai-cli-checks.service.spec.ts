import { ApiException } from '../../../common/errors/api.exception.js';
import type { AiCliCheck } from '../../../generated/prisma/client.js';
import type { AgyModelsProvider } from '../../integrations/ai-engine/agy-models.provider.js';
import type { AiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';
import type { Clock } from '../../integrations/http/clock.token.js';
import { DEFAULT_SETTINGS } from '../../settings/defaults/default-settings.js';
import type { SettingsService } from '../../settings/settings.service.js';
import type { AiCliCheckRequestDto } from './ai-cli-check.dto.js';
import { AiCliCheckLock } from './ai-cli-check.lock.js';
import type { AiCliCheckQueryService } from './ai-cli-check.query.js';
import type { AiCliCheckOptions, AiCliCheckRecorder } from './ai-cli-check.recorder.js';
import { AiCliChecksService } from './ai-cli-checks.service.js';

const NOW = new Date('2026-09-30T05:00:00Z');

/** 점검 기록기 가짜: 부를 때마다 결과를 이쪽에서 정한다 */
class FakeRecorder {
  readonly calls: { engines: AiEngineCode[]; options: AiCliCheckOptions }[] = [];
  private settle: { resolve: (rows: AiCliCheck[]) => void; reject: (e: unknown) => void }[] = [];

  check(engines: readonly AiEngineCode[], options: AiCliCheckOptions): Promise<AiCliCheck[]> {
    this.calls.push({ engines: [...engines], options });
    return new Promise((resolve, reject) => this.settle.push({ resolve, reject }));
  }

  finish(): void {
    this.settle.shift()?.resolve([]);
  }

  fail(error: unknown): void {
    this.settle.shift()?.reject(error);
  }
}

function setup() {
  const recorder = new FakeRecorder();
  const lock = new AiCliCheckLock();
  const settings = { currentOrNull: () => DEFAULT_SETTINGS } as unknown as SettingsService;
  const clock: Clock = { now: () => NOW, sleep: () => Promise.resolve() };
  const agyModels = {
    list: () => Promise.resolve(['gemini-3.8-flash-medium']),
  } as unknown as AgyModelsProvider;
  const service = new AiCliChecksService(
    settings,
    {} as AiCliCheckQueryService,
    recorder as unknown as AiCliCheckRecorder,
    lock,
    agyModels,
    clock,
  );
  (service as unknown as { logger: object }).logger = { error: () => undefined };
  return { service, recorder, lock };
}

const detectAll: AiCliCheckRequestDto = { smokeTest: false, trigger: 'MANUAL' };

async function rejection(p: Promise<unknown>): Promise<ApiException> {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiException);
  return error as ApiException;
}

describe('POST /ai-cli-checks 잠금(P1-11 규칙 9)', () => {
  it('점검 중 두 번째 start() → 409 ALREADY_IN_PROGRESS(details.job=AI_CLI_CHECK), 끝나면 다시 받는다', async () => {
    const { service, recorder, lock } = setup();
    const accepted = await service.start(detectAll);
    expect(accepted).toEqual({
      engineCodes: ['CLAUDE', 'AGY', 'CODEX'],
      smokeTest: false,
      trigger: 'MANUAL',
      status: 'RUNNING',
      acceptedAt: NOW.toISOString(),
    });
    expect(lock.busy).toBe(true);
    const busy = await rejection(service.start(detectAll));
    expect(busy.getStatus()).toBe(409);
    expect(busy.code).toBe('ALREADY_IN_PROGRESS');
    expect(busy.details).toEqual({ job: 'AI_CLI_CHECK' });
    expect(recorder.calls).toHaveLength(1);
    recorder.finish();
    await service.whenIdle();
    expect(lock.busy).toBe(false);
    await service.start(detectAll);
    expect(recorder.calls).toHaveLength(2);
  });

  it('첫 점검이 오류로 끝나도 잠금이 풀린다', async () => {
    const { service, recorder, lock } = setup();
    await service.start(detectAll);
    recorder.fail(new Error('DB 끊김'));
    await service.whenIdle();
    expect(lock.busy).toBe(false);
    await expect(service.start(detectAll)).resolves.toMatchObject({ status: 'RUNNING' });
  });

  it('검사 오류(422)는 잠금을 잡지 않는다', async () => {
    const { service, lock } = setup();
    await rejection(service.start({ smokeTest: true, trigger: 'MANUAL' }));
    await rejection(service.start({ engineCodes: ['CODEX'], smokeTest: true, trigger: 'MANUAL' }));
    expect(lock.busy).toBe(false);
  });

  it('감지만이면 연결 테스트 엔진·모델을 넘기지 않는다. 연결 테스트는 누른 엔진·설정 텍스트 모델', async () => {
    const { service, recorder } = setup();
    await service.start({ ...detectAll, models: { CLAUDE: 'opus' } });
    expect(recorder.calls[0]!.options).toEqual({ smokeTest: [], models: {}, trigger: 'MANUAL' });
    recorder.finish();
    await service.whenIdle();
    await service.start({ engineCodes: ['CLAUDE'], smokeTest: true, trigger: 'FIRST_RUN' });
    expect(recorder.calls[1]).toEqual({
      engines: ['CLAUDE'],
      options: { smokeTest: ['CLAUDE'], models: { CLAUDE: 'sonnet' }, trigger: 'FIRST_RUN' },
    });
  });
});
