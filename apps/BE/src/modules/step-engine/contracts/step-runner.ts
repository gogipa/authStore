import { SetMetadata } from '@nestjs/common';
import type { Candidate, Prisma, StepRun } from '../../../generated/prisma/client.js';
import type { PinnedAiContext } from '../../integrations/ai-engine/ai-executor.types.js';
import type { AppSettings } from '../../settings/schema/settings.types.js';
import type { AnchorKeyInput } from '../candidates/candidate-identity.service.js';
import type {
  AutoExclusionReason,
  CandidateStatus,
  CandidateStatusReason,
  StepCode,
  StepStatus,
} from '../domain/steps.js';

/**
 * 실행기 규약(F-BS-15, 03-2 C4 §3 'StepRunner 규약', P1-05). 단계 모듈(②~⑨, P2~P4)이 step-engine에서 가져오는 것은
 * 이 파일과 `StepEngineApi`뿐이다. step-engine은 단계 모듈을 import하지 않는다(순환 없음).
 *
 * 등록: 실행기 클래스에 `@StepRunnerFor('PRICING')`을 달고 자기 모듈 `providers`에 넣는다. `StepRunnerRegistry`가
 * 앱 시작(onModuleInit) 때 DiscoveryService로 모은다. 한 단계에 실행기가 둘이면 앱 시작을 멈춘다.
 *
 * 흐름(엔진이 한다):
 * 1. 시작 트랜잭션: 시작 조건·잠금 검사 → `readInputs`(값·출처) → 지문 → version +1 → step_run(RUNNING) + step_run_input +
 *    현재 버전 포인터 이동. 커밋 뒤 SSE, 실행 대기열에 넣는다.
 * 2. `run`(트랜잭션 밖): 외부·AI 호출은 여기서만 한다. 결과(StepOutcome)를 돌려준다. 던지면 FAILED로 남긴다.
 * 3. 끝 트랜잭션: `persist`(산출물) + step_run 종료 + 끝 지문 비교 + candidate_step + 뒷단계 전파 + 후보 효과·상태 재평가.
 * 게이트·안전 검사(아동화 차단 등)는 호출자가 아니라 실행기(단계 모듈) 안에 둔다.
 */

/** Prisma 트랜잭션 클라이언트 */
export type Tx = Prisma.TransactionClient;
/** step_run 한 행 */
export type StepRunRow = StepRun;

/** step_run_input.source_type */
export type StepInputSourceType = 'PREV_STEP' | 'OWNER_INPUT' | 'SETTINGS';

/** 실행이 읽는 입력 하나(값 포함). 엔진이 값 해시를 계산해 step_run_input에 남긴다(값은 남기지 않는다) */
export interface StepInput {
  /** 입력 키(domain/input-keys.ts, 64자 이하) */
  inputKey: string;
  sourceType: StepInputSourceType;
  /** PREV_STEP일 때 읽은 앞 단계 버전. 없으면(선택 입력이 없음) 행을 남기지 않고 지문에는 null 값 해시로 넣는다 */
  sourceStepRunId?: number | null;
  /** true = 시작 조건(지문 포함), false = 실행 중 오너 입력(지문 제외) */
  isStartCondition: boolean;
  /** 필수 시작 조건이면 true. 값이 null·undefined면 409 STEP_START_CONDITION_UNMET(field = inputKey) */
  required: boolean;
  /**
   * 값(정규화 JSON으로 해시한다). 이미지는 파일 해시(sha256 글자), 설명은 `normalizeText`한 글을 넣는다.
   * 수집 시각처럼 매번 바뀌는 값은 넣지 않는다. 없는 선택 입력은 null
   */
  value: unknown;
}

/** 후보 한 단계의 지금 상태(candidate_step) */
export interface CandidateStepState {
  status: StepStatus;
  currentStepRunId: number | null;
}

/** `readInputs`에 넘기는 것(트랜잭션 안에서 부를 수 있다 — 읽기만 한다) */
export interface StepInputContext {
  db: Tx;
  candidate: Readonly<Candidate>;
  settings: Readonly<AppSettings>;
  steps: Readonly<Record<StepCode, CandidateStepState>>;
  /** 이 단계의 현재 버전이 COMPLETED면 그 실행 id, 아니면 null(앞 단계 산출물은 완료된 현재 버전만 읽는다) */
  completedRunId(stepCode: StepCode): number | null;
}

/** step_run에 남기는 AI 엔진 고정 값(D-16 R9·R11, P1-10). AI를 쓰지 않는 단계는 null */
export interface AiEngineFix {
  aiEngine: 'CLAUDE' | 'AGY' | 'CODEX';
  aiModel: string;
  aiCliVersion: string | null;
}

