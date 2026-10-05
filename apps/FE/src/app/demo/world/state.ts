import { STEP_FLOW, type StepCode } from './steps';
import type { StoryKey } from '../sample/story';
import type { Schema } from '../sample/types';
import { initialCategory, type CategoryState } from './domains/category';
import { initialContent, type ContentState } from './domains/content';
import { initialKeywords, type KeywordsState } from './domains/keywords';
import { initialPricing, type PricingState } from './domains/pricing';
import { initialSourcing, type SourcingState } from './domains/sourcing';
import { initialTags, type TagsState } from './domains/tags';
import { initialThumbnail, type ThumbnailState } from './domains/thumbnail';
import { initialUpload, type UploadState } from './domains/upload';

export { STEP_FLOW, REQUIRED_STEPS, type StepCode } from './steps';
export type StepStatus = Schema<'StepStatus'>;
export type CandidateStatus = Schema<'CandidateStatus'>;
export type CandidateStatusReason = Schema<'CandidateStatusReason'>;
export type StepChainStopReason = Schema<'StepChainStopReason'>;

/** 단계가 읽은 입력 하나(step_run_input): 값을 나타내는 글(`sig`, 없으면 null)과 읽은 앞 단계 실행 id */
export interface InputValue {
  sig: string | null;
  sourceRunId: number | null;
}

/** 단계가 읽은 입력 모음(입력 키 → 값). BE `step_run_input`의 값 해시에 해당한다 */
export type InputValues = Record<string, InputValue>;

/** 단계 실행 한 번(step_run). 시각은 실제 시각(ms) */
export interface RunRec {
  id: number;
  version: number;
  status: 'RUNNING' | 'WAITING_INPUT' | 'COMPLETED' | 'RERUN_REQUIRED';
  executionMode: 'STEP' | 'CHAIN' | 'OWNER_EDIT';
  stepChainId: number | null;
  startedAt: number;
  endedAt: number | null;
  waitingSince: number | null;
  /** 입력을 기다린 시간(초) */
  waitSeconds: number;
  waitingReasonCode: string | null;
  pendingInputs: string[];
  /**
   * 읽은 입력(앞 단계 산출물·여정 값·오너 입력). 시작 때 읽고(시작 조건 입력은 그대로, 실행 중 오너 입력은 끝날 때 값으로 맞춘다)
   * 낡음 판정이 지금 값과 견준다
   */
  inputs?: InputValues;
  /** 끝났을 때 낸 산출물의 값 글(산출물 키 → 글). 뒤 단계가 읽는 값이다 */
  outputs?: Record<string, string>;
  /** 실행하는 사이 바뀐 시작 조건 입력(끝 지문 비교) — 이 이유로 '재실행 필요'로 끝났다 */
  rerunReasonInputs?: string[];
}

/** 단계 하나(candidate_step): 상태와 버전 이력. 현재 실행은 `runs`의 마지막 */
export interface StepRec {
  status: StepStatus;
  runs: RunRec[];
  updatedAt: number | null;
  /** '재실행 필요'가 된 이유(바뀐 입력 키). 새 실행이 시작되면 비운다 */
  staleInputs: string[];
  staleSince: number | null;
}

/** 여정 상태 전이 이력 한 줄 */
export interface StatusHistoryRec {
  id: number;
  from: CandidateStatus | null;
  to: CandidateStatus;
  reason: CandidateStatusReason;
  stepRunId: number | null;
  registrationId: number | null;
  at: number;
}

/** 예시 여정(키워드로 만든 여정 하나) */
export interface CandidateRec {
  id: number;
  status: CandidateStatus;
  statusChangedAt: number;
  sourceKeywordId: number;
  sourceKeyword: string;
  rakutenQuery: string;
  createdAt: number;
  updatedAt: number;
  displayName: string;
  // ② 소싱 고르기로 확정되는 값
  anchorModelCode: string | null;
  anchorItemCode: string | null;
  anchorColorCode: string | null;
  anchorFixedAt: number | null;
  itemCode: string | null;
  selectedColor: string | null;
  gender: 'MALE' | 'FEMALE' | null;
  genderSource: 'STEP2' | 'OWNER' | null;
  pageDataCollectedAt: number | null;
  // ④ 카테고리 확정으로 채워지는 값
  leafCategoryId: string | null;
  wholeCategoryName: string | null;
  history: StatusHistoryRec[];
}

