import { cx } from '@/shared/lib/cx';
import { CANDIDATE_STATUS_LABEL } from '../../model/labels';
import type { CandidateStatus } from '../../model/types';
import styles from './CandidateStatusChip.module.css';

/** 여정 상태 칩 색(Main.dc.html: 승인대기 done 계열, 작업중 회색). 보드에 없는 상태는 가까운 뜻의 색(Proposed) */
const TONE: Record<CandidateStatus, 'done' | 'neutral' | 'waiting' | 'accent' | 'idle'> = {
  TEMP: 'neutral',
  WORKING: 'neutral',
  EXCLUDED: 'idle',
  AWAITING_APPROVAL: 'done',
  VALIDATED: 'done',
  REGISTERING: 'accent',
  RESULT_CHECK_REQUIRED: 'waiting',
  REGISTERED: 'done',
};

/** 여정 상태 칩(대시보드 '진행 중 여정'의 '여정 상태' 열). 글자는 PRD §5.2 상태 이름 */
export function CandidateStatusChip({ status }: { status: CandidateStatus }) {
  return (
    <span className={cx(styles.chip, styles[TONE[status]])} data-status={status}>
      {CANDIDATE_STATUS_LABEL[status]}
    </span>
  );
}
