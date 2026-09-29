/**
 * AI 엔진 포트(D-16, PRD §8.9 'AI 엔진 선택', 03-2 §3).
 * 구현(ClaudeCodeAdapter·AgyAdapter·CodexAdapter)은 아직 없다. 이미지 생성 포트(ImageGenProvider)와 섞지 않는다.
 * 시그니처 원본: AiEngineAdapter { code, detect(), authStatus(), smokeTest(model),
 *                runStructured(task, schema, inputs, {model, timeoutMs}) }
 * 아래 결과 타입의 필드는 ai_cli_check(ERD v0.4)·05-2 AiCliCheck에서 가져왔다. 입력 타입은 Proposed(D-11).
 */

/** 엔진 코드(DB·API·설정 공통, 표시 순서) */
export const AI_ENGINE_CODES = ['CLAUDE', 'AGY', 'CODEX'] as const;
export type AiEngineCode = (typeof AI_ENGINE_CODES)[number];

export function isAiEngineCode(value: unknown): value is AiEngineCode {
  return typeof value === 'string' && (AI_ENGINE_CODES as readonly string[]).includes(value);
}

/** detect(): `--version`·실행 파일 경로 확인(호출 비용 없음, R6) */
export interface AiEngineDetection {
  installed: boolean;
  binPath: string | null;
  cliVersion: string | null;
  /** 지원 버전 범위(P-13) 안인지. 설치 안 됨이면 null */
  versionSupported: boolean | null;
}

/** authStatus(): claude auth status·codex login status. agy는 UNKNOWN(R6). 로그인 정보·토큰은 읽지 않는다(CON-11) */
export type AiEngineAuthStatus = 'OK' | 'NOT_LOGGED_IN' | 'UNKNOWN';

/** smokeTest(model): 'OK' 한 단어를 스키마로 받는 호출 1회(R7, AI-07) */
export interface AiEngineSmokeResult {
  status: 'PASSED' | 'FAILED';
  model: string;
  latencyMs: number;
  errorCode: string | null;
  /** 한국어 안내(비밀정보 없음) */
  errorMessage: string | null;
}

/** 스키마 규칙: draft-07 공통 부분집합, additionalProperties:false, 모든 필드 required(AI-02) */
export type AiJsonSchema = Record<string, unknown>;

/** Proposed: 엔진에 넘길 입력. 비전 작업은 이미지 전용 디렉터리의 파일만 넘긴다 */
export interface AiEngineInputs {
  prompt: string;
  imagePaths?: readonly string[];
}

export interface AiRunOptions {
  /** `--model`은 항상 명시한다(AI-01) */
  model: string;
  /** 텍스트 120s, 비전 180s(AI-03) */
  timeoutMs: number;
}

export interface AiStructuredResult<T> {
  /** 앱에서 다시 검증(Ajv)한 결과(AI-02) */
  output: T;
  model: string;
  cliVersion: string | null;
  latencyMs: number;
}

export interface AiEngineAdapter {
  readonly code: AiEngineCode;
  detect(): Promise<AiEngineDetection>;
  authStatus(): Promise<AiEngineAuthStatus>;
  smokeTest(model: string): Promise<AiEngineSmokeResult>;
  /**
   * @param task 작업 식별자(예: 요구사항 ID 'CT-01'). 캐시 키·로그에 쓴다
   * @param schema 결과 JSON 스키마
   */
  runStructured<T>(
    task: string,
    schema: AiJsonSchema,
    inputs: AiEngineInputs,
    options: AiRunOptions,
  ): Promise<AiStructuredResult<T>>;
}

/** 어댑터 목록 주입 토큰(엔진 3개). 실행기가 설정의 선택 엔진으로 하나를 고른다 */
export const AI_ENGINE_ADAPTERS = Symbol('AI_ENGINE_ADAPTERS');
