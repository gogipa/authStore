import { cx } from '@/shared/lib/cx';
import type { GateCode } from '@/shared/lib/steps';
import { gateBadgeLabel, type GateState } from './gateLabel';
import styles from './GateBadge.module.css';

export interface GateBadgeProps {
  gate: GateCode;
  state: GateState;
}

/** 게이트 표시(공통부품 §D): 10px 마름모 + 'G2 판정 확정 · 통과'. 잠김이면 마름모를 테두리만 그린다. */
export function GateBadge({ gate, state }: GateBadgeProps) {
  const filled = state !== 'locked';
  return (
    <span className={cx(styles.badge, styles[state])} data-gate={gate}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <rect
          x="2"
          y="2"
          width="6"
          height="6"
          transform="rotate(45 5 5)"
          fill={filled ? 'currentColor' : 'none'}
          stroke={filled ? undefined : 'currentColor'}
          strokeWidth={filled ? undefined : 1.2}
        />
      </svg>
      {gateBadgeLabel(gate, state)}
    </span>
  );
}
