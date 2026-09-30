import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { inputKeyLabels } from '@/features/step-engine';
import { cx } from '@/shared/lib/cx';
import {
  GATE_LABEL,
  STEP_RAIL,
  STEP_SCREEN,
  stepPath,
  type GateCode,
  type RailRow,
  type StepCode,
  type StepScreen,
} from '@/shared/lib/steps';
import {
  GateBadge,
  StatusChip,
  type GateState,
  type StepFailureKind,
  type StepStatus,
} from '@/shared/ui';
import styles from './StepRail.module.css';

/** 레일 한 행의 상태(API 코드 그대로). */
export interface RailStepStatus {
  status: StepStatus;
  failureKind?: StepFailureKind | null;
}

export interface StepRailProps {
  candidateId: string;
  currentScreen?: StepScreen;
  /** 단계 코드별 상태. 없는 단계는 칩을 그리지 않는다. 값은 P1-05(listCandidateSteps)가 넣는다. */
  statuses?: Partial<Record<StepCode, RailStepStatus>>;
  /** 묶음 행(⑥ 상세 콘텐츠)의 상태. 키는 묶음 화면('content'). */
  groupStatuses?: Partial<Record<StepScreen, RailStepStatus>>;
  /** 게이트별 상태. 없으면 게이트 이름만 잠김 색으로 보인다. 값은 P1-06(listCandidateGates)이 넣는다. */
  gates?: Partial<Record<GateCode, GateState>>;
  /** 레일 아래 자리: '재실행 필요 단계 모두 실행' 버튼과 꺼진 이유(P1-05). */
  footer?: ReactNode;
  /** 재실행 필요 사유(바뀐 입력 이름, candidate_step.stale_inputs). 행 아래 '바뀐 입력: …'으로 보인다(F-CW-11) */
  staleInputs?: Partial<Record<StepCode, readonly string[]>>;
  /** 레일 맨 위 배지 자리: URL로 만든 후보의 '수동'·'비교 안 함'(F-CW-12) */
  badges?: ReactNode;
}

function rowScreen(row: RailRow): StepScreen | undefined {
  if (row.kind === 'gate') return undefined;
  return row.kind === 'group' ? row.screen : STEP_SCREEN[row.code];
}

/** 게이트 상태를 모를 때: 테두리 마름모 + 이름(상태 글 없음). */
function UnknownGate({ gate }: { gate: GateCode }) {
  return (
    <span className={styles.gateName}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <rect
          x="2"
          y="2"
          width="6"
          height="6"
          transform="rotate(45 5 5)"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      </svg>
      {gate} {GATE_LABEL[gate]}
    </span>
  );
}

/**
 * 단계 레일(공통부품_마크업.md §G). 행과 순서는 shared/lib/steps.ts의 STEP_RAIL에서 만든다.
 * 현재 화면을 맡는 첫 행에 aria-current="step"을 단다(판정 화면이면 ③, 콘텐츠면 ⑥, 최종 승인이면 ⑧).
 * 행 오른쪽에 StatusChip, 게이트 줄에 GateBadge를 그린다. 값이 없으면 칩을 그리지 않는다.
 * 재실행 필요 행 아래에 바뀐 입력 이름(P1-05), 맨 위에 URL 후보 배지를 둔다.
 */
export function StepRail({
  candidateId,
  currentScreen,
  statuses,
  groupStatuses,
  gates,
  footer,
  staleInputs,
  badges,
}: StepRailProps) {
  const currentIndex = currentScreen
    ? STEP_RAIL.findIndex((row) => rowScreen(row) === currentScreen)
    : -1;

  return (
    <nav aria-label="단계" className={styles.rail}>
      {badges !== undefined ? <div className={styles.badges}>{badges}</div> : null}
      {STEP_RAIL.map((row, index) => {
        if (row.kind === 'gate') {
          const state = gates?.[row.gate];
          return (
            <div key={row.gate} className={styles.gate}>
              {state ? (
                <GateBadge gate={row.gate} state={state} />
              ) : (
                <UnknownGate gate={row.gate} />
              )}
            </div>
          );
        }

        const to =
          row.kind === 'group'
            ? `/candidates/${encodeURIComponent(candidateId)}/${row.screen}`
            : stepPath(candidateId, row.code);
        const current = index === currentIndex;
        const sub = row.kind === 'step' && row.sub;
        const rowStatus = row.kind === 'group' ? groupStatuses?.[row.screen] : statuses?.[row.code];

        const stale = row.kind === 'step' ? staleInputs?.[row.code] : undefined;
        return (
          <Fragment key={row.kind === 'step' ? row.code : row.no}>
            <Link
              to={to}
              aria-current={current ? 'step' : undefined}
              className={cx(styles.row, sub && styles.sub, current && styles.current)}
            >
              {sub ? null : <span className={styles.no}>{row.no}</span>}
              <span className={styles.label}>{sub ? `${row.no} ${row.label}` : row.label}</span>
              {rowStatus ? (
                <StatusChip status={rowStatus.status} detail={rowStatus.failureKind} />
              ) : null}
            </Link>
            {stale && stale.length > 0 ? (
              <span className={cx(styles.stale, sub && styles.staleSub)}>
                바뀐 입력: {inputKeyLabels(stale)}
              </span>
            ) : null}
          </Fragment>
        );
      })}
      {footer !== undefined ? <div className={styles.footer}>{footer}</div> : null}
    </nav>
  );
}