/** 오너 수정(OWNER_EDIT)을 비동기로 도는 경우(⑦ 태그 편집, 202)의 편집 내용 */
export interface OwnerEditRunInput {
  ownerAction: 'EDIT';
  baseStepRunId: number;
  edit: unknown;
}

/** `run`에 넘기는 것 */
export interface StepRunContext {
  stepRunId: number;
  candidateId: number;
  stepCode: StepCode;
  version: number;
  executionMode: 'STEP' | 'CHAIN' | 'BATCH' | 'CLI' | 'OWNER_EDIT';
  stepChainId: number | null;
  settingsSnapshotId: number;
  settings: Readonly<AppSettings>;
  /** 시작 때 읽은 입력(값 포함). 입력 대기에서 이어 가면 이어 갈 때 다시 읽은 값 */
  inputs: readonly StepInput[];
  /** 요청 body의 실행 중 오너 입력(05-2 StepRunOwnerInputs). 지문에서 뺀다 */
  ownerInputs: Readonly<Record<string, unknown>>;
  /**
   * 직전 완료 버전(F-CW-01·F-BS-21 규칙 7·11). 실행기는 이 버전의 오너 입력 필드를 덮어쓰지 않고, 새 결과가 다르면
   * 나란히 고르게 한다. `ownerInputs`는 그 버전의 실행 중 오너 입력(`ownerInputsOf`)으로, 다시 실행의 기본값이다
   */
  previous: { stepRunId: number; ownerInputs: Readonly<Record<string, unknown>> } | null;
  /** 입력 대기에서 이어 가는 경우(StepEngineApi.resumeWaiting) 호출자가 넘긴 값 */
  resume: { data: unknown } | null;
  /** 비동기 오너 수정(⑦ 태그 편집) */
  ownerEdit: OwnerEditRunInput | null;
  /** 이 실행에 고정한 엔진·모델·CLI 버전(step_run.ai_*). AI를 쓰지 않는 단계는 null */
  aiEngine: AiEngineFix | null;
  /**
   * AI 실행 문맥(P1-10 규칙 10): 단계 모듈은 이것으로만 `AiExecutor.run(ctx.pinnedAi, task, schema, input)`을 부른다.
   * 엔진·텍스트/비전 모델은 이 실행의 설정 스냅샷 `ai` 섹션 값이고 stepRunId·candidateId가 채워져 있다(call_log).
   * 실행 도중 설정이 바뀌어도 이 값은 그대로다. AI를 쓰지 않는 단계는 null
   */
  pinnedAi: PinnedAiContext | null;
}

/**
 * 실행 결과가 후보에 주는 효과. 엔진이 끝 트랜잭션 안에서 P1-04 서비스(중복·앵커·성별·상태 재평가)로 적용한다.
 * 단계 모듈은 `candidate`를 직접 쓰지 않는다.
 */
export interface CandidateEffects {
  /** ② 앵커 키 확정(F-CW-03). 다른 값이면 409 ANCHOR_KEY_MISMATCH → 이 실행은 FAILED(INPUT_VALIDATION) */
  anchor?: AnchorKeyInput;
  /** ② 소싱 선택(itemCode + 색상). 진행 중 중복이면 409 CANDIDATE_DUPLICATE → FAILED(INPUT_VALIDATION) */
  sourcingSelection?: { itemCode: string; selectedColor: string; anchor?: AnchorKeyInput };
  /** ② 성별 판단(null = 판단 불가). OWNER 값은 덮어쓰지 않는다(CandidateGenderService.applyStep2Gender) */
  step2Gender?: 'MALE' | 'FEMALE' | null;
  /** ④ 리프 카테고리 */
  leafCategory?: { leafCategoryId: string; wholeCategoryName: string | null };
  /** 제외 사유(앵커 일치 없음·재고 부족·판매 후보 아님) */
  exclusion?: AutoExclusionReason;
}

/** 실행 결과 */
export type StepOutcome =
  | { kind: 'COMPLETED'; output: unknown; candidateEffects?: CandidateEffects }
  | { kind: 'WAITING_INPUT'; waitingReasonCode: string; pendingInputs: string[] }
  | {
      kind: 'FAILED';
      failureKind: 'EXTERNAL_API' | 'AI' | 'INPUT_VALIDATION';
      errorCode: string;
      /** 한국어 안내 문구. 비밀정보·로컬 경로 금지 */
      errorMessage: string;
    };

/** 재시작 정리 훅(⑨, P4-03)이 돌려주는 후보 상태 전이 */
export interface CandidateStatusEffect {
  toStatus: CandidateStatus;
  reason: CandidateStatusReason;
  registrationId?: number | null;
}

/** AI 단계의 주 작업 종류(P1-10 Proposed): step_run.ai_model에 텍스트·비전 중 어느 모델을 남길지 정한다 */
export type StepAiModelKind = 'TEXT' | 'VISION';

