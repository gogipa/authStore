import { isApiRequestError } from '@/shared/api/errors';
import type { StepCode } from '@/shared/lib/steps';
import { Button, DisabledReason } from '@/shared/ui';
import { useStartContinuousRun } from '../../api/useContinuousRunQueries';
import { AiEngineSettingsLinkForError } from '../AiEngineSettingsLink/AiEngineSettingsLink';
import { BEFORE_G2_CHAIN_TEXT, CONTINUOUS_RUN_LABEL } from '../../model/continuousRun';
import type { ContinuousRunAccepted, StepActionState } from '../../model/types';
import styles from './ContinuousRunButton.module.css';

/** 연속 실행을 시작할 수 있는 단계(⑨ 제외, 05-2 ContinuousRunStartRequest.startStepCode) */
export type ChainStartStepCode = Exclude<StepCode, 'REGISTER'>;

export interface ContinuousRunButtonProps {
  candidateId: number;
  /** 고른 단계(FROM_HERE startStepCode) */
  stepCode: ChainStartStepCode;
  /** 레일 `actions.continuousRun`(연속 실행 API의 409·422와 같은 계산). 없으면 꺼진다 */
  action: StepActionState | undefined;
  /**
   * 꺼진 이유 글이 이미 화면에 있으면 그 id(예: 단계 표의 G2 줄 설명, 같은 이유로 꺼진 '실행' 옆 글). 주지 않으면 버튼 옆에
   * 이유 글을 그린다(G2 전 ④ 이후는 시안 글 '판정(G2)을 통과해야 ④부터 …').
   */
  describedBy?: string;
  ariaLabel?: string;
  /** 202를 받으면(배너가 이 묶음을 따라간다) */
  onStarted?: (accepted: ContinuousRunAccepted) => void;
}

/**
 * '여기부터 연속 실행'(F-CW-14·15, CandidateWork.dc.html). POST …/continuous-runs `{ kind: FROM_HERE, startStepCode }` 한 번.
 * 진행은 폴링하지 않고 SSE 뒤 다시 읽는다. 409·422는 message를 그대로 보인다.
 */
export function ContinuousRunButton({
  candidateId,
  stepCode,
  action,
  describedBy,
  ariaLabel,
  onStarted,
}: ContinuousRunButtonProps) {
  const start = useStartContinuousRun();
  const reason = action && !action.enabled ? action.disabledReason : null;
  const ownReasonId = `chain-why-${stepCode}`;
  const reasonText =
    reason?.code === 'CONTINUOUS_RUN_BEFORE_G2' ? BEFORE_G2_CHAIN_TEXT : (reason?.message ?? null);
  const describedById = reason ? (describedBy ?? ownReasonId) : undefined;
  return (
    <>
      <Button
        size="sm"
        disabled={!action || !action.enabled || start.isPending}
        aria-describedby={describedById}
        aria-label={ariaLabel}
        onClick={() => {
          start.reset();
          start.mutate(
            { candidateId, body: { kind: 'FROM_HERE', startStepCode: stepCode } },
            { onSuccess: (accepted) => onStarted?.(accepted) },
          );
        }}
      >
        {CONTINUOUS_RUN_LABEL}
      </Button>
      {reason && !describedBy && reasonText ? (
        <DisabledReason id={ownReasonId}>{reasonText}</DisabledReason>
      ) : null}
      {start.error ? (
        <span role="alert" className={styles.error}>
          {isApiRequestError(start.error)
            ? start.error.message
            : '연속 실행을 요청하지 못했습니다.'}{' '}
          <AiEngineSettingsLinkForError error={start.error} />
        </span>
      ) : null}
    </>
  );
}
