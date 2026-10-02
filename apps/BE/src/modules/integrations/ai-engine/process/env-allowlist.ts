import { AI_CLI_ENV_ALLOWLIST, AI_CLI_FORBIDDEN_ENV, type AiCliBinary } from '../cli-isolation.js';

/** claude 자동 업데이트 끄기(PRD §8.9 '버전', F-BS-29). 하위 프로세스 환경변수로만 끈다 */
export const CLAUDE_AUTOUPDATE_ENV = { DISABLE_AUTOUPDATER: '1' } as const;

/**
 * claude 부가 트래픽 끄기(M0 S6 §4.3). 본 호출과 따로 붙던 세션 제목용 haiku 호출(프롬프트 내용이 들어간다)이 사라진다 —
 * 텍스트 호출당 약 900토큰, 비전 약 1,800토큰이 준다. 텔레메트리·오류 보고·자동 업데이트도 함께 꺼진다.
 */
export const CLAUDE_NONESSENTIAL_TRAFFIC_ENV = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
} as const;

/** claude 자식에만 앱이 넣는 값(부모 값은 쓰지 않는다) */
export const CLAUDE_CHILD_ENV: Readonly<Record<string, string>> = {
  ...CLAUDE_AUTOUPDATE_ENV,
  ...CLAUDE_NONESSENTIAL_TRAFFIC_ENV,
};

/**
 * agy 자동 업데이트 끄기(M0 S1 2026-10-02 실측, agy 1.2.14). 값이 `'true'`일 때만 CLI 로그에
 * 'Auto-update disabled via environment variable AGY_CLI_DISABLE_AUTO_UPDATE'가 찍히고 업데이트 확인이 돌지 않았다.
 * `'1'`은 무시됐다(백그라운드 업데이트가 떴다). S7에서 측정 중 1.2.9 → 1.2.14로 바뀐 일을 막는다.
 */
export const AGY_CHILD_ENV: Readonly<Record<string, string>> = {
  AGY_CLI_DISABLE_AUTO_UPDATE: 'true',
};

/** CLI별로 앱이 넣는 값(이 키들은 부모 값을 쓰지 않는다) */
const APP_CHILD_ENV_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(CLAUDE_CHILD_ENV),
  ...Object.keys(AGY_CHILD_ENV),
]);

/**
 * 자식 프로세스 환경변수(규칙 3). 허용 목록(`AI_CLI_ENV_ALLOWLIST`, 06-2 §9-16 Proposed)에 있는 부모 값만 넘긴다.
 * - `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`·`CODEX_API_KEY`·`GEMINI_API_KEY`는 부모에 있어도 넘기지 않는다(구독 대신 API 과금, R14)
 * - `claude`만 `DISABLE_AUTOUPDATER=1`·`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`을, `agy`만 `AGY_CLI_DISABLE_AUTO_UPDATE=true`를
 *   더한다(M0 S1). 다른 CLI에는 부모 값이 있어도 넘기지 않는다
 * - 빈 값·undefined는 넘기지 않는다
 */
export function buildAiCliEnv(
  bin: AiCliBinary,
  parent: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of AI_CLI_ENV_ALLOWLIST) {
    if ((AI_CLI_FORBIDDEN_ENV as readonly string[]).includes(key)) continue;
    if (APP_CHILD_ENV_KEYS.has(key)) continue;
    const value = parent[key];
    if (typeof value === 'string' && value.length > 0) env[key] = value;
  }
  if (bin === 'claude') Object.assign(env, CLAUDE_CHILD_ENV);
  if (bin === 'agy') Object.assign(env, AGY_CHILD_ENV);
  return env;
}
