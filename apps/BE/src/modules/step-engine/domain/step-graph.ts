import { INPUT_KEYS } from './input-keys.js';
import {
  downstreamSteps,
  STEP_FLOW,
  STEP_GRAPH,
  upstreamSteps,
  type CandidateInputKey,
  type StepCode,
} from './steps.js';

export { downstreamSteps, upstreamSteps };

/**
 * 입력 하나의 선언(PRD §5.3 '단계별 입력과 산출물' 표를 입력 키로 편 것).
 * - `PREV_STEP`: 앞 단계 산출물(그 단계의 현재 버전이 COMPLETED일 때만 읽는다)
 * - `CANDIDATE`: 후보 필드. 실행기가 실제 출처(② 자동이면 PREV_STEP, 오너가 넣었으면 OWNER_INPUT)로 적는다
 * - `OWNER_INPUT`: 오너 입력. `isStartCondition=false`면 실행 중 오너 입력(지문에서 뺀다)
 * - `SETTINGS`: 설정 파일 값(`settings.<경로>`)
 */
export type InputSpecSource = 'PREV_STEP' | 'CANDIDATE' | 'OWNER_INPUT' | 'SETTINGS';

export interface StepInputSpec {
  inputKey: string;
  source: InputSpecSource;
  /** PREV_STEP일 때 산출물을 내는 단계 */
  sourceStepCode?: StepCode;
  /** true = 시작 조건(지문에 넣는다), false = 실행 중 오너 입력 */
  isStartCondition: boolean;
  /** 필수 시작 조건인가. '선택'은 없으면 null 값 해시로 빼고 실행한다 */
  required: boolean;
}

const prev = (inputKey: string, sourceStepCode: StepCode, required = true): StepInputSpec => ({
  inputKey,
  source: 'PREV_STEP',
  sourceStepCode,
  isStartCondition: true,
  required,
});
const cand = (inputKey: string, required = true): StepInputSpec => ({
  inputKey,
  source: 'CANDIDATE',
  isStartCondition: true,
  required,
});
const settingsKey = (inputKey: string): StepInputSpec => ({
  inputKey,
  source: 'SETTINGS',
  isStartCondition: true,
  required: true,
});
const ownerStart = (inputKey: string): StepInputSpec => ({
  inputKey,
  source: 'OWNER_INPUT',
  isStartCondition: true,
  required: false,
});
const ownerRuntime = (inputKey: string): StepInputSpec => ({
  inputKey,
  source: 'OWNER_INPUT',
  isStartCondition: false,
  required: false,
});

const K = INPUT_KEYS;

/**
 * 단계마다 읽는 입력(M1). 단계 모듈(P2~P4)의 실행기가 `readInputs`에서 이 키로 값을 낸다(설정은 실제로 읽는 키로 더
 * 잘게 나눌 수 있다). 앞 단계 입력의 출처 단계는 `STEP_GRAPH.requires`(필수)·`optional`(선택)과 같다(테스트가 맞춰 본다).
 * 가짜 실행기(test/fixtures/step-engine)도 이 표로 입력을 낸다.
 */
export const STEP_INPUT_SPECS: Record<StepCode, readonly StepInputSpec[]> = {
  // 라쿠텐 검색어 또는 URL, (다시 실행이면) 앵커 키, 재고 판정 설정 / 실행 중: 검색어 직접 입력
  SOURCING: [
    cand(K.candidateRakutenQuery, false),
    cand(K.candidateSourceUrl, false),
    cand(K.candidateAnchorKey, false),
    settingsKey(K.settingsTargetSizeMm),
    settingsKey(K.settingsMinSizeCount),
    settingsKey(K.settingsDefaultWidth),
    settingsKey(K.settingsExcludeBackOrder),
    settingsKey(K.settingsDefaultShippingYen),
    ownerRuntime(K.ownerSearchKeyword),
  ],
  // ② 목표 사이즈 SKU가·재고·송료, 성별, 쿠폰(선택, URL 후보), 판정 설정 / 실행 중: 국내 기준가
  PRICING: [
    prev(K.sourcingTargetSkus, 'SOURCING'),
    cand(K.candidateGender),
    ownerStart(K.ownerCoupon),
    settingsKey(K.settingsCosts),
    settingsKey(K.settingsPricing),
    ownerRuntime(K.ownerDomesticPrice),
  ],
  // ② 장르·상품유형, 성별, 매핑표·아동·제외 품목 카테고리 말 설정(P2-06)
  CATEGORY: [
    prev(K.sourcingGenre, 'SOURCING'),
    cand(K.candidateGender),
    settingsKey(K.settingsCategoryLeafMapping),
    settingsKey(K.settingsChildCategoryWords),
    settingsKey(K.settingsExcludedCategoryWords),
  ],
  // 프롬프트 골격·얼굴 노출 기본값 설정(P3-01 규칙 2 — ② 완료는 시작 조건이지만 ② itemCode·원본 목록은 지문에 넣지 않는다,
  // COMPLETION_ONLY_INPUTS) / 실행 중: 레퍼런스 선택·얼굴 옵션·프롬프트 조정
  THUMBNAIL: [
    settingsKey(K.settingsThumbnailPromptTemplate),
    settingsKey(K.settingsThumbnailFaceOptionDefault),
    ownerRuntime(K.ownerReferenceSelection),
    ownerRuntime(K.ownerFaceOption),
    ownerRuntime(K.ownerPromptAdjustment),
  ],
  // ② 상품명·설명·SKU 속성
  COPY: [prev(K.sourcingItemText, 'SOURCING'), prev(K.sourcingSkuAttributes, 'SOURCING')],
  // ② 소싱 선택(itemCode)·속성·설명·스펙 이미지·선택 색상
  NOTICE_RAW: [
    prev(K.sourcingSelection, 'SOURCING'),
    prev(K.sourcingAttributes, 'SOURCING'),
    prev(K.sourcingSelectedColor, 'SOURCING'),
  ],
  // ⑥-1, ⑥-2, ③ 판매 사이즈, 성별, (선택) ④ 리프 카테고리(상품명, ERD §7.2-10 P1-05 Proposed), 고시 설정
  NOTICE_HTML: [
    prev(K.copyDraft, 'COPY'),
    prev(K.noticeRawFacts, 'NOTICE_RAW'),
    prev(K.pricingSaleSizes, 'PRICING'),
    prev(K.categoryLeafPath, 'CATEGORY', false),
    cand(K.candidateGender),
    settingsKey(K.settingsNotice),
  ],
  // 시드 키워드, ② 모델명·상품유형, 성별, (선택) 경쟁 태그, (선택) ④ 리프 경로
  TAGS: [
    cand(K.candidateSeedKeyword, false),
    prev(K.sourcingModelInfo, 'SOURCING'),
    cand(K.candidateGender),
    ownerStart(K.ownerCompetitorTags),
    prev(K.categoryLeafPath, 'CATEGORY', false),
  ],
  // ⑤ G3 선택본, ⑥-3 HTML
  UPLOAD: [prev(K.thumbnailSelection, 'THUMBNAIL'), prev(K.noticeHtmlHtml, 'NOTICE_HTML')],
  // ②~⑧ 현재 버전
  REGISTER: [
    prev(K.sourcingSelection, 'SOURCING'),
    prev(K.pricingJudgement, 'PRICING'),
    prev(K.categoryLeafPath, 'CATEGORY'),
    prev(K.thumbnailSelection, 'THUMBNAIL'),
    prev(K.copyDraft, 'COPY'),
    prev(K.noticeRawFacts, 'NOTICE_RAW'),
    prev(K.noticeHtmlHtml, 'NOTICE_HTML'),
    prev(K.tagsFinal, 'TAGS'),
    prev(K.uploadResult, 'UPLOAD'),
  ],
};

