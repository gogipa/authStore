import { AgyAdapter } from './adapters/agy.adapter.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.adapter.js';
import { CodexAdapter } from './adapters/codex.adapter.js';
import type { AiEngineAdapter } from './ai-engine.port.js';
import { IsolatedCliRunner } from './process/isolated-cli-runner.js';

/**
 * 실제 AI CLI 확인(P1-10, 06-2 §9 Proposed). **기본으로 돌지 않는다** — `AI_CLI_LIVE=1`일 때만 이 PC의 진짜 CLI로
 * 감지·로그인 확인·연결 테스트('OK' 한 번)를 한다. 연결 테스트는 구독 쿼터를 쓴다. 엔진은 `AI_CLI_LIVE_ENGINES`
 * (쉼표, 기본 claude)와 `AI_CLI_LIVE_MODEL`(기본 엔진별 텍스트 모델)로 고른다.
 *   AI_CLI_LIVE=1 pnpm --filter @autostore/be test -- live-cli
 */
const LIVE = process.env.AI_CLI_LIVE === '1';
const ENGINES = (process.env.AI_CLI_LIVE_ENGINES ?? 'claude').split(',').map((s) => s.trim());
const MODELS: Record<string, string> = {
  claude: 'sonnet',
  agy: 'gemini-3.8-flash-medium',
  codex: process.env.AI_CLI_LIVE_MODEL ?? '',
};

(LIVE ? describe : describe.skip)('실제 AI CLI(AI_CLI_LIVE=1)', () => {
  const runner = new IsolatedCliRunner();
  const adapters: Record<string, AiEngineAdapter> = {
    claude: new ClaudeCodeAdapter(runner),
    agy: new AgyAdapter(runner),
    codex: new CodexAdapter(runner),
  };

  it.each(ENGINES)(
    '%s: 감지·로그인·연결 테스트',
    async (engine) => {
      const adapter = adapters[engine]!;
      const detection = await adapter.detect();
      expect(detection.installed).toBe(true);
      expect(['OK', 'UNKNOWN']).toContain(await adapter.authStatus());
      const smoke = await adapter.smokeTest(process.env.AI_CLI_LIVE_MODEL ?? MODELS[engine]!);
      expect(smoke).toMatchObject({ status: 'PASSED', errorCode: null });
    },
    150_000,
  );
});
