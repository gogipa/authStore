import { Inject, Injectable } from '@nestjs/common';
import { UserActionLogService } from '../../../common/audit/user-action-log.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { AgyModelsProvider } from '../../integrations/ai-engine/agy-models.provider.js';
import { AI_ENGINE_LABEL } from '../../integrations/ai-engine/ai-engine.constants.js';
import { AI_ENGINE_CODES, type AiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import {
  AI_ENGINE_VERIFY_WINDOW_MS,
  AiCliCheckQueryService,
} from '../../system/ai-cli-checks/ai-cli-check.query.js';
import type { AiEngineModelPair, AiSettings } from '../schema/settings.types.js';
import { canonicalJson } from '../settings-file.loader.js';
import { SettingsService } from '../settings.service.js';
import { buildAiEngineOptions } from './ai-engine-options.js';
import type { AiEngineSettingsDto } from './ai-engine-settings.dto.js';
import { aiModelInvalidException, validateAiModels } from './ai-model.validator.js';

/** 감사 기록 detail.setting(user_action_log SETTING_CHANGED, P1-09 프로필과 같은 모양 — Proposed) */
export const AI_ENGINE_AUDIT_SETTING = 'AI_ENGINE';

/** PUT 본문(형식 검사를 지난 값) */
export interface AiEngineSettingsInput {
  selectedEngine: AiEngineCode;
  models: Readonly<Record<AiEngineCode, AiEngineModelPair>>;
}

/** 본문 모델을 설정 모양으로(엔진 3개·text·vision만 — DTO 인스턴스의 다른 속성을 옮기지 않는다) */
function toAiSettings(input: AiEngineSettingsInput): AiSettings {
  const models = {} as Record<AiEngineCode, AiEngineModelPair>;
  for (const engine of AI_ENGINE_CODES) {
    const pair = input.models[engine];
    models[engine] = { text: pair.text, vision: pair.vision };
  }
  return { engine: input.selectedEngine, models };
}

/**
 * AI 엔진 설정(SCR-13, F-ST-27·30·31·32, D-16). 원본은 설정 JSON `ai` 섹션이고 DB 테이블은 없다(규칙 1).
 *
 * 저장 순서(PUT, Proposed — 규칙 5): 본문 형식(전역 ValidationPipe, 422 VALIDATION_FAILED) → 로드된 설정(503 SETTINGS_INVALID)
 * → 모델 검사(422 AI_MODEL_INVALID) → 같은 값이면 200 + 현재 설정(스냅샷·SSE 없음) → 10분 조건(409 AI_ENGINE_NOT_VERIFIED)
 * → `ai` 섹션 원자적 쓰기 → 새 스냅샷 + 감사 기록(한 트랜잭션) → SSE `settings.reloaded`(rerunRequiredStepCount 0) → 200.
 * 10분은 `ai_cli_check.checked_at`을 찍는 것과 같은 주입 시계(CLOCK)로 계산한다(§8 주의).
 * 저장해도 어떤 단계도 재실행 필요가 되지 않는다(ai.* 키는 전파에서 뺀다, 규칙 6). 진행 중 실행은 시작 때 고정한 엔진으로 끝난다(P1-10).
 */
@Injectable()
export class AiEngineSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly checks: AiCliCheckQueryService,
    private readonly agyModels: AgyModelsProvider,
    private readonly audit: UserActionLogService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** GET /settings/ai-engine(규칙 1): 설정 ai 섹션 + 엔진 안내 3개 + 현재 스냅샷 id·읽은 시각. 설치·로그인 상태는 넣지 않는다 */
  async get(): Promise<AiEngineSettingsDto> {
    const ai = this.settings.current().ai;
    const snapshotId = this.settings.currentSnapshotId();
    const [row, agyListed] = await Promise.all([
      this.prisma.settingsSnapshot.findUnique({ where: { id: snapshotId } }),
      this.agyModels.list(),
    ]);
    if (!row) throw new ApiException('SETTINGS_INVALID');
    return {
      selectedEngine: ai.engine,
      models: toAiSettings({ selectedEngine: ai.engine, models: ai.models }).models,
      engines: buildAiEngineOptions(agyListed),
      settingsSnapshotId: row.id,
      updatedAt: row.lastLoadedAt.toISOString(),
    };
  }

  /** PUT /settings/ai-engine(규칙 3·4·5) */
  async update(input: AiEngineSettingsInput): Promise<AiEngineSettingsDto> {
    const current = this.settings.current().ai;
    const next = toAiSettings(input);
    const errors = validateAiModels({
      selectedEngine: next.engine,
      models: next.models,
      current,
      agyListed: await this.agyModels.list(),
    });
    if (errors.length > 0) throw aiModelInvalidException(errors);
    if (canonicalJson(current) === canonicalJson(next)) return this.get();
    await this.assertVerified(next.engine, next.models[next.engine].text!);
    await this.settings.replaceAiSection(next, {
      inTransaction: async (tx, changedKeys) => {
        await this.audit.record(
          {
            eventType: 'SETTING_CHANGED',
            detail: { setting: AI_ENGINE_AUDIT_SETTING, changedKeys: [...changedKeys] },
          },
          tx,
        );
      },
    });
    return this.get();
  }

  /** 규칙 4: 선택 엔진·텍스트 모델로 10분 안에 PASSED가 없으면 409 AI_ENGINE_NOT_VERIFIED(details.engineCode·model) */
  private async assertVerified(engineCode: AiEngineCode, model: string): Promise<void> {
    const since = this.clock.now().getTime() - AI_ENGINE_VERIFY_WINDOW_MS;
    const pass = await this.checks.findRecentPass(engineCode, model, since);
    if (pass) return;
    throw new ApiException('AI_ENGINE_NOT_VERIFIED', {
      message: formatErrorMessage('AI_ENGINE_NOT_VERIFIED', {
        엔진: AI_ENGINE_LABEL[engineCode],
        모델: model,
      }),
      details: { engineCode, model },
    });
  }
}
