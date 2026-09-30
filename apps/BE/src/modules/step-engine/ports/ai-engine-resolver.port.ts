import type { AiEngineFix } from '../contracts/step-runner.js';
import type { StepCode } from '../domain/steps.js';

/**
 * AI 엔진 고정 훅(D-16 R9~R11, P1-10). AI를 쓰는 실행기(`usesAi`)의 실행을 시작하기 전(시작 INSERT 앞)에 부른다.
 * 설정의 선택 엔진·모델과 CLI 버전을 돌려주면 step_run.ai_engine·ai_model·ai_cli_version에 고정한다(INSERT 때만 쓸 수 있다,
 * trg_step_run_append_only). 선택 엔진을 쓸 수 없으면 409 AI_ENGINE_UNAVAILABLE을 던진다(다른 엔진으로 넘어가지 않는다).
 * P1-05 기본은 null(엔진을 고정하지 않는다) — P1-10이 바꿔 끼운다.
 */
export type AiEngineResolver = (input: {
  candidateId: number;
  stepCode: StepCode;
}) => Promise<AiEngineFix | null>;

export const AI_ENGINE_RESOLVER = Symbol('AI_ENGINE_RESOLVER');

export const noAiEngineResolver: AiEngineResolver = () => Promise.resolve(null);
