import type { CallLogTarget } from '../http/external-targets.js';

/**
 * 썸네일 이미지 생성 포트(P3-02 §5.1, F-TH-07·09, PRD §8.4 공급자 표, AI-05·D-16 R13). ⑤ 생성 작업(thumbnails
 * `GenerationWorker`)은 이 포트로만 이미지 모델을 부른다. 선택 AI 엔진 어댑터(`AiEngineAdapter`, 텍스트·비전)와 섞지 않는다 —
 * 공급자 선택은 설정 `thumbnail.imageProvider`이고, ⑤ `step_run.ai_*`는 NULL이다(D-16 R1).
 *
 * M0 S1(2026-10-02, docs/dev/07_M0스파이크/S1_썸네일생성.md)로 모양을 확정했다. 경로는 agy `generate_image`다(D-19).
 * - 실제 어댑터: `AgyImageGenProvider`(agy-image-gen.provider.ts). 설정 공급자로 고르는 `RoutingImageGenProvider`가 이 토큰에
 *   붙는다(운영·개발). 테스트 환경(NODE_ENV=test)은 가짜 공급자(`FakeImageGenProvider`)가 붙고, 테스트는
 *   `overrideProvider(IMAGE_GEN_PROVIDER)`로 대본 가짜를 넣는다. GEMINI_API·OPENAI_API·CODEX는 아직 어댑터가 없다
 * - 밖으로 나가는 호출은 관문(`ExternalHttpGateway`, API 공급자) 또는 `IsolatedCliRunner`(CLI 공급자)로만 하고, 호출마다
 *   `call_log` 1행을 `IMAGE_GEN_CALL_TARGET[공급자]`로 남긴다(ERD `ck_call_log_target`). 가짜 공급자는 밖을 부르지 않아 남기지 않는다
 * - 요청의 `timeoutMs`·`signal`을 지킨다(하드 타임아웃 15분은 부르는 쪽도 건다)
 * - 결과 바이트의 형식·크기는 믿지 않는다(agy는 요청 크기와 관계없이 1024×1024 JPEG를 낸다 — S1 12/12. 저장할 때 내용으로
 *   판별하고, 1000×1000 JPEG 정규화는 ⑧ 업로드가 한다)
 * - 콘텐츠 필터 거부는 예외가 아니라 `{ kind: 'REFUSED', reason }`, 그 밖 실패는 `ImageGenError`(비밀·로컬 경로 없는 한국어 문구)
 */

/** 이미지 생성 공급자 코드(ERD `generation_run.provider`, `ck_gen_provider`) */
export const IMAGE_GEN_PROVIDER_CODES = ['AGY', 'GEMINI_API', 'OPENAI_API', 'CODEX'] as const;
export type ImageGenProviderCode = (typeof IMAGE_GEN_PROVIDER_CODES)[number];

/** 공급자 → `call_log.target`(실제 어댑터가 호출마다 남긴다) */
export const IMAGE_GEN_CALL_TARGET: Readonly<Record<ImageGenProviderCode, CallLogTarget>> = {
  AGY: 'AI_AGY_CLI',
  GEMINI_API: 'AI_GEMINI_API',
  OPENAI_API: 'AI_OPENAI_API',
  CODEX: 'AI_CODEX_CLI',
};

/** 생성 시도 행에 남기는 공급자·모델·버전(`generation_run.provider`·`model`·`provider_version`) */
export interface ImageGenIdentity {
  provider: ImageGenProviderCode;
  /** 모델 ID(100자 이하) */
  model: string;
  /** CLI·API 버전(40자 이하). 모르면 null */
  providerVersion: string | null;
}

/** 생성 요청 한 건(후보 번호 하나의 시도 하나) */
export interface ImageGenRequest {
  /** 이 시도에 기록한 공급자·모델(`identify`로 받은 값) */
  identity: ImageGenIdentity;
  /** 실제로 보낼 영어 프롬프트 전문(차단어 검사를 통과한 것) */
  prompt: string;
  /** 레퍼런스 원본 파일 절대 경로(1~3장, 순서 = sort_order). 공급자 밖으로는 파일만 넘긴다 */
  referenceImagePaths: readonly string[];
  /** 요청 해상도 px(1:1 한 변, 기본 2048) */
  sizePx: number;
  /** 하드 타임아웃(ms). 넘으면 부르는 쪽이 `signal`을 끊는다 */
  timeoutMs: number;
  signal: AbortSignal;
  /** `call_log` 연결용(선택) — ⑤ 실행 id */
  stepRunId?: number | null;
  /** `call_log` 연결용(선택) — 후보 id */
  candidateId?: number | null;
}

/** 생성 결과: 이미지 또는 콘텐츠 필터 거부 */
export type ImageGenResult =
  | {
      kind: 'IMAGE';
      bytes: Buffer;
      /** 공급자가 준 파일 이름(확장자는 믿지 않는다). 없으면 null */
      fileName: string | null;
    }
  | { kind: 'REFUSED'; reason: string };

/**
 * 거부가 아닌 생성 실패(프로세스 오류·빈 응답·쿼터 등). `userMessage`는 비밀·로컬 경로 없는 한국어 문구.
 * `code`는 `call_log.error_code`에 남긴다(agy는 AI 실행 오류 코드 `AI_TIMEOUT`·`AGY_ERROR`·`AI_CLI_FAILED`·`AI_OUTPUT_INVALID`·
 * `AI_ENGINE_UNAVAILABLE`을 그대로 쓴다)
 */
export class ImageGenError extends Error {
  constructor(
    readonly userMessage: string,
    readonly code = 'IMAGE_GEN_FAILED',
  ) {
    super(userMessage);
  }
}

export interface ImageGenProvider {
  /** 설정 공급자 코드로 기록할 공급자·모델·버전(생성 시도 행을 만들 때 — 부르기 전). 던지지 않는다 */
  identify(provider: ImageGenProviderCode): ImageGenIdentity;
  /** 이미지 한 장 생성. 거부는 결과로, 그 밖 실패는 `ImageGenError`(또는 중단이면 `signal`의 이유)로 던진다 */
  generate(request: ImageGenRequest): Promise<ImageGenResult>;
}

/** 주입 토큰(테스트는 `overrideProvider(IMAGE_GEN_PROVIDER)`로 가짜 공급자를 넣는다) */
export const IMAGE_GEN_PROVIDER = Symbol('IMAGE_GEN_PROVIDER');