/** G2·G3 통과 기록 */
export interface GateRec {
  gatePassId: number;
  passedAt: number;
  /** 통과 때 본 근거 단계 실행(③·⑤) id */
  basisStepRunId: number;
}

/** 연속 실행(step_chain) 한 번 */
export interface ChainRec {
  id: number;
  /** 여기부터 연속 실행(고른 단계부터) 또는 재실행 필요 단계 모두 실행(시작 단계 없음) */
  kind: 'FROM_HERE' | 'RERUN_STALE';
  startStepCode: StepCode | null;
  startedAt: number;
  endedAt: number | null;
  stopReason: StepChainStopReason | null;
  stopStepCode: StepCode | null;
  /** 이 묶음이 연 실행 id(시작 순서) */
  runIds: number[];
  /** 이 묶음에서 이미 돌린 단계(단계당 한 번) */
  ran: StepCode[];
  skipped: StepCode[];
}

/** 등록 기록(registration). 드라이런 = VALIDATED, 실등록 = REGISTERING → REGISTERED */
export interface RegistrationRec {
  id: number;
  /** 이 기록이 연 ⑨ 단계 실행 */
  stepRunId: number;
  version: number;
  status: 'VALIDATED' | 'REGISTERING' | 'RESULT_CHECK_REQUIRED' | 'REGISTERED';
  optionType: 'COMBINATION' | 'STANDARD';
  approvedAt: number;
  registeredAt: number | null;
  originProductNo: string | null;
  channelProductNo: string | null;
  httpStatus: number | null;
  traceId: string | null;
  priceJudgementId: number | null;
  uploadResultId: number | null;
  /** 승인 때 센 '처음 N건'에 따른 전시 모드(등록 요청 본문 채널 칸) */
  displayStatusType: 'SUSPENSION' | 'ON';
  /** 승인 요청의 `Idempotency-Key`(소문자). 같은 키를 다시 보내면 첫 응답을 그대로 돌려준다 */
  idempotencyKey: string | null;
  /** 커머스API에 등록 요청을 보낸 시각·응답을 받은 시각(실등록만) */
  requestSentAt: number | null;
  responseReceivedAt: number | null;
}

/** 등록 API 차단 스위치와 등록 기록(⑨, G4) — 소유: domains/registration.ts */
export interface RegistrationState {
  /** 등록 API 차단(기본 켬 = 드라이런) */
  apiBlocked: boolean;
  switchChangedAt: number;
  records: RegistrationRec[];
}

/** 따라 하기 모델 전체 상태(메모리). 처음 상태는 `initialWorldState` */
export interface WorldState {
  /** 체험을 켠(또는 처음부터 다시 한) 시각 */
  startedAt: number;
  /** 마일스톤별 실제 시각(이야기 시각표 키) — 시계가 '몇 분 전'을 실제 시각으로 바꾼다 */
  times: Partial<Record<StoryKey, number>>;
  /** 새 id를 주는 번호표 */
  next: { run: number; chain: number; gatePass: number; history: number; registration: number };
  keywords: KeywordsState;
  candidate: CandidateRec | null;
  steps: Record<StepCode, StepRec>;
  gates: { G2: GateRec | null; G3: GateRec | null };
  chains: ChainRec[];
  /** ⑥ 묶음 실행(`throughStepCode`)이 아직 이어서 돌릴 단계 */
  bundle: StepCode[];
  sourcing: SourcingState;
  pricing: PricingState;
  category: CategoryState;
  thumbnail: ThumbnailState;
  content: ContentState;
  tags: TagsState;
  upload: UploadState;
  registration: RegistrationState;
}

const emptyStep = (): StepRec => ({
  status: 'NOT_RUN',
  runs: [],
  updatedAt: null,
  staleInputs: [],
  staleSince: null,
});

export function initialWorldState(now: number): WorldState {
  return {
    startedAt: now,
    times: {},
    next: { run: 100, chain: 1, gatePass: 10, history: 1, registration: 30 },
    keywords: initialKeywords(),
    candidate: null,
    steps: Object.fromEntries(STEP_FLOW.map((code) => [code, emptyStep()])) as Record<
      StepCode,
      StepRec
    >,
    gates: { G2: null, G3: null },
    chains: [],
    bundle: [],
    sourcing: initialSourcing(),
    pricing: initialPricing(),
    category: initialCategory(),
    thumbnail: initialThumbnail(),
    content: initialContent(),
    tags: initialTags(),
    upload: initialUpload(),
    registration: { apiBlocked: true, switchChangedAt: now, records: [] },
  };
}
