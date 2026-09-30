import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  AGY_USER_MCP_DISABLE_KNOWN,
  AI_ENGINE_LABEL,
} from '../../integrations/ai-engine/ai-engine.constants.js';
import { AI_ENGINE_CODES } from '../../integrations/ai-engine/ai-engine.port.js';
import { SettingsService } from '../../settings/settings.service.js';
import { AiCliCheckLock } from './ai-cli-check.lock.js';
import { AiCliCheckRecorder } from './ai-cli-check.recorder.js';
import { DEFAULT_AI_ENGINE } from './ai-cli-checks.service.js';

/** 앱 시작 점검 스위치(테스트는 DI로 끈다, 운영·개발은 환경변수 AI_ENGINE_STARTUP_CHECK) */
export interface AiEngineStartupCheckOptions {
  enabled: boolean;
}

export const AI_ENGINE_STARTUP_CHECK = Symbol('AI_ENGINE_STARTUP_CHECK');

/**
 * 앱 시작 점검(P1-10 규칙 13, F-BS-67, PRD §8.9 R7·버전). `OnApplicationBootstrap`에서 **기다리지 않고** 돈다:
 * 세 엔진 감지(`--version`·경로·로그인, 비용 없음) → 선택 엔진만 텍스트 모델로 계약 테스트 1회 → 엔진마다 ai_cli_check
 * 1행(trigger=STARTUP) + SSE. agy처럼 스스로 업데이트되는 CLI의 변화를 켤 때마다 잡는다.
 * 선택 엔진이 agy이고 사용자 MCP를 끄는 방법이 확인되지 않았으면(M0 S6) 경고를 남긴다(기록 자리가 없어 앱 로그, Proposed).
 * e2e는 AppModule을 띄우므로 `AI_ENGINE_STARTUP_CHECK`를 `{ enabled: false }`로 바꾸고 어댑터를 가짜로 끼운다(§8 주의).
 * P1-11: 점검하는 동안 `POST /ai-cli-checks`와 같은 메모리 잠금(`AiCliCheckLock`)을 잡는다(그동안 POST는 409 ALREADY_IN_PROGRESS,
 * Proposed). 잠금이 이미 잡혀 있으면(드묾) 잠금 없이 돈다 — CLI 호출은 기록기가 한 번에 하나씩 부른다.
 */
@Injectable()
export class AiEngineStartupCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiEngineStartupCheck.name);
  private running: Promise<void> | null = null;

  constructor(
    @Inject(AI_ENGINE_STARTUP_CHECK) private readonly options: AiEngineStartupCheckOptions,
    private readonly settings: SettingsService,
    private readonly recorder: AiCliCheckRecorder,
    private readonly lock: AiCliCheckLock,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.options.enabled) {
      this.logger.log('앱 시작 AI 엔진 점검을 껐습니다(AI_ENGINE_STARTUP_CHECK=off).');
      return;
    }
    this.running = this.run().catch((error: unknown) => {
      this.logger.error({ err: error }, '앱 시작 AI 엔진 점검을 마치지 못했습니다');
    });
  }

  /** 진행 중인 시작 점검(테스트가 기다린다). 없으면 곧바로 끝난 promise */
  whenDone(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  /** 점검 1회(선택 엔진 = 설정 ai.engine, 없으면 기본 CLAUDE) */
  async run(): Promise<void> {
    // 설정 시작 검사(SettingsService.onApplicationBootstrap)가 먼저 끝나야 선택 엔진을 안다
    await new Promise<void>((resolve) => setImmediate(resolve));
    await this.settings.whenIdle();
    const settings = this.settings.currentOrNull();
    const engine = settings?.ai.engine ?? DEFAULT_AI_ENGINE;
    const textModel = settings?.ai.models[engine]?.text ?? null;
    if (engine === 'AGY' && !AGY_USER_MCP_DISABLE_KNOWN) {
      this.logger.warn(
        `선택 엔진 ${AI_ENGINE_LABEL.AGY}: 사용자 MCP를 끄는 방법이 아직 확인되지 않았습니다(M0 S6). 사용자 MCP가 함께 올라올 수 있습니다.`,
      );
    }
    const release = this.lock.tryAcquire();
    const rows = await this.recorder
      .check(AI_ENGINE_CODES, {
        smokeTest: [engine],
        models: { [engine]: textModel },
        trigger: 'STARTUP',
      })
      .finally(() => release?.());
    const selected = rows.find((row) => row.engineCode === engine);
    this.logger.log(
      `앱 시작 AI 엔진 점검: 선택 ${engine} ${selected?.smokeStatus ?? '?'}${selected?.errorCode ? `(${selected.errorCode})` : ''}`,
    );
  }
}
