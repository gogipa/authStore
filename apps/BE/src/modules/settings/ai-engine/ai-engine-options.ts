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
  /** 고를 수 있는 모델. CLAUDE 별칭 3개, AGY `agy models`(없으면 기본 모델), CODEX 빈 목록(직접 입력) */
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
 * 엔진별 기본 텍스트·비전 모델(규칙 2). AGY는 M0 S7에서 확정할 때까지 시안 값, CODEX는 정하지 않음(null).
 * 설정 파일 기본 템플릿의 ai 섹션은 CLAUDE sonnet/sonnet만 채운다(PRD §8.9 R3) — 화면은 비어 있는 모델 칸에 이 값을 먼저 보인다.
 */
export const AI_ENGINE_DEFAULT_MODELS: Readonly<Record<AiEngineCode, AiEngineModelPair>> = {
  CLAUDE: { text: 'sonnet', vision: 'sonnet' },
  AGY: { text: 'gemini-3.8-flash-medium', vision: 'gemini-3.8-flash-high' },
  CODEX: { text: null, vision: null },
};

/**
 * '실험적' 표시(F-ST-27, PRD §8.9 R15). Proposed(P1-11): M0 S7 측정값이 없어 앱 상수로 둔다. S7 전에는 설치·로그인도
 * 확인하지 못한 CODEX만 true(README 'codex는 fixture로만 검증, 페이지에 실험적 표시 가능'). S7 결과가 오면 여기만 고친다.
 */
export const AI_ENGINE_EXPERIMENTAL: Readonly<Record<AiEngineCode, boolean>> = {
  CLAUDE: false,
  AGY: false,
  CODEX: true,
};

/** 로그인 방법(05-2 loginCommand, 시안 AiEngine.dc.html) */
export const AI_ENGINE_LOGIN_COMMAND: Readonly<Record<AiEngineCode, string>> = {
  CLAUDE: 'claude 실행 후 /login',
  AGY: '처음 실행할 때 로그인 창이 뜹니다',
  CODEX: 'npm install -g @openai/codex 다음 codex login',
};

/** 약관·쿼터 책임 한 줄(R14) */
export const AI_ENGINE_TERMS_NOTE: Readonly<Record<AiEngineCode, string>> = {
  CLAUDE: 'Claude 구독의 약관·쿼터 책임은 사용자에게 있습니다.',
  AGY: 'Google 구독의 약관·쿼터 책임은 사용자에게 있습니다.',
  CODEX: 'ChatGPT 구독의 약관·쿼터 책임은 사용자에게 있습니다.',
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
 * AGY 모델 목록(Proposed P1-11): `agy models` 캐시가 있으면 그것, 받은 적이 없으면(미설치·실패) 기본 텍스트·비전 모델.
 * 화면 목록과 저장·연결 테스트 검사가 같은 목록을 쓴다.
 */
export function agyModelOptions(listed: readonly string[] | null): string[] {
  if (listed && listed.length > 0) return [...listed];
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
