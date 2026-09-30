import { Injectable } from '@nestjs/common';
import type { PinnedAiContext } from '../../integrations/ai-engine/ai-executor.types.js';
import { AiExecutor } from '../../integrations/ai-engine/ai-executor.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { AiEngineAvailabilityService } from '../../system/ai-cli-checks/ai-engine-availability.service.js';
import type { AiEngineResolver } from '../ports/ai-engine-resolver.port.js';

/**
 * 선택 엔진 준비(P1-10 규칙 10·11, AI_ENGINE_RESOLVER 구현). 트랜잭션 밖에서 부른다.
 * 1. 현재 설정(`SettingsService`)의 `ai.engine`·`ai.models[engine]`과 그 스냅샷 id(없으면 503 SETTINGS_INVALID)
 * 2. system의 사용 가능 판정(최신 ai_cli_check) — 쓸 수 없으면 409 AI_ENGINE_UNAVAILABLE
 * 3. `--version` 감지(AiExecutor.detectVersion, 실패하면 null)
 */
@Injectable()
export class SelectedAiEngineResolver implements AiEngineResolver {
  constructor(
    private readonly settings: SettingsService,
    private readonly availability: AiEngineAvailabilityService,
    private readonly executor: AiExecutor,
  ) {}

  async prepare(): Promise<PinnedAiContext> {
    const settings = this.settings.current();
    const settingsSnapshotId = this.settings.currentSnapshotId();
    const engine = settings.ai.engine;
    const pair = settings.ai.models[engine];
    await this.availability.assertUsable(engine);
    const cliVersion = await this.executor.detectVersion(engine);
    return {
      engine,
      textModel: pair?.text ?? null,
      visionModel: pair?.vision ?? null,
      cliVersion,
      settingsSnapshotId,
    };
  }
}
