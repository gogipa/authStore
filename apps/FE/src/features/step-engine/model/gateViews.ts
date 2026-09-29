import type { GateCode } from '@/shared/lib/steps';
import type { GateState } from '@/shared/ui';
import type { CandidateDetail } from './types';

export interface CandidateGateView {
  gate: GateCode;
  state: GateState;
}

/**
 * 후보 머리의 게이트 표시(P1-04 Proposed — P1-06 `listCandidateGates`가 오면 그 값으로 바꾼다).
 * - G2: 유효하면 통과, 아니면 확인 필요
 * - G3: 유효하면 통과, G2가 통과했으면 확인 필요, 아니면 잠김
 * - G4: 승인 시각이 있으면 통과, 승인대기·검증완료면 확인 필요, 아니면 잠김
 */
export function candidateGateViews(
  detail: Pick<CandidateDetail, 'gates' | 'approvedAt' | 'status'>,
): CandidateGateView[] {
  const valid = (gate: 'G2' | 'G3') => detail.gates.find((g) => g.gate === gate)?.valid === true;
  const g2: GateState = valid('G2') ? 'passed' : 'pending';
  const g3: GateState = valid('G3') ? 'passed' : g2 === 'passed' ? 'pending' : 'locked';
  const g4: GateState = detail.approvedAt
    ? 'passed'
    : detail.status === 'AWAITING_APPROVAL' || detail.status === 'VALIDATED'
      ? 'pending'
      : 'locked';
  return [
    { gate: 'G2', state: g2 },
    { gate: 'G3', state: g3 },
    { gate: 'G4', state: g4 },
  ];
}
