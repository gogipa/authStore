import type { components } from '@/shared/api/schema';

/** AI 엔진 코드(05-2 AiEngineCode, D-16) */
export type AiEngineCode = components['schemas']['AiEngineCode'];

/** 엔진 화면 이름(05-2 AiEngineOption.displayName, PRD §8.9 R11) */
export const AI_ENGINE_LABEL: Readonly<Record<AiEngineCode, string>> = {
  CLAUDE: 'Claude Code',
  AGY: 'Antigravity CLI',
  CODEX: 'Codex',
};

/** 'AI 엔진' 설정 화면(SCR-13, R4). 409 AI_ENGINE_UNAVAILABLE의 details.settingsPath와 같다 */
export const AI_ENGINE_SETTINGS_PATH = '/settings/ai-engine';

/** 선택 엔진을 쓸 수 없음(시작 409 code·실행 기록 errorCode, F-BS-76) */
export const AI_ENGINE_UNAVAILABLE_CODE = 'AI_ENGINE_UNAVAILABLE';

/** 'AI 엔진 설정으로' 링크 글(F-BS-76, SCR-12) */
export const AI_ENGINE_SETTINGS_LINK_TEXT = 'AI 엔진 설정으로';

/** 'AI 생성 · Claude Code'(F-BS-75, R11). 엔진을 모르면 'AI 생성' */
export function aiGeneratedLabel(engine: AiEngineCode | null | undefined): string {
  return engine ? `AI 생성 · ${AI_ENGINE_LABEL[engine]}` : 'AI 생성';
}

/** 이 오류 코드가 'AI 엔진 설정으로' 링크를 붙일 코드인가 */
export function isAiEngineUnavailableCode(code: string | null | undefined): boolean {
  return code === AI_ENGINE_UNAVAILABLE_CODE;
}
