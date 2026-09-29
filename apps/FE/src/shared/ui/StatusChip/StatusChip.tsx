import { cx } from '@/shared/lib/cx';
import { Icon } from '../Icon/Icon';
import type { IconName } from '../Icon/icons';
import { stepStatusLabel, type StepFailureKind, type StepStatus } from './statusLabel';
import styles from './StatusChip.module.css';

type StatusTone = 'done' | 'running' | 'waiting' | 'rerun' | 'failed' | 'idle';

const STATUS_TONE: Record<StepStatus, StatusTone> = {
  COMPLETED: 'done',
  RUNNING: 'running',
  WAITING_INPUT: 'waiting',
  RERUN_REQUIRED: 'rerun',
  FAILED: 'failed',
  NOT_RUN: 'idle',
};

/** 상태마다 아이콘 하나로 고정한다(공통부품 §C). */
const STATUS_ICON: Record<StepStatus, IconName> = {
  COMPLETED: 'check',
  RUNNING: 'progress',
  WAITING_INPUT: 'pause',
  RERUN_REQUIRED: 'undo',
  FAILED: 'alert',
  NOT_RUN: 'circle',
};

export interface StatusChipProps {
  /** API 코드 그대로(`COMPLETED` …). 글자는 부품이 정한다. */
  status: StepStatus;
  /** 실패 종류(05-1 §1.1). `INTERRUPTED`면 `FAILED`의 글자를 '실패(중단됨)'으로 바꾼다. 칩 모양은 같다. */
  detail?: StepFailureKind | null;
}

/** 단계 상태 칩(공통부품 §C). 색만으로 구분하지 않도록 아이콘과 글자를 함께 둔다. */
export function StatusChip({ status, detail }: StatusChipProps) {
  return (
    <span className={cx(styles.chip, styles[STATUS_TONE[status]])} data-status={status}>
      <Icon name={STATUS_ICON[status]} size={12} strokeWidth={2.5} />
      {stepStatusLabel(status, detail)}
    </span>
  );
}
