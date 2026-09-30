import { AI_CLI_ENV_ALLOWLIST, AI_CLI_FORBIDDEN_ENV, type AiCliBinary } from '../cli-isolation.js';

/** claude 자동 업데이트 끄기(PRD §8.9 '버전', F-BS-29). 하위 프로세스 환경변수로만 끈다 */
export const CLAUDE_AUTOUPDATE_ENV = { DISABLE_AUTOUPDATER: '1' } as const;

/**
 * 자식 프로세스 환경변수(규칙 3). 허용 목록(`AI_CLI_ENV_ALLOWLIST`, 06-2 §9-16 Proposed)에 있는 부모 값만 넘긴다.
 * - `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`는 부모에 있어도 넘기지 않는다(구독 대신 API 과금, R14)
 * - `claude`만 `DISABLE_AUTOUPDATER=1`을 더한다. 다른 CLI에는 부모 값이 있어도 넘기지 않는다
 * - 빈 값·undefined는 넘기지 않는다
 */
export function buildAiCliEnv(
  bin: AiCliBinary,
  parent: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of AI_CLI_ENV_ALLOWLIST) {
    if ((AI_CLI_FORBIDDEN_ENV as readonly string[]).includes(key)) continue;
    if (key === 'DISABLE_AUTOUPDATER') continue;
    const value = parent[key];
    if (typeof value === 'string' && value.length > 0) env[key] = value;
  }
  if (bin === 'claude') Object.assign(env, CLAUDE_AUTOUPDATE_ENV);
  return env;
}
