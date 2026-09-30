import { Banner, Button } from '@/shared/ui';
import { useContinuousRun } from '../../api/useContinuousRunQueries';
import {
  chainStepsText,
  continuousRunTitle,
  skippedStepsText,
  stopReasonText,
} from '../../model/continuousRun';
import { STEP_NAME } from '../../model/labels';
import styles from './ContinuousRunBanner.module.css';

export interface ContinuousRunBannerProps {
  /** 따라갈 연속 실행 묶음(열린 묶음 또는 방금 시작한 묶음) */
  stepChainId: number;
  /** 멈춘 뒤 '닫기' */
  onClose?: () => void;
}

/**
 * 연속 실행 진행·멈춘 이유(F-CW-14·15·16, `GET /continuous-runs/{stepChainId}`). 진행한 단계, 건너뛴 단계(완료·최신),
 * 멈춘 이유를 보인다. 폴링하지 않는다 — SSE `step-run.status-changed`(stepChainId)·`continuous-run.stopped`가 이 묶음을
 * 무효화하면 다시 읽는다. 시안에 없는 띠라 문구는 Proposed(05-1 §7.2 P1-06).
 */
export function ContinuousRunBanner({ stepChainId, onClose }: ContinuousRunBannerProps) {
  const run = useContinuousRun(stepChainId);
  if (!run.data) return null;
  const chain = run.data;
  const ended = chain.endedAt !== null;
  const running = chain.stepRuns.find((r) => r.status === 'RUNNING');
  const tone = !ended || chain.stopReason === 'AWAIT_G4' ? 'info' : 'warning';
  return (
    <Banner
      tone={tone}
      role="status"
      className={styles.banner}
      actions={
        ended && onClose ? (
          <Button size="sm" onClick={onClose}>
            닫기
          </Button>
        ) : undefined
      }
    >
      <div className={styles.body} data-chain={chain.id}>
        <strong className={styles.title}>{continuousRunTitle(chain)}</strong>
        {chain.stepRuns.length > 0 ? (
          <span className={styles.line}>
            실행한 단계: {chainStepsText(chain)}
            {running && !ended ? ` · 지금 ${STEP_NAME[running.stepCode]} 실행 중` : ''}
          </span>
        ) : null}
        {chain.skippedStepCodes.length > 0 ? (
          <span className={styles.line}>완료·최신이라 건너뛴 단계: {skippedStepsText(chain)}</span>
        ) : null}
        {ended && chain.stopReason ? (
          <span className={styles.reason}>
            {stopReasonText(chain.stopReason, chain.stopStepCode)}
          </span>
        ) : null}
      </div>
    </Banner>
  );
}
