import type {
  CandidateExcludedReason,
  CandidateStatus,
  CandidateStatusReason,
  StepCode,
  StepFailureKind,
  StepStatus,
} from '../../../common/events/progress-event.types.js';

export type {
  CandidateExcludedReason,
  CandidateStatus,
  CandidateStatusReason,
  StepCode,
  StepFailureKind,
  StepStatus,
};

/**
 * 단계 흐름 순서(PRD §5.3 '연속 실행 세부', ERD §4.2): ② → ③ → ④ → ⑤ → ⑥-1 → ⑥-2 → ⑥-3 → ⑦ → ⑧ → ⑨.
 * 이어 하기(목록 resumeStepCode·resume-target·FE 후보 틀 이동)와 후보 생성(candidate_step 10행)이 이 순서를 쓴다.
 */
export const STEP_FLOW = [
  'SOURCING',
  'PRICING',
  'CATEGORY',
  'THUMBNAIL',
  'COPY',
  'NOTICE_RAW',
  'NOTICE_HTML',
  'TAGS',
  'UPLOAD',
  'REGISTER',
] as const satisfies readonly StepCode[];

/** 필수 단계 9개(PRD §5.2 '필수 단계'). ⑨ REGISTER는 G4로만 돌아 승인대기 판단에 넣지 않는다 */
export const REQUIRED_STEPS = [
  'SOURCING',
  'PRICING',
  'CATEGORY',
  'THUMBNAIL',
  'COPY',
  'NOTICE_RAW',
  'NOTICE_HTML',
  'TAGS',
  'UPLOAD',
] as const satisfies readonly StepCode[];

/** 후보 상태 8개(ERD §4.1, 05-2 CandidateStatus 순서) */
export const CANDIDATE_STATUSES = [
  'TEMP',
  'WORKING',
  'EXCLUDED',
  'AWAITING_APPROVAL',
  'VALIDATED',
  'REGISTERING',
  'RESULT_CHECK_REQUIRED',
  'REGISTERED',
] as const satisfies readonly CandidateStatus[];

/** 단계 상태 6개(ERD §4.1, 05-2 StepStatus 순서) */
export const STEP_STATUSES = [
  'NOT_RUN',
  'RUNNING',
  'WAITING_INPUT',
  'COMPLETED',
  'FAILED',
  'RERUN_REQUIRED',
] as const satisfies readonly StepStatus[];

/** '진행 중'이 아닌 상태(PRD §5.2 후보 중복: 제외·등록됨이 아닌 것이 진행 중). uq_candidate_active_item_color와 같다 */
export const NOT_IN_PROGRESS_STATUSES = [
  'EXCLUDED',
  'REGISTERED',
] as const satisfies readonly CandidateStatus[];

/** 진행 중 후보 상태 6개. 목록 기본값·중복 검사·이어 하기의 대상 */
export const IN_PROGRESS_STATUSES: readonly CandidateStatus[] = CANDIDATE_STATUSES.filter(
  (s) => !(NOT_IN_PROGRESS_STATUSES as readonly string[]).includes(s),
);

/** 등록 진행 잠금(F-CW-07, PRD §5.2 잠금). 상세 `locked`와 409 CANDIDATE_LOCKED */
export const LOCKED_STATUSES = [
  'REGISTERING',
  'RESULT_CHECK_REQUIRED',
  'REGISTERED',
] as const satisfies readonly CandidateStatus[];

/** 승인대기 이상(ck_candidate_ready가 값을 요구하는 상태) */
export const READY_REQUIRED_STATUSES = [
  'AWAITING_APPROVAL',
  'VALIDATED',
  'REGISTERING',
  'RESULT_CHECK_REQUIRED',
  'REGISTERED',
] as const satisfies readonly CandidateStatus[];

/** 단계 결과가 후보를 제외하는 사유(F-CW-05). reason과 excluded_reason이 같은 코드다 */
export const AUTO_EXCLUSION_REASONS = [
  'ANCHOR_NO_MATCH',
  'INSUFFICIENT_STOCK',
  'NOT_SALE_CANDIDATE',
] as const satisfies readonly (CandidateExcludedReason & CandidateStatusReason)[];
export type AutoExclusionReason = (typeof AUTO_EXCLUSION_REASONS)[number];

/** 이어 할 단계가 되는 상태(F-CW-10: 흐름상 첫 입력대기·미실행·실패·재실행 필요). RUNNING은 건너뛴다 */
export const RESUMABLE_STEP_STATUSES = [
  'WAITING_INPUT',
  'NOT_RUN',
  'FAILED',
  'RERUN_REQUIRED',
] as const satisfies readonly StepStatus[];

/** GET /candidate-steps 기본 상태(05-2 listAttentionCandidateSteps) */
export const ATTENTION_STEP_STATUSES = [
  'RERUN_REQUIRED',
  'FAILED',
  'WAITING_INPUT',
] as const satisfies readonly StepStatus[];

export type GateCode = 'G2' | 'G3';

