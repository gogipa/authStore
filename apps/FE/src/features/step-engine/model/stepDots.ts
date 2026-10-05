import type { StepCode } from '@/shared/lib/steps';
import type { StepStatus } from '@/shared/ui';
import type { CandidateStepBrief } from './types';

/** 대시보드 '진행 중 여정'의 단계 점 8개(②~⑨). ⑥은 ⑥-1~⑥-3을 묶은 점 하나다(Main.dc.html) */
export const STEP_DOT_GROUPS: readonly { no: string; codes: readonly StepCode[] }[] = [
  { no: '②', codes: ['SOURCING'] },
  { no: '③', codes: ['PRICING'] },
  { no: '④', codes: ['CATEGORY'] },
  { no: '⑤', codes: ['THUMBNAIL'] },
  { no: '⑥', codes: ['COPY', 'NOTICE_RAW', 'NOTICE_HTML'] },
  { no: '⑦', codes: ['TAGS'] },
  { no: '⑧', codes: ['UPLOAD'] },
  { no: '⑨', codes: ['REGISTER'] },
];

/**
 * 묶음(⑥) 상태: 하위 단계 상태 중 이 순서로 앞선 것(P1-04 Proposed, 05-1 §7.2).
 * 실패 > 재실행 필요 > 입력 대기 > 실행중 > 미실행 > 완료. 하나라도 할 일이 남으면 완료로 보이지 않는다.
 * 단계 레일의 '⑥ 상세 콘텐츠' 줄(P1-05)도 같은 규칙을 쓴다.
 */
export const GROUP_STATUS_PRIORITY: readonly StepStatus[] = [
  'FAILED',
  'RERUN_REQUIRED',
  'WAITING_INPUT',
  'RUNNING',
  'NOT_RUN',
  'COMPLETED',
];

export function groupStepStatus(statuses: readonly StepStatus[]): StepStatus {
  return GROUP_STATUS_PRIORITY.find((s) => statuses.includes(s)) ?? 'NOT_RUN';
}

export interface StepDot {
  no: string;
  status: StepStatus;
}

/** 여정의 단계 10개 → 점 8개 */
export function stepDots(steps: readonly CandidateStepBrief[]): StepDot[] {
  const byCode = new Map(steps.map((s) => [s.stepCode, s.status]));
  return STEP_DOT_GROUPS.map((group) => ({
    no: group.no,
    status: groupStepStatus(group.codes.map((code) => byCode.get(code) ?? 'NOT_RUN')),
  }));
}

/** 이어 할 단계의 상태(목록 줄의 상태 칩) */
export function stepStatusOf(
  steps: readonly CandidateStepBrief[],
  stepCode: StepCode | null | undefined,
): StepStatus | null {
  if (!stepCode) return null;
  return steps.find((s) => s.stepCode === stepCode)?.status ?? null;
}
