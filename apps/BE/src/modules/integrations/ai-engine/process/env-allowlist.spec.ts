import { AI_CLI_ENV_ALLOWLIST } from '../cli-isolation.js';
import { buildAiCliEnv } from './env-allowlist.js';

describe('buildAiCliEnv(P1-10 규칙 3, F-BS-27·29)', () => {
  const parent = {
    PATH: '/usr/bin:/bin',
    HOME: '/Users/someone',
    LANG: 'ko_KR.UTF-8',
    ANTHROPIC_API_KEY: 'x',
    OPENAI_API_KEY: 'y',
    NODE_OPTIONS: '--inspect',
    DATABASE_URL: 'postgresql://localhost/db',
    DISABLE_AUTOUPDATER: '0',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '0',
    CODEX_API_KEY: 'c',
    GEMINI_API_KEY: 'g',
    AGY_CLI_DISABLE_AUTO_UPDATE: '0',
    TZ: '',
  };

  it('허용 목록 안의 값만 넘기고 과금 키·허용 밖·빈 값은 넘기지 않는다', () => {
    const env = buildAiCliEnv('codex', parent);
    expect(env).toEqual({ PATH: '/usr/bin:/bin', HOME: '/Users/someone', LANG: 'ko_KR.UTF-8' });
    for (const key of Object.keys(env)) {
      expect(AI_CLI_ENV_ALLOWLIST as readonly string[]).toContain(key);
    }
  });

  it('claude만 DISABLE_AUTOUPDATER=1(부모 값과 관계없이), codex·agy에는 넘기지 않는다', () => {
    expect(buildAiCliEnv('claude', parent).DISABLE_AUTOUPDATER).toBe('1');
    expect(buildAiCliEnv('claude', {}).DISABLE_AUTOUPDATER).toBe('1');
    expect(buildAiCliEnv('codex', parent)).not.toHaveProperty('DISABLE_AUTOUPDATER');
    expect(buildAiCliEnv('agy', parent)).not.toHaveProperty('DISABLE_AUTOUPDATER');
    expect(buildAiCliEnv('codex', parent)).not.toHaveProperty('OPENAI_API_KEY');
    expect(buildAiCliEnv('codex', parent)).not.toHaveProperty('CODEX_API_KEY');
    expect(buildAiCliEnv('agy', parent)).not.toHaveProperty('GEMINI_API_KEY');
    expect(buildAiCliEnv('claude', parent)).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('M0 S6: claude만 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1(세션 제목용 haiku 호출 끄기), 부모 값은 쓰지 않는다', () => {
    expect(buildAiCliEnv('claude', parent).CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    expect(buildAiCliEnv('claude', {}).CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    expect(buildAiCliEnv('agy', parent)).not.toHaveProperty(
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    );
    expect(buildAiCliEnv('codex', parent)).not.toHaveProperty(
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    );
  });

  it("M0 S1: agy만 AGY_CLI_DISABLE_AUTO_UPDATE='true'('1'은 무시됨 — 실측), 부모 값은 쓰지 않는다", () => {
    expect(buildAiCliEnv('agy', parent)).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: '/Users/someone',
      LANG: 'ko_KR.UTF-8',
      AGY_CLI_DISABLE_AUTO_UPDATE: 'true',
    });
    expect(buildAiCliEnv('agy', {}).AGY_CLI_DISABLE_AUTO_UPDATE).toBe('true');
    expect(buildAiCliEnv('claude', parent)).not.toHaveProperty('AGY_CLI_DISABLE_AUTO_UPDATE');
    expect(buildAiCliEnv('codex', parent)).not.toHaveProperty('AGY_CLI_DISABLE_AUTO_UPDATE');
  });
});
