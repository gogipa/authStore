import type { StepStatusValue } from '@/features/step-engine';
import type { JUDGEMENT_GUIDE } from '@/features/guide';

export type JudgementNowKey = keyof (typeof JUDGEMENT_GUIDE)['now'];

export interface JudgementNowInput {
  /** 단계 레일의 ③ 상태(레일이나 여정을 아직 못 받았으면 undefined) */
  pricingStatus: StepStatusValue | undefined;
  /** 단계 레일의 ④ 상태 */
  categoryStatus: StepStatusValue | undefined;
  /** 국내 기준가를 한 번이라도 저장했는가(아직 읽는 중이면 undefined) */
  domesticPriceSaved: boolean | undefined;
  /** ③ 결과가 '판매 후보 아님'이고 그 이유 띠가 보이는가 */
  notSaleCandidate: boolean;
  /** 비교하지 않은 URL 여정이 '비교 없이 확정'을 아직 체크하지 않았는가 */
  noComparisonPending: boolean;
  /** 소싱 확정(G2)이 유효한가(게이트를 아직 못 읽었으면 undefined) */
  g2Passed: boolean | undefined;
  /** ④ 결정이 현재 버전이고 입력 대기라 카테고리를 고를 수 있는가 */
  categoryPickable: boolean;
  /** 완료된 ④의 성별과 여정 성별이 달라졌는가 */
  genderChanged: boolean;
  /** 등록 진행 중이거나 제외된 여정이라 이 화면에서 바꿀 수 없는가 */
  blocked: boolean;
}

/**
 * ③·④ 화면 맨 위 '지금 할 일' 글 키(D-41). 화면에 이미 있는 값만 읽어 한 가지를 고른다 — 알 수 없는 상태면 null(줄을 감춘다).
 * 위에서부터 첫 번째로 막힌 일을 말한다: ③(국내 기준가 → 실행) → 소싱 확정(G2)('비교 없이 확정' → [소싱 확정(G2)]) →
 * ④(실행 → 카테고리 고르기). ③이 끝나기 전에는 ④를 말하지 않는다.
 */
export function judgementNowKey(input: JudgementNowInput): JudgementNowKey | null {
  const { pricingStatus } = input;
  if (pricingStatus === undefined) return null;
  // 판매 후보 아님은 여정이 제외 상태로 바뀌어도 이유를 말한다
  if (pricingStatus === 'COMPLETED' && input.notSaleCandidate) return 'notSaleCandidate';
  // 잠긴·제외된 여정은 무엇을 하라고 말할 수 없다(화면의 꺼진 이유 글이 알린다)
  if (input.blocked) return null;
  switch (pricingStatus) {
    case 'NOT_RUN':
      if (input.domesticPriceSaved === undefined) return null;
      return input.domesticPriceSaved ? 'runPricing' : 'enterPrice';
    case 'WAITING_INPUT':
      return 'waitingPrice';
    case 'RUNNING':
      return 'pricingRunning';
    case 'RERUN_REQUIRED':
      return 'rerunPricing';
    case 'FAILED':
      return 'failedPricing';
    case 'COMPLETED':
      if (input.g2Passed === undefined) return null;
      if (!input.g2Passed) return input.noComparisonPending ? 'checkNoComparison' : 'passG2';
      return categoryNowKey(input);
  }
}

/** ③과 G2를 마친 뒤: ④ 상태별 */
function categoryNowKey(input: JudgementNowInput): JudgementNowKey | null {
  switch (input.categoryStatus) {
    case undefined:
      return null;
    case 'NOT_RUN':
      return 'runCategory';
    case 'RUNNING':
      return 'categoryRunning';
    case 'WAITING_INPUT':
      // 결정이 없거나 지난 버전이면 고를 곳이 화면에 없다
      return input.categoryPickable ? 'pickCategory' : null;
    case 'RERUN_REQUIRED':
      return 'rerunCategory';
    case 'FAILED':
      return 'failedCategory';
    case 'COMPLETED':
      return input.genderChanged ? 'genderChanged' : 'done';
  }
}