/** 후보 필드 입력 키(step_run_input.input_key·candidate_step.stale_inputs에 쓰는 이름) */
export const CANDIDATE_INPUT_KEYS = {
  gender: 'candidate.gender',
  rakutenQuery: 'candidate.rakutenQuery',
  sourceUrl: 'candidate.sourceUrl',
  anchorKey: 'candidate.anchorKey',
} as const;
export type CandidateInputKey = (typeof CANDIDATE_INPUT_KEYS)[keyof typeof CANDIDATE_INPUT_KEYS];

export interface StepGraphNode {
  /** 필수 앞 단계: 현재 버전이 COMPLETED여야 이 단계를 실행한다(PRD §5.3 '필수 시작 조건') */
  requires: readonly StepCode[];
  /** 선택 앞 단계: 완료면 읽고, 아니면 없이 실행한다(예: ⑦이 ④ 리프 경로를 읽는다) */
  optional: readonly StepCode[];
  /** 반드시 있어야 하는 후보 필드 */
  candidateFields: readonly CandidateInputKey[];
  /** 이 중 하나는 있어야 하는 후보 필드(② 검색어·URL·앵커 키) */
  anyOfCandidateFields: readonly CandidateInputKey[];
  /** 통과해 있어야 하는 게이트(⑧ G3) */
  gates: readonly GateCode[];
  /** 단계 실행 API(…/runs)로 돌릴 수 있는가. ⑨는 G4 승인으로만(05-1 §1.1) */
  stepRunnable: boolean;
}

const node = (partial: Partial<StepGraphNode>): StepGraphNode => ({
  requires: [],
  optional: [],
  candidateFields: [],
  anyOfCandidateFields: [],
  gates: [],
  stepRunnable: true,
  ...partial,
});

/**
 * 단계 입력 그래프(PRD §5.3 '단계별 입력과 산출물' 표의 시작 조건). 앞 단계 산출물과 후보 필드만 적었다.
 * 입력 키 단위(설정 키·오너 입력 포함)는 step-graph.ts의 `STEP_INPUT_SPECS`가 넓힌다(P1-05: 입력 지문·재실행 필요 전파).
 * '지금 실행 가능'(runnable.ts)과 실행 중 잠금(앞·뒤 단계)이 이 표를 쓴다.
 */
export const STEP_GRAPH: Record<StepCode, StepGraphNode> = {
  // 라쿠텐 검색어 또는 URL, (다시 실행이면) 앵커 키, 재고 판정 설정
  SOURCING: node({
    anyOfCandidateFields: [
      CANDIDATE_INPUT_KEYS.rakutenQuery,
      CANDIDATE_INPUT_KEYS.sourceUrl,
      CANDIDATE_INPUT_KEYS.anchorKey,
    ],
  }),
  // ② 목표 사이즈 SKU가·재고·송료, 후보 성별, 판정 설정
  PRICING: node({ requires: ['SOURCING'], candidateFields: [CANDIDATE_INPUT_KEYS.gender] }),
  // ② 장르·상품유형, 후보 성별
  CATEGORY: node({ requires: ['SOURCING'], candidateFields: [CANDIDATE_INPUT_KEYS.gender] }),
  // ② 원본 이미지(레퍼런스), 프롬프트 설정
  THUMBNAIL: node({ requires: ['SOURCING'] }),
  // ② 상품명·설명·SKU 속성
  COPY: node({ requires: ['SOURCING'] }),
  // ② 소싱 선택·속성·설명·선택 색상
  NOTICE_RAW: node({ requires: ['SOURCING'] }),
  // ⑥-1, ⑥-2, ③ 판매 사이즈, 후보 성별, 프로필·템플릿 설정, (선택) ④ 리프 카테고리.
  // 상품명(⑥-3 산출물)이 ④를 읽는다(RG-04). PRD §5.3 표에는 없어 선택 입력으로 둔다: ④ 없이도 실행하고,
  // ④가 바뀌면 ⑥-3이 재실행 필요가 된다(ERD §7.2-10, P1-05 Proposed)
  // P3-04: 상품명(모델명·並行輸入品)이 ② 산출물을 읽어 ②도 필수 앞 단계다(③이 이미 ②를 요구해 실행 가능 여부는 그대로)
  NOTICE_HTML: node({
    requires: ['SOURCING', 'COPY', 'NOTICE_RAW', 'PRICING'],
    optional: ['CATEGORY'],
    candidateFields: [CANDIDATE_INPUT_KEYS.gender],
  }),
  // 시드 키워드·② 모델명·상품유형, 후보 성별, (선택) ④ 리프 경로
  TAGS: node({
    requires: ['SOURCING'],
    optional: ['CATEGORY'],
    candidateFields: [CANDIDATE_INPUT_KEYS.gender],
  }),
  // ⑤ G3 선택본, ⑥-3 HTML, G3 통과
  UPLOAD: node({ requires: ['THUMBNAIL', 'NOTICE_HTML'], gates: ['G3'] }),
  // ②~⑧ 현재 버전, G4(등록 기록)
  REGISTER: node({
    requires: [
      'SOURCING',
      'PRICING',
      'CATEGORY',
      'THUMBNAIL',
      'COPY',
      'NOTICE_RAW',
      'NOTICE_HTML',
      'TAGS',
      'UPLOAD',
    ],
    gates: ['G2', 'G3'],
    stepRunnable: false,
  }),
};

