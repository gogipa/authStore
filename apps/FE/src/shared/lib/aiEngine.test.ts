import { describe, expect, it } from 'vitest';
import { AI_ENGINE_SETTINGS_PATH, aiGeneratedLabel, isAiEngineUnavailableCode } from './aiEngine';

describe('aiEngine(P1-10, F-BS-75·76)', () => {
  it("aiGeneratedLabel: 'AI 생성 · <엔진 이름>'", () => {
    expect(aiGeneratedLabel('CLAUDE')).toBe('AI 생성 · Claude Code');
    expect(aiGeneratedLabel('AGY')).toBe('AI 생성 · Antigravity CLI');
    expect(aiGeneratedLabel('CODEX')).toBe('AI 생성 · Codex');
    expect(aiGeneratedLabel(null)).toBe('AI 생성');
  });

  it('설정 경로와 링크를 붙일 코드', () => {
    expect(AI_ENGINE_SETTINGS_PATH).toBe('/settings/ai-engine');
    expect(isAiEngineUnavailableCode('AI_ENGINE_UNAVAILABLE')).toBe(true);
    expect(isAiEngineUnavailableCode('AI_OUTPUT_INVALID')).toBe(false);
    expect(isAiEngineUnavailableCode(null)).toBe(false);
  });
});
