import type { GateFlags } from './resume.js';
import {
  REQUIRED_STEPS,
  stepStatusOf,
  type AutoExclusionReason,
  type CandidateStatus,
  type CandidateStatusReason,
  type StepStatusMap,
} from './steps.js';

/** 전이 한 건(상태·사유) */
export interface CandidateStatusChange {
  toStatus: CandidateStatus;
  reason: CandidateStatusReason;
}

/** 재평가 때 함께 넘기는 사정 */
export interface TransitionEffect {
  /** 단계 결과가 낸 제외 사유(앵커 일치 없음·재고 부족·판매 후보 아님) */
  exclusion?: AutoExclusionReason | null;
  /**
   * ck_candidate_ready 값(itemCode·anchorColorCode·gender·leafCategoryId)이 모두 있는가. 없으면 승인대기로 올리지 않는다
   * (CHECK 위반으로 500이 나지 않게, P1-04 §8). 주지 않으면 있다고 본다(서비스는 늘 DB 값으로 계산해 넘긴다).
   */
  ready?: boolean;
}

/** 필수 9단계가 모두 완료·최신인가. '최신'은 지문 일치만 본다(6시간 경과는 보지 않는다, PRD §5.3 판정 유효 시간) */
export function requiredStepsCurrent(steps: StepStatusMap): boolean {
  return REQUIRED_STEPS.every((code) => stepStatusOf(steps, code) === 'COMPLETED');
}

/** 승인대기 이상에 필요한 값(ck_candidate_ready) */
export function hasReadyFields(candidate: {
  itemCode: string | null;
  anchorColorCode: string | null;
  gender: string | null;
  leafCategoryId: string | null;
}): boolean {
  return (
    candidate.itemCode !== null &&
    candidate.anchorColorCode !== null &&
    candidate.gender !== null &&
    candidate.leafCategoryId !== null
  );
}

const EXCLUDABLE: readonly CandidateStatus[] = ['WORKING', 'AWAITING_APPROVAL', 'VALIDATED'];

/**
 * 후보 상태 자동 전환(F-CW-05, PRD §5.2 상태도). 바꿀 것이 없으면 null.
 * - 작업중·승인대기·검증완료 + 단계 결과 제외 사유 → 제외(사유 = excluded_reason 같은 코드)
 * - 작업중 + 필수 9단계 완료 + G2·G3 유효 + ck_candidate_ready 값 있음 → 승인대기(READY_FOR_APPROVAL)
 * - 승인대기·검증완료 + 필수 단계 하나라도 완료 아님 → 작업중(STEP_NOT_CURRENT)
 * - 승인대기·검증완료 + G2·G3 중 하나라도 무효 → 작업중(GATE_FINGERPRINT_CHANGED)
 * 임시·제외·등록 진행(잠금) 상태는 여기서 바꾸지 않는다(연결·다시 작업·등록 흐름이 따로 바꾼다).
 * ⑨ REGISTER는 필수에 넣지 않는다. 페이지 수집 6시간 경과는 보지 않는다(승인 화면의 재조회가 푼다).
 */
export function nextCandidateStatus(
  status: CandidateStatus,
  steps: StepStatusMap,
  gates: GateFlags,
  effect: TransitionEffect = {},
): CandidateStatusChange | null {
  if (effect.exclusion && EXCLUDABLE.includes(status)) {
    return { toStatus: 'EXCLUDED', reason: effect.exclusion };
  }
  const stepsCurrent = requiredStepsCurrent(steps);
  const gatesValid = gates.G2 && gates.G3;
  const ready = effect.ready ?? true;

  if (status === 'WORKING') {
    return stepsCurrent && gatesValid && ready
      ? { toStatus: 'AWAITING_APPROVAL', reason: 'READY_FOR_APPROVAL' }
      : null;
  }
  if (status === 'AWAITING_APPROVAL' || status === 'VALIDATED') {
    if (!stepsCurrent || !ready) return { toStatus: 'WORKING', reason: 'STEP_NOT_CURRENT' };
    if (!gatesValid) return { toStatus: 'WORKING', reason: 'GATE_FINGERPRINT_CHANGED' };
    return null;
  }
  return null;
}
