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
    TZ: '',
  };

  it('허용 목록 안의 값만 넘기고 과금 키·허용 밖·빈 값은 넘기지 않는다', () => {
    const env = buildAiCliEnv('agy', parent);
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
    expect(buildAiCliEnv('claude', parent)).not.toHaveProperty('ANTHROPIC_API_KEY');
  });
});
