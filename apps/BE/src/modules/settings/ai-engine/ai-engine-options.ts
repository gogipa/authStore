import {
  AI_ENGINE_BINARY,
  AI_ENGINE_LABEL,
} from '../../integrations/ai-engine/ai-engine.constants.js';
import { AI_ENGINE_CODES, type AiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';
import type { AiCliBinary } from '../../integrations/ai-engine/cli-isolation.js';
import type { AiEngineModelPair } from '../schema/settings.types.js';

/**
 * 엔진별 고정 안내(05-2 AiEngineOption, P1-11 규칙 2, PRD §8.9 R12·R14, F-ST-30·F-ST-32). 비밀 없는 앱 상수다.
 * 로그인 명령 안내는 문자열 상수이고 CLI를 실행해 만든 값이 아니다(§8 주의). AGY 모델 목록만 `agy models` 결과로 채운다.
 */
export interface AiEngineOption {
  engineCode: AiEngineCode;
  displayName: string;
  binName: AiCliBinary;
  /** 고를 수 있는 모델. CLAUDE 별칭 3개, AGY `agy models`의 gemini-* (없으면 기본 모델), CODEX 빈 목록(직접 입력) */
  modelOptions: string[];
  /** 목록 밖 모델을 직접 입력할 수 있는지(CODEX만) */
  allowCustomModel: boolean;
  defaultModels: AiEngineModelPair;
  loginCommand: string;
  termsNote: string;
  /** M0 S7 기준(스키마 통과율 ≥ 95%, 호출당 ≤ 120초)에 못 미쳤거나 아직 재지 않은 엔진(Proposed P1-11) */
  experimental: boolean;
}

/** claude 모델 별칭(R12). `--model`에 그대로 넣는다 */
export const CLAUDE_MODEL_OPTIONS: readonly string[] = ['sonnet', 'opus', 'haiku'];

/**
 * 엔진별 기본 텍스트·비전 모델(규칙 2). CLAUDE `sonnet`/`sonnet`과 AGY `gemini-3.8-flash-medium`/`gemini-3.8-flash-high`는
 * M0 S7(2026-10-01)에서 그대로 확정했다(agy 비전 실패는 모델이 아니라 도구 권한 문제). CODEX는 미설치로 재지 못해 null.
 * 설정 파일 기본 템플릿의 ai 섹션은 CLAUDE sonnet/sonnet만 채운다(PRD §8.9 R3) — 화면은 비어 있는 모델 칸에 이 값을 먼저 보인다.
 */
export const AI_ENGINE_DEFAULT_MODELS: Readonly<Record<AiEngineCode, AiEngineModelPair>> = {
  CLAUDE: { text: 'sonnet', vision: 'sonnet' },
  AGY: { text: 'gemini-3.8-flash-medium', vision: 'gemini-3.8-flash-high' },
  CODEX: { text: null, vision: null },
};

/**
 * '실험적' 표시(F-ST-27, PRD §8.9 R15). M0 S7(2026-10-01, 기준: 스키마 통과율 ≥ 95%, 호출당 ≤ 120초) 결과:
 * - CLAUDE 통과(50/50, 최대 44.5초) → false
 * - AGY 미달(43/50 = 86%, 비전 3/10 — headless 도구 권한 거부) → true. 이유는 결과 품질뿐이다(D-18, 2026-10-02 —
 *   오너 본인 사용의 약관 위험은 '중'이고 오너가 받아들였다. 원천자료 09)
 * - CODEX 미설치로 재지 못함 → true 유지
 */
export const AI_ENGINE_EXPERIMENTAL: Readonly<Record<AiEngineCode, boolean>> = {
  CLAUDE: false,
  AGY: true,
  CODEX: true,
};

/** 로그인 방법(05-2 loginCommand, 시안 AiEngine.dc.html) */
export const AI_ENGINE_LOGIN_COMMAND: Readonly<Record<AiEngineCode, string>> = {
  CLAUDE: 'claude 실행 후 /login',
  AGY: '처음 실행할 때 로그인 창이 뜹니다',
  CODEX: 'npm install -g @openai/codex 다음 codex login',
};

/**
 * 엔진별 약관·쿼터 고지(R14). M0 S6 약관 §8 문구(엔진마다 약관 문장이 다르다). 오너 본인 사용의 위험은 세 엔진 모두 '중'이다
 * (agy는 D-18로 '상' → '중': 'OAuth를 빌려 쓰는 제3자 소프트웨어' 금지는 공식 agy를 본인 로그인으로 부르는 이 앱에 해당하지 않는다).
 * AGY 문구의 '실험적'은 결과 품질 이유(S7)를 밝히는 말이고, 사용자 MCP·규칙·플러그인을 끌 수 없다는 S6 격리 결과를 덧붙였다.
 */
export const AI_ENGINE_TERMS_NOTE: Readonly<Record<AiEngineCode, string>> = {
  CLAUDE:
    '본인 Claude 구독 한도를 씁니다. 대량·상시 사용은 Anthropic 약관상 제한될 수 있고, 계정 책임은 본인에게 있습니다.',
  AGY: '실험적(결과 품질 기준 미달). 본인 Google 계정 한도를 쓰며, Google 약관과 계정 책임은 본인에게 있습니다. 사용자 MCP·규칙·플러그인도 함께 켜집니다(끌 수 없음).',
  CODEX: '본인 ChatGPT 플랜 한도를 씁니다. OpenAI 약관과 계정 책임은 본인에게 있습니다.',
};

/** 목록 밖 모델 직접 입력 허용(CODEX만, R12) */
export const AI_ENGINE_ALLOW_CUSTOM_MODEL: Readonly<Record<AiEngineCode, boolean>> = {
  CLAUDE: false,
  AGY: false,
  CODEX: true,
};

/** 모델 ID 길이 상한(05-2 AiEngineModelPair maxLength) */
export const AI_MODEL_MAX_LENGTH = 100;

/**
 * AGY에서 고를 수 있는 모델: Google 모델(`gemini-*`)만. agy에서 제3자 모델(`claude-*`·`gpt-oss-*`)을 고르면 그 모델 약관을 따르고
 * Anthropic 모델은 상업 약관 동의로 본다(M0 S6 약관 §6 #7, Antigravity 약관). 저장된 값이 목록 밖이어도 같은 값 재저장은 막지 않는다.
 */
export const AGY_ALLOWED_MODEL = /^gemini-/i;

/**
 * AGY 모델 목록(Proposed P1-11): `agy models` 캐시의 `gemini-*`가 있으면 그것, 받은 적이 없으면(미설치·실패) 기본 텍스트·비전 모델.
 * 화면 목록과 저장·연결 테스트 검사가 같은 목록을 쓴다.
 */
export function agyModelOptions(listed: readonly string[] | null): string[] {
  const allowed = (listed ?? []).filter((m) => AGY_ALLOWED_MODEL.test(m));
  if (allowed.length > 0) return allowed;
  const { text, vision } = AI_ENGINE_DEFAULT_MODELS.AGY;
  return [...new Set([text, vision].filter((m): m is string => m !== null))];
}

/** 엔진의 고를 수 있는 모델 */
export function modelOptionsOf(
  engine: AiEngineCode,
  agyListed: readonly string[] | null,
): string[] {
  if (engine === 'CLAUDE') return [...CLAUDE_MODEL_OPTIONS];
  if (engine === 'AGY') return agyModelOptions(agyListed);
  return [];
}

/** 엔진 3개 안내(CLAUDE·AGY·CODEX 순서) */
export function buildAiEngineOptions(agyListed: readonly string[] | null): AiEngineOption[] {
  return AI_ENGINE_CODES.map((engineCode) => ({
    engineCode,
    displayName: AI_ENGINE_LABEL[engineCode],
    binName: AI_ENGINE_BINARY[engineCode],
    modelOptions: modelOptionsOf(engineCode, agyListed),
    allowCustomModel: AI_ENGINE_ALLOW_CUSTOM_MODEL[engineCode],
    defaultModels: { ...AI_ENGINE_DEFAULT_MODELS[engineCode] },
    loginCommand: AI_ENGINE_LOGIN_COMMAND[engineCode],
    termsNote: AI_ENGINE_TERMS_NOTE[engineCode],
    experimental: AI_ENGINE_EXPERIMENTAL[engineCode],
  }));
}
