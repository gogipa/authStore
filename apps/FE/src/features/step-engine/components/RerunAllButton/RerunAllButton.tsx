import { isApiRequestError } from '@/shared/api/errors';
import { Button, DisabledReason } from '@/shared/ui';
import { useStartContinuousRun } from '../../api/useContinuousRunQueries';
import { NO_RERUN_TEXT, RERUN_ALL_LABEL } from '../../model/continuousRun';
import type { ContinuousRunAccepted } from '../../model/types';
import styles from './RerunAllButton.module.css';

/** 열린 묶음이 있을 때(05-3 CONTINUOUS_RUN_ALREADY_OPEN 문구) */
const ALREADY_OPEN_TEXT = '이 후보의 연속 실행이 이미 진행 중입니다.';
/** 등록 진행 잠금·제외(05-3 CANDIDATE_LOCKED 문구를 줄였다) */
const LOCKED_TEXT = '등록을 진행 중이거나 끝난 후보라 실행할 수 없습니다';

export interface RerunAllButtonProps {
  candidateId: number;
  /** '재실행 필요' 단계 수(단계 레일) */
  rerunCount: number;
  /** 열린 연속 실행이 있는가(후보 상세 openContinuousRun) */
  chainOpen: boolean;
  /** 등록 진행 잠금(후보 상세 locked) */
  locked: boolean;
  /** 이유 글 자리: 단계 표 머리는 버튼 앞(시안), 단계 레일 아래는 버튼 뒤 */
  reasonPosition?: 'before' | 'after';
  size?: 'md' | 'sm';
  id: string;
  onStarted?: (accepted: ContinuousRunAccepted) => void;
}

/**
 * '재실행 필요 단계 모두 실행'(F-CW-16, CandidateWork.dc.html 표 위): POST …/continuous-runs `{ kind: RERUN_STALE }` 한 번.
 * 재실행 필요 단계가 없으면 꺼지고 '재실행 필요 단계가 없습니다'. 서버가 흐름 순서로 돌리고 오너 입력·게이트에서 멈춘다.
 */
export function RerunAllButton({
  candidateId,
  rerunCount,
  chainOpen,
  locked,
  reasonPosition = 'before',
  size = 'md',
  id,
  onStarted,
}: RerunAllButtonProps) {
  const start = useStartContinuousRun();
  const reason =
    rerunCount === 0 ? NO_RERUN_TEXT : chainOpen ? ALREADY_OPEN_TEXT : locked ? LOCKED_TEXT : null;
  const reasonNode = reason ? (
    <DisabledReason id={id} tone="muted">
      {reason}
    </DisabledReason>
  ) : null;
  return (
    <>
      {reasonPosition === 'before' ? reasonNode : null}
      <Button
        size={size}
        disabled={reason !== null || start.isPending}
        aria-describedby={reason ? id : undefined}
        onClick={() => {
          start.reset();
          start.mutate(
            { candidateId, body: { kind: 'RERUN_STALE' } },
            { onSuccess: (accepted) => onStarted?.(accepted) },
          );
        }}
      >
        {RERUN_ALL_LABEL}
      </Button>
      {reasonPosition === 'after' ? reasonNode : null}
      {start.error ? (
        <span role="alert" className={styles.error}>
          {isApiRequestError(start.error)
            ? start.error.message
            : '연속 실행을 요청하지 못했습니다.'}
        </span>
      ) : null}
    </>
  );
}
