import type { PinnedAiContext } from '../../integrations/ai-engine/ai-executor.types.js';

/**
 * AI 엔진 고정 포트(D-16 R9~R11, P1-10). AI를 쓰는 실행기(`usesAi`)의 실행을 시작하기 **전**(시작 트랜잭션 밖)에 부른다.
 * `prepare()` = 설정의 선택 엔진 사용 가능 판정(최신 ai_cli_check, 쓸 수 없으면 409 AI_ENGINE_UNAVAILABLE — 다른 엔진으로
 * 넘어가지 않는다) → `--version` 감지(실패하면 null) → 설정 스냅샷 `ai` 섹션의 텍스트·비전 모델.
 * spawn(`--version`)이 들어 있어 DB 트랜잭션 안에서 부르지 않는다(§8 주의). 시작 트랜잭션은 그 값으로
 * step_run.ai_engine·ai_model·ai_cli_version을 INSERT 때 쓴다(trg_step_run_append_only — 나중에 못 바꾼다).
 * 구현은 `SelectedAiEngineResolver`(system의 사용 가능 판정 + integrations의 AiExecutor, P1-10).
 */
export interface AiEngineResolver {
  prepare(): Promise<PinnedAiContext>;
}

export const AI_ENGINE_RESOLVER = Symbol('AI_ENGINE_RESOLVER');

/**
 * 트랜잭션 전에 미리 확인한 결과(연속 실행 이어 가기, P1-06). 다음 단계가 AI 단계일 때만 쓴다 — 쓸 수 없음(`error`)은
 * AI 단계를 시작할 때 던진다.
 */
export type AiEnginePreparation = { prepared: PinnedAiContext } | { error: unknown };
