import type { components } from '@/shared/api/schema';

/** 단계 상태 코드(ERD §4.1, 05-2 StepStatus). API 값 그대로 받는다. */
export type StepStatus = components['schemas']['StepStatus'];
export type StepFailureKind = components['schemas']['StepFailureKind'];

/** 상태 코드 → 화면 글자(04-3 §3, 공통부품 §C). */
export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  COMPLETED: '완료',
  RUNNING: '실행중',
  WAITING_INPUT: '입력 대기',
  RERUN_REQUIRED: '재실행 필요',
  FAILED: '실패',
  NOT_RUN: '미실행',
};

/** `FAILED` + `failureKind=INTERRUPTED`(05-1 §1.1)이면 '실패(중단됨)'. 칩 모양은 같다. */
export function stepStatusLabel(status: StepStatus, detail?: StepFailureKind | null): string {
  if (status === 'FAILED' && detail === 'INTERRUPTED') return '실패(중단됨)';
  return STEP_STATUS_LABEL[status];
}
