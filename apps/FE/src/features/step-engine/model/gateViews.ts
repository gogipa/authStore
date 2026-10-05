import type { GateCode } from '@/shared/lib/steps';
import type { GateState } from '@/shared/ui';
import type { CandidateDetail, CandidateGateState } from './types';

export interface CandidateGateView {
  gate: GateCode;
  state: GateState;
}

type GateDetail = Pick<CandidateDetail, 'gates' | 'approvedAt' | 'status'>;

/** G4: 승인 기록이 있으면 통과, 승인대기·검증완료면 확인 필요, 아니면 잠김 */
function g4State(detail: GateDetail, approved: boolean): GateState {
  if (approved) return 'passed';
  return detail.status === 'AWAITING_APPROVAL' || detail.status === 'VALIDATED'
    ? 'pending'
    : 'locked';
}

/** G2·G3 통과 여부 → 배지(G3은 G2가 통과해야 확인 필요, 아니면 잠김) */
function views(g2: boolean, g3: boolean, g4: GateState): CandidateGateView[] {
  return [
    { gate: 'G2', state: g2 ? 'passed' : 'pending' },
    { gate: 'G3', state: g3 ? 'passed' : g2 ? 'pending' : 'locked' },
    { gate: 'G4', state: g4 },
  ];
}

/**
 * 여정 머리·레일의 게이트 표시(여정 상세만으로). 게이트 목록(`listCandidateGates`)을 아직 받지 못했을 때 쓴다.
 * - G2: 유효하면 통과, 아니면 확인 필요 · G3: 유효하면 통과, G2가 통과했으면 확인 필요, 아니면 잠김
 * - G4: 승인 시각이 있으면 통과, 승인대기·검증완료면 확인 필요, 아니면 잠김
 */
export function candidateGateViews(detail: GateDetail): CandidateGateView[] {
  const valid = (gate: 'G2' | 'G3') => detail.gates.find((g) => g.gate === gate)?.valid === true;
  return views(valid('G2'), valid('G3'), g4State(detail, detail.approvedAt !== null));
}

/**
 * 게이트 목록(`GET …/gates`, P1-06)으로 그린 게이트 표시. passed = 지금 유효하게 통과(지문 일치). G4 확인 필요는 여정 상태로
 * 정한다(승인대기·검증완료). 목록이 없으면 여정 상세로 그린다.
 */
export function gateViewsFromList(
  items: readonly CandidateGateState[] | undefined,
  detail: GateDetail,
): CandidateGateView[] {
  if (!items) return candidateGateViews(detail);
  const passed = (gate: CandidateGateState['gate']) =>
    items.find((item) => item.gate === gate)?.passed === true;
  return views(passed('G2'), passed('G3'), g4State(detail, passed('G4')));
}

/** 배지 목록 → 게이트별 상태(레일·단계 표) */
export function gateStateMap(
  list: readonly CandidateGateView[],
): Partial<Record<GateCode, GateState>> {
  return Object.fromEntries(list.map((view) => [view.gate, view.state])) as Partial<
    Record<GateCode, GateState>
  >;
}