/** 후보 필드를 읽는 단계(성별이면 ③·④·⑥-3·⑦). 성별 입력 중 실행 중 잠금에 쓴다 */
export function stepsReadingCandidateField(key: CandidateInputKey): StepCode[] {
  return STEP_FLOW.filter((code) => STEP_GRAPH[code].candidateFields.includes(key));
}

/** 성별을 읽는 단계(③·④·⑥-3·⑦). 이 단계가 실행 중이면 성별을 바꿀 수 없다(409 STEP_LOCKED_BY_RUNNING_STEP) */
export const GENDER_READER_STEPS: readonly StepCode[] = stepsReadingCandidateField(
  CANDIDATE_INPUT_KEYS.gender,
);

/**
 * 성별이 바뀌면 '재실행 필요'로 두는 단계(05-2 setCandidateGender: PRICING·NOTICE_HTML·TAGS).
 * PRD §5.3은 ④도 성별을 시작 조건으로 읽지만 05-2는 ④를 넣지 않았다(④는 같은 실행 안에서 새 성별로 다시 뽑는다).
 * 05-2대로 두고 오너 검토에 올렸다(P1-04 §8).
 */
export const GENDER_PROPAGATION_STEPS = [
  'PRICING',
  'NOTICE_HTML',
  'TAGS',
] as const satisfies readonly StepCode[];

function closure(start: StepCode, next: (code: StepCode) => readonly StepCode[]): Set<StepCode> {
  const seen = new Set<StepCode>();
  const stack = [...next(start)];
  while (stack.length > 0) {
    const code = stack.pop()!;
    if (seen.has(code)) continue;
    seen.add(code);
    stack.push(...next(code));
  }
  return seen;
}

/** 이 단계가 직접·간접으로 읽는 앞 단계(필수 + 선택) */
export function upstreamSteps(code: StepCode): Set<StepCode> {
  return closure(code, (c) => [...STEP_GRAPH[c].requires, ...STEP_GRAPH[c].optional]);
}

/** 이 단계의 산출물을 직접·간접으로 읽는 뒷단계 */
export function downstreamSteps(code: StepCode): Set<StepCode> {
  return closure(code, (c) =>
    STEP_FLOW.filter(
      (d) => STEP_GRAPH[d].requires.includes(c) || STEP_GRAPH[d].optional.includes(c),
    ),
  );
}

/** 단계 코드 → 현재 상태. candidate_step 10행을 읽어 만든다. 없는 단계는 NOT_RUN으로 본다 */
export type StepStatusMap = Partial<Record<StepCode, StepStatus>>;

export function stepStatusOf(steps: StepStatusMap, code: StepCode): StepStatus {
  return steps[code] ?? 'NOT_RUN';
}

export function toStepStatusMap(
  rows: readonly { stepCode: string; status: string }[],
): StepStatusMap {
  const map: StepStatusMap = {};
  for (const row of rows) map[row.stepCode as StepCode] = row.status as StepStatus;
  return map;
}

/** 화면·오류 문구용 단계 이름(단계 레일과 같은 번호·이름, 공통부품 §G) */
export const STEP_LABEL: Record<StepCode, string> = {
  SOURCING: '② 소싱',
  PRICING: '③ 판정',
  CATEGORY: '④ 카테고리',
  THUMBNAIL: '⑤ 썸네일',
  COPY: '⑥-1 카피',
  NOTICE_RAW: '⑥-2 원산지·소재',
  NOTICE_HTML: '⑥-3 고시·HTML',
  TAGS: '⑦ 태그',
  UPLOAD: '⑧ 이미지 업로드',
  REGISTER: '⑨ 등록',
};

/** 화면·오류 문구용 후보 상태 이름(PRD §5.2) */
export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  TEMP: '임시',
  WORKING: '작업중',
  EXCLUDED: '제외',
  AWAITING_APPROVAL: '승인대기',
  VALIDATED: '검증완료',
  REGISTERING: '등록요청중',
  RESULT_CHECK_REQUIRED: '결과확인필요',
  REGISTERED: '등록됨',
};

export function isStepCode(value: unknown): value is StepCode {
  return typeof value === 'string' && (STEP_FLOW as readonly string[]).includes(value);
}

export function isLockedStatus(status: string): boolean {
  return (LOCKED_STATUSES as readonly string[]).includes(status);
}

export function isInProgressStatus(status: string): boolean {
  return !(NOT_IN_PROGRESS_STATUSES as readonly string[]).includes(status);
}