/**
 * 앞 단계 **완료만** 시작 조건으로 보고 그 산출물은 입력 지문에 넣지 않는 단계(P3-01 규칙 1·2, Proposed).
 * ⑤는 ② 현재 버전이 완료이고 소싱 선택이 있어야 시작하지만(`STEP_GRAPH.THUMBNAIL.requires`), ② itemCode·원본 목록은 지문에
 * 넣지 않는다 — 같은 앵커 키 안에서 샵만 바꾸면 ⑤와 G3은 그대로다(PRD §5.2 작업 단위, ERD generation_run '⑤ 입력 기록 규칙').
 * 값은 시작 조건이 모자랄 때(409 STEP_START_CONDITION_UNMET) 알릴 입력 이름이다.
 */
export const COMPLETION_ONLY_INPUTS: Readonly<
  Partial<Record<StepCode, Partial<Record<StepCode, string>>>>
> = {
  THUMBNAIL: { SOURCING: K.sourcingSelection },
};

/** 이 단계가 앞 단계 `from`에서 읽는 입력 키(시작 조건 오류의 fieldErrors) */
export function inputKeysFromStep(stepCode: StepCode, from: StepCode): string[] {
  return STEP_INPUT_SPECS[stepCode]
    .filter((spec) => spec.source === 'PREV_STEP' && spec.sourceStepCode === from)
    .map((spec) => spec.inputKey);
}

/** 이 단계가 내는 산출물 입력 키(뒷단계가 이 단계에서 읽는 키 전부) */
export function outputKeysOf(stepCode: StepCode): string[] {
  const keys = new Set<string>();
  for (const code of STEP_FLOW) {
    for (const key of inputKeysFromStep(code, stepCode)) keys.add(key);
  }
  return [...keys];
}

/**
 * 이 단계의 산출물을 **직접** 읽는 단계(필수·선택). 전파(규칙 6)는 이 단계들의 지문만 다시 계산한다.
 * ⑨ REGISTER는 뺀다: 등록 기록이 원본이고(P4-03), 등록 뒤 후보는 잠겨 단계가 바뀌지 않는다(P1-05 Proposed).
 */
export function directReaders(stepCode: StepCode): StepCode[] {
  return STEP_FLOW.filter(
    (code) =>
      code !== 'REGISTER' &&
      (STEP_GRAPH[code].requires.includes(stepCode) ||
        STEP_GRAPH[code].optional.includes(stepCode)),
  );
}

/** 입력 키 → 그 키를 읽는 단계(흐름 순서). 실행기는 이 표 밖의 키를 더 읽을 수 있어 전파는 실행기 입력으로 다시 본다 */
export function stepsReadingInput(inputKey: string): StepCode[] {
  return STEP_FLOW.filter((code) =>
    STEP_INPUT_SPECS[code].some((spec) => spec.inputKey === inputKey),
  );
}

/** 이 단계가 읽는 후보 필드(시작 조건 검사) */
export function candidateFieldsOf(stepCode: StepCode): readonly CandidateInputKey[] {
  return STEP_GRAPH[stepCode].candidateFields;
}
