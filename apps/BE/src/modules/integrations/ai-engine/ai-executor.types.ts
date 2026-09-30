import type { AiInputBlock, NaverDataException } from './ai-prompt-guard.js';
import type { AiEngineCode } from './ai-engine.port.js';

/**
 * 실행에 고정한 AI 엔진(P1-10 규칙 10, R9·R11). step-engine이 AI 단계를 시작할 때 만들어 실행 문맥(`StepRunContext.pinnedAi`)에
 * 넣는다. 값은 그 실행의 설정 스냅샷 `ai` 섹션과 시작 때 감지한 CLI 버전이다. 단계 모듈은 이것으로만 `AiExecutor.run`을 부르고,
 * 실행기는 호출 시점의 현재 설정을 다시 읽지 않는다(설정이 바뀌어도 그 실행은 고정한 엔진으로 끝낸다).
 */
export interface PinnedAiContext {
  engine: AiEngineCode;
  /** 텍스트 작업 모델(설정 ai.models[engine].text). 비어 있으면 텍스트 호출이 AI_ENGINE_UNAVAILABLE(MODEL_NOT_SET) */
  textModel: string | null;
  /** 비전 작업 모델 */
  visionModel: string | null;
  /** 시작 때 `--version`으로 감지한 버전(실패하면 null) */
  cliVersion: string | null;
  /** 모델 값을 읽은 설정 스냅샷 */
  settingsSnapshotId: number;
  /** call_log.step_run_id(단계 실행 안이면 step-engine이 채운다) */
  stepRunId?: number | null;
  /** call_log.candidate_id */
  candidateId?: number | null;
}

/** 작업 종류: 텍스트 모델·120s 또는 비전 모델·180s(Read 도구와 이미지 전용 폴더) */
export type AiTaskKind = 'TEXT' | 'VISION';

/** 작업 하나 */
export interface AiTask {
  /** 요구사항 ID 같은 작업 이름(예 'CT-01', 'RK-03'). 로그·캐시 키(M2)에 쓴다. 프롬프트가 아니다 */
  name: string;
  kind: AiTaskKind;
}

/** 실행기 입력: 지시문 + 출처가 붙은 데이터 블록(규칙 14) + 비전 이미지 */
export interface AiExecutorInput {
  instruction: string;
  blocks: readonly AiInputBlock[];
  /** 비전: 원본 이미지 파일(이미지 전용 폴더에 복사해 넘긴다). 텍스트면 없어야 한다 */
  imagePaths?: readonly string[];
  /** 네이버 데이터 예외(M1 기본 없음) */
  naverDataException?: NaverDataException | null;
}

export interface AiExecutionResult<T> {
  /** 다시 검증한 결과(images_seen 뺌) */
  output: T;
  /** 비전: 모델이 읽었다고 답한 파일 이름(넘긴 이미지와 같음을 확인했다). 텍스트면 null */
  imagesSeen: string[] | null;
  engine: AiEngineCode;
  model: string;
  cliVersion: string | null;
  latencyMs: number;
  callLogId: number;
  /** 켠 네이버 데이터 예외(기록, 규칙 14). 없으면 null */
  naverDataException: NaverDataException | null;
}
