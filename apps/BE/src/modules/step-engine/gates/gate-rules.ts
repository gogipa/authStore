import type { GateCode, StepCode, StepStatus } from '../domain/steps.js';

/**
 * 게이트 규칙 상수(P1-06).
 * - 근거 단계(`ck_gate_pass_basis`): G2 → ③ PRICING, G3 → ⑤ THUMBNAIL
 * - 통과할 수 있는 근거 버전 상태(규칙 10, Proposed 세부): G2는 ③ 현재 버전이 COMPLETED. G3은 ⑤가 G3 선택까지 입력 대기로
 *   머물고 선택하면 완료되므로(ERD thumbnail_selection) WAITING_INPUT·COMPLETED. 그 밖은 409 STEP_NOT_COMPLETED
 * - 지문을 다시 계산할 수 있는 현재 버전 상태: 산출물이 있는 COMPLETED·RERUN_REQUIRED(step_run.status)
 */
export const GATE_BASIS_STEP: Readonly<
  Record<GateCode, Extract<StepCode, 'PRICING' | 'THUMBNAIL'>>
> = {
  G2: 'PRICING',
  G3: 'THUMBNAIL',
};

export const GATE_PASSABLE_STATUSES: Readonly<Record<GateCode, readonly StepStatus[]>> = {
  G2: ['COMPLETED'],
  G3: ['WAITING_INPUT', 'COMPLETED'],
};

/** 산출물이 있는 실행 상태(지문 재계산 대상) */
export const OUTPUT_RUN_STATUSES: readonly string[] = ['COMPLETED', 'RERUN_REQUIRED'];

export const GATE_CODES: readonly GateCode[] = ['G2', 'G3'];

/** 공급자가 없는 게이트의 통과 거절 문구(422 INVALID_GATE_CODE, P1-06 Proposed) */
export const GATE_NOT_READY_MESSAGE = '이 게이트는 아직 준비 중이라 통과할 수 없습니다.';
