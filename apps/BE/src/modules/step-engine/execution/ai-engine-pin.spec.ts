import { ApiException } from '../../../common/errors/api.exception.js';
import type { PinnedAiContext } from '../../integrations/ai-engine/ai-executor.types.js';
import { STEP_INPUT_SPECS } from '../domain/step-graph.js';
import { pinAiEngine, pinnedAiFromRun } from './ai-engine-pin.js';

const prepared: PinnedAiContext = {
  engine: 'CLAUDE',
  textModel: 'sonnet',
  visionModel: 'opus',
  cliVersion: '2.1.269',
  settingsSnapshotId: 3,
};

describe('AI 엔진 고정(P1-10 규칙 10)', () => {
  it('ai_model = 단계 주 작업 종류의 모델(없으면 TEXT). 버전은 감지 값', () => {
    expect(pinAiEngine({}, prepared).fix).toEqual({
      aiEngine: 'CLAUDE',
      aiModel: 'sonnet',
      aiCliVersion: '2.1.269',
    });
    expect(pinAiEngine({ aiModelKind: 'VISION' }, prepared).fix.aiModel).toBe('opus');
    expect(pinAiEngine({}, { ...prepared, cliVersion: null }).fix.aiCliVersion).toBeNull();
    expect(pinAiEngine({}, prepared).context).toEqual(prepared);
  });

  it('주 작업 모델이 설정에 없으면 409 AI_ENGINE_UNAVAILABLE(reason MODEL_NOT_SET, Proposed)', () => {
    try {
      pinAiEngine({ aiModelKind: 'VISION' }, { ...prepared, engine: 'CODEX', visionModel: null });
      throw new Error('통과하면 안 된다');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      expect((error as ApiException).details).toEqual({
        engineCode: 'CODEX',
        reason: 'MODEL_NOT_SET',
        settingsPath: '/settings/ai-engine',
      });
    }
  });

  it('이어 가기: step_run 열(엔진·주 모델·버전) + 그 실행의 설정 스냅샷 모델, 현재 설정은 읽지 않는다', () => {
    const run = {
      id: 9,
      candidateId: 2,
      aiEngine: 'AGY',
      aiModel: 'gemini-3.8-flash-medium',
      aiCliVersion: '1.2.9',
      settingsSnapshotId: 4,
    };
    const content = {
      ai: {
        engine: 'CLAUDE',
        models: { AGY: { text: 'gemini-x', vision: 'gemini-3.8-flash-high' } },
      },
    };
    expect(pinnedAiFromRun(run, content, {})).toEqual({
      fix: { aiEngine: 'AGY', aiModel: 'gemini-3.8-flash-medium', aiCliVersion: '1.2.9' },
      context: {
        engine: 'AGY',
        textModel: 'gemini-3.8-flash-medium',
        visionModel: 'gemini-3.8-flash-high',
        cliVersion: '1.2.9',
        settingsSnapshotId: 4,
      },
    });
    expect(pinnedAiFromRun({ ...run, aiEngine: null, aiModel: null }, content, {})).toBeNull();
  });

  it('ai.* 설정 키는 어떤 단계의 입력 지문에도 들어가지 않는다(R9)', () => {
    const keys = Object.values(STEP_INPUT_SPECS).flatMap((specs) => specs.map((s) => s.inputKey));
    expect(keys.filter((k) => k === 'settings.ai' || k.startsWith('settings.ai.'))).toEqual([]);
  });
});
