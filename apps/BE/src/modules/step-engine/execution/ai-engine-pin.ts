import { AI_ENGINE_SETTINGS_PATH } from '../../integrations/ai-engine/ai-engine.constants.js';
import { aiEngineUnavailableMessage } from '../../integrations/ai-engine/ai-engine.errors.js';
import { isAiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';
import type { PinnedAiContext } from '../../integrations/ai-engine/ai-executor.types.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import type { StepRun } from '../../../generated/prisma/client.js';
import type { AiEngineFix, StepAiModelKind, StepRunner } from '../contracts/step-runner.js';

/** 시작에 고정한 AI 값: step_run 열 + 실행 문맥 */
export interface PinnedAi {
  fix: AiEngineFix;
  context: PinnedAiContext;
}

/** 실행기의 주 작업 종류(없으면 TEXT) */
export function aiModelKindOf(runner: Pick<StepRunner, 'aiModelKind'>): StepAiModelKind {
  return runner.aiModelKind ?? 'TEXT';
}

/**
 * 준비한 선택 엔진을 이 단계에 고정한다(P1-10 규칙 10). `ai_model` = 단계 주 작업 종류의 모델.
 * 그 모델이 설정에 없으면 409 AI_ENGINE_UNAVAILABLE(reason MODEL_NOT_SET, Proposed) — step_run을 만들지 않는다.
 */
export function pinAiEngine(
  runner: Pick<StepRunner, 'aiModelKind'>,
  prepared: PinnedAiContext,
): PinnedAi {
  const kind = aiModelKindOf(runner);
  const model = kind === 'VISION' ? prepared.visionModel : prepared.textModel;
  if (!model || model.trim() === '') {
    throw new ApiException('AI_ENGINE_UNAVAILABLE', {
      message: aiEngineUnavailableMessage(prepared.engine, 'MODEL_NOT_SET'),
      details: {
        engineCode: prepared.engine,
        reason: 'MODEL_NOT_SET',
        settingsPath: AI_ENGINE_SETTINGS_PATH,
      },
    });
  }
  return {
    fix: {
      aiEngine: prepared.engine,
      aiModel: model.slice(0, 100),
      aiCliVersion: prepared.cliVersion?.slice(0, 40) ?? null,
    },
    context: {
      engine: prepared.engine,
      textModel: prepared.textModel,
      visionModel: prepared.visionModel,
      cliVersion: prepared.cliVersion,
      settingsSnapshotId: prepared.settingsSnapshotId,
    },
  };
}

function modelPairOf(
  content: unknown,
  engine: string,
): { text: string | null; vision: string | null } {
  const models = (content as { ai?: { models?: Record<string, unknown> } } | null)?.ai?.models;
  const pair = models?.[engine] as { text?: unknown; vision?: unknown } | undefined;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);
  return { text: str(pair?.text), vision: str(pair?.vision) };
}

/**
 * 이미 고정한 실행의 AI 문맥을 다시 만든다(입력 대기에서 이어 가기). 엔진·주 모델·버전은 step_run 열 그대로, 다른 종류의
 * 모델은 그 실행의 설정 스냅샷(`settings_snapshot.content.ai`)에서 읽는다. 현재 설정은 읽지 않는다(R9).
 */
export function pinnedAiFromRun(
  run: Pick<
    StepRun,
    'id' | 'candidateId' | 'aiEngine' | 'aiModel' | 'aiCliVersion' | 'settingsSnapshotId'
  >,
  snapshotContent: unknown,
  runner: Pick<StepRunner, 'aiModelKind'>,
): PinnedAi | null {
  if (!run.aiEngine || !run.aiModel || !isAiEngineCode(run.aiEngine)) return null;
  const pair = modelPairOf(snapshotContent, run.aiEngine);
  const kind = aiModelKindOf(runner);
  return {
    fix: { aiEngine: run.aiEngine, aiModel: run.aiModel, aiCliVersion: run.aiCliVersion },
    context: {
      engine: run.aiEngine,
      textModel: kind === 'TEXT' ? run.aiModel : pair.text,
      visionModel: kind === 'VISION' ? run.aiModel : pair.vision,
      cliVersion: run.aiCliVersion,
      settingsSnapshotId: run.settingsSnapshotId,
    },
  };
}
