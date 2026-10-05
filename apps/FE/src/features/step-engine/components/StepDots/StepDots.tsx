import { cx } from '@/shared/lib/cx';
import { Icon, STEP_STATUS_LABEL, type IconName, type StepStatus } from '@/shared/ui';
import { stepDots, type StepDot as StepDotValue } from '../../model/stepDots';
import type { CandidateStepBrief } from '../../model/types';
import styles from './StepDots.module.css';

const DOT_ICON: Record<StepStatus, IconName> = {
  COMPLETED: 'check',
  RUNNING: 'progress',
  WAITING_INPUT: 'pause',
  RERUN_REQUIRED: 'undo',
  FAILED: 'alert',
  NOT_RUN: 'circle',
};

const DOT_TONE: Record<StepStatus, string> = {
  COMPLETED: 'done',
  RUNNING: 'running',
  WAITING_INPUT: 'waiting',
  RERUN_REQUIRED: 'rerun',
  FAILED: 'failed',
  NOT_RUN: 'idle',
};

/**
 * 단계 점 하나(Main.dc.html '진행 중 여정'의 ②~⑨ 칸): 22px 네모 + 상태 아이콘. 색만으로 구분하지 않도록
 * `role="img"`와 이름('② 완료')을 단다.
 */
export function StepDot({ no, status }: StepDotValue) {
  return (
    <span
      role="img"
      aria-label={`${no} ${STEP_STATUS_LABEL[status]}`}
      data-status={status}
      className={cx(styles.dot, styles[DOT_TONE[status]])}
    >
      <Icon name={DOT_ICON[status]} size={12} strokeWidth={2.5} />
    </span>
  );
}

/** 여정 하나의 단계 점 8개(⑥은 ⑥-1~⑥-3 묶음, model/stepDots.ts의 규칙) */
export function StepDots({ steps }: { steps: readonly CandidateStepBrief[] }) {
  return (
    <span className={styles.row}>
      {stepDots(steps).map((dot) => (
        <StepDot key={dot.no} no={dot.no} status={dot.status} />
      ))}
    </span>
  );
}

/** 점 범례(Main.dc.html 표 아래): 완료 · 입력 대기·재확인 필요 · 재실행 필요 · 실패 · 미실행 */
const LEGEND: readonly { status: StepStatus; label: string }[] = [
  { status: 'COMPLETED', label: '완료' },
  { status: 'WAITING_INPUT', label: '입력 대기·재확인 필요' },
  { status: 'RERUN_REQUIRED', label: '재실행 필요' },
  { status: 'FAILED', label: '실패' },
  { status: 'NOT_RUN', label: '미실행' },
];

export function StepDotLegend() {
  return (
    <ul className={styles.legend} aria-label="단계 점 범례">
      {LEGEND.map((item) => (
        <li key={item.status} className={styles.legendItem}>
          <span className={cx(styles.legendMark, styles[DOT_TONE[item.status]])} aria-hidden="true">
            <Icon name={DOT_ICON[item.status]} size={12} strokeWidth={2.5} />
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
