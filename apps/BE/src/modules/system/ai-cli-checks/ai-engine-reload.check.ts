import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Subscription } from 'rxjs';
import type { SettingsReloadedEvent } from '../../../common/events/progress-event.types.js';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import { SettingsService } from '../../settings/settings.service.js';
import { AiCliCheckLock } from './ai-cli-check.lock.js';
import { AI_ENGINE_VERIFY_WINDOW_MS, AiCliCheckQueryService } from './ai-cli-check.query.js';
import { AiCliCheckRecorder } from './ai-cli-check.recorder.js';

/** 설정 다시 읽기 뒤 점검 스위치(운영·개발은 앱 시작 점검과 같은 환경변수 AI_ENGINE_STARTUP_CHECK, 테스트는 DI로 따로 끈다) */
export interface AiEngineReloadCheckOptions {
  enabled: boolean;
}

export const AI_ENGINE_RELOAD_CHECK = Symbol('AI_ENGINE_RELOAD_CHECK');

/** 선택 엔진이나 그 텍스트 모델이 바뀐 changedKeys인가(점 경로, diffSettingsKeys 모양) */
export function selectedEngineChanged(changedKeys: readonly string[], engine: string): boolean {
  const watched = new Set([
    'ai',
    'ai.engine',
    'ai.models',
    `ai.models.${engine}`,
    `ai.models.${engine}.text`,
  ]);
  return changedKeys.some((key) => watched.has(key));
}

/**
 * 설정 다시 읽기 뒤 선택 엔진 계약 테스트(P1-11 Proposed, 05-1 §7.5-51 P1-03 처리의 훅). 오너가 설정 JSON의 `ai` 섹션을
 * 직접 고치고 다시 읽으면(POST /settings-snapshots) 10분 연결 테스트 규칙(R8)을 건너뛴다. 그때 앱 시작 점검처럼 **선택 엔진
 * 하나만** 텍스트 모델로 계약 테스트를 1회 돌린다(trigger STARTUP — 앱이 스스로 하는 선택 엔진 점검, ck_ai_cli_check_trigger).
 * - SSE `settings.reloaded`(valid, 새 스냅샷)의 changedKeys에 선택 엔진·그 텍스트 모델이 있을 때만
 * - 그 엔진·모델로 10분 안에 통과한 기록이 있으면 부르지 않는다(PUT /settings/ai-engine 저장은 늘 여기에 걸린다 — 쿼터 보호, R7)
 * - 점검 잠금이 잡혀 있으면 건너뛴다. 스위치(`AI_ENGINE_RELOAD_CHECK`, 환경변수는 앱 시작 점검과 같은
 *   `AI_ENGINE_STARTUP_CHECK`)가 꺼져 있으면 붙지 않는다. e2e는 `createTestApp({ aiReloadCheck: true })`일 때만 켠다
 */
@Injectable()
export class AiEngineReloadCheck implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiEngineReloadCheck.name);
  private subscription: Subscription | null = null;
  private running: Promise<void> = Promise.resolve();

  constructor(
    @Inject(AI_ENGINE_RELOAD_CHECK) private readonly options: AiEngineReloadCheckOptions,
    private readonly events: ProgressEventsService,
    private readonly settings: SettingsService,
    private readonly query: AiCliCheckQueryService,
    private readonly recorder: AiCliCheckRecorder,
    private readonly lock: AiCliCheckLock,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    if (!this.options.enabled) return;
    this.subscription = this.events.stream().subscribe((event) => {
      if (event.name !== 'settings.reloaded') return;
      const data = event.data as SettingsReloadedEvent;
      this.running = this.running.then(async () => {
        try {
          await this.handle(data);
        } catch (error) {
          this.logger.error({ err: error }, '설정 다시 읽기 뒤 AI 엔진 점검을 마치지 못했습니다');
        }
      });
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  /** 진행 중인 점검이 끝날 때까지(테스트) */
  whenIdle(): Promise<void> {
    return this.running;
  }

  /** 알림 하나 처리. 점검을 돌렸으면 true */
  async handle(data: SettingsReloadedEvent): Promise<boolean> {
    if (!data.valid || data.settingsSnapshotId === null) return false;
    const ai = this.settings.currentOrNull()?.ai;
    if (!ai || !selectedEngineChanged(data.changedKeys, ai.engine)) return false;
    const engine = ai.engine;
    const textModel = ai.models[engine]?.text ?? null;
    if (textModel) {
      const since = this.clock.now().getTime() - AI_ENGINE_VERIFY_WINDOW_MS;
      if (await this.query.findRecentPass(engine, textModel, since)) return false;
    }
    const release = this.lock.tryAcquire();
    if (!release) {
      this.logger.warn('다른 AI 엔진 점검이 도는 중이라 설정 다시 읽기 뒤 점검을 건너뜁니다');
      return false;
    }
    try {
      await this.recorder.check([engine], {
        smokeTest: [engine],
        models: { [engine]: textModel },
        trigger: 'STARTUP',
      });
    } finally {
      release();
    }
    this.logger.log(`설정 다시 읽기로 선택 엔진이 바뀌어 ${engine} 연결 테스트를 했습니다`);
    return true;
  }
}