export interface StepRunner {
  readonly stepCode: StepCode;
  /**
   * AI를 쓰는가(PRE_G2_AI_COST 경고의 근거). true면 시작 때 선택 엔진 사용 가능 판정(409 AI_ENGINE_UNAVAILABLE) →
   * `--version` 감지 → step_run.ai_*를 INSERT 때 고정한다(P1-10 규칙 10·11)
   */
  readonly usesAi: boolean;
  /**
   * AI 단계의 주 작업 종류(없으면 TEXT, P1-10 Proposed — 문서 초안의 `aiUsage: NONE|TEXT|VISION`을 P1-05 `usesAi`에 맞춰
   * 나눴다). 이 종류의 모델이 설정에 없으면 시작을 409 AI_ENGINE_UNAVAILABLE(MODEL_NOT_SET)로 막는다
   */
  readonly aiModelKind?: StepAiModelKind;
  /** 시작 조건·실행 중 오너 입력을 읽는다(값 포함). 트랜잭션 안에서 불릴 수 있다 — DB 읽기만, 외부 호출 금지 */
  readInputs(ctx: StepInputContext): Promise<StepInput[]>;
  /** 실행(트랜잭션 밖). 외부·AI 호출은 여기서만 */
  run(ctx: StepRunContext): Promise<StepOutcome>;
  /** 끝 트랜잭션 안에서 산출물을 쓴다(모든 결과 종류에서 불린다. 입력 대기 중 중간 산출물도 여기서) */
  persist(tx: Tx, stepRunId: number, outcome: StepOutcome): Promise<void>;
  /**
   * 오너 수정·그대로 유지·이전 버전 다시 고르기: `fromStepRunId`의 산출물을 `toStepRunId`로 복사한다(버전에 딸린 오너
   * 입력 행 포함). `edit`은 EDIT의 body(fields 또는 add·remove) — 필드별 규칙(FIELD_NOT_EDITABLE 등)은 실행기가 던진다.
   * 다시 고른 버전이 후보 값(② 소싱 선택 등)을 바꾸면 효과를 돌려준다.
   */
  copyOutput(
    tx: Tx,
    fromStepRunId: number,
    toStepRunId: number,
    edit?: unknown,
  ): Promise<CandidateEffects | void>;
  /** 이 버전의 실행 중 오너 입력 값(다시 실행 기본값, 규칙 7). 없으면 빈 객체 */
  ownerInputsOf?(db: Tx, stepRunId: number): Promise<Record<string, unknown>>;
  /** ② 버전의 앵커 키(이전 버전 다시 고르기의 409 ANCHOR_KEY_MISMATCH 검사). 없으면 검사하지 않는다 */
  anchorKeyOf?(db: Tx, stepRunId: number): Promise<AnchorKeyInput | null>;
  /** 재시작 정리(⑨, P4-03): 중단된 실행의 후보 상태 전이. null이면 후보는 그대로 */
  onInterrupted?(tx: Tx, run: StepRunRow): Promise<CandidateStatusEffect | null>;
  /**
   * ② 재조회 모드(선택, P2-02, P1-06 6시간 규칙): 연속 실행이 판정에 쓴 라쿠텐 페이지가 판정 유효 시간(기본 6시간)을
   * 넘은 것을 보고 ③을 다시 판정하기 전에 ②를 다시 조회할 때 `run` 대신 부른다(검색 없이 선택 상품 페이지만 다시 받는 등).
   * 없으면 `run`을 부른다. 라쿠텐 페이지 하루 상한·24시간 쉼은 외부 호출 관문이 그대로 막는다(실패로 끝나면 ②를 읽는
   * 단계만 멈춘다). 규약은 `run`과 같다(트랜잭션 밖, 결과를 돌려준다)
   */
  refetch?(ctx: StepRunContext): Promise<StepOutcome>;
  /**
   * ③ 판정에 쓴 라쿠텐 페이지 수집 시각(선택, P2-05, P1-06 6시간 규칙). `stepRunId` = ③ 현재 버전. 없으면(판정 없음·
   * 실행기가 모름) null — 연속 실행은 6시간 규칙을 쓰지 않는다. RG-08 '판정 유효 시간'도 같은 시각을 본다
   */
  judgementPageCollectedAt?(db: Tx, stepRunId: number): Promise<Date | null>;
}

/** 실행기 표시 메타데이터 키 */
export const STEP_RUNNER_META = 'autostore:step-runner';

/** 실행기 클래스 표시: `@StepRunnerFor('PRICING') @Injectable() export class PricingRunner implements StepRunner` */
export const StepRunnerFor = (code: StepCode) => SetMetadata(STEP_RUNNER_META, code);
