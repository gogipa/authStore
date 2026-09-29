import { GATE_LABEL, type GateCode } from '@/shared/lib/steps';

/** passed 통과 · pending 확인 필요 · locked 잠김(04-3 §3, 공통부품 §D). */
export type GateState = 'passed' | 'pending' | 'locked';

const STATE_SUFFIX: Record<GateState, string> = {
  passed: ' · 통과',
  pending: ' · 확인 필요',
  locked: ' · 잠김',
};

/** 'G2 판정 확정 · 통과'. 게이트 이름은 steps.ts의 GATE_LABEL. */
export function gateBadgeLabel(gate: GateCode, state: GateState): string {
  return `${gate} ${GATE_LABEL[gate]}${STATE_SUFFIX[state]}`;
}
