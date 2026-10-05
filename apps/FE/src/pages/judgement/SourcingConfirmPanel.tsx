import { useId } from 'react';
import { confirmedValuesText, type PriceJudgementDetail } from '@/features/pricing';
import {
  useConfirmNoComparisonMutation,
  usePassGate,
  useRevokeNoComparisonMutation,
  type CandidateDetail,
} from '@/features/step-engine';
import { isApiRequestError } from '@/shared/api/errors';
import type { components } from '@/shared/api/schema';
import { formatKstTime } from '@/shared/lib/format';
import { Button, Checkbox, DisabledReason, GateBadge } from '@/shared/ui';
import styles from './JudgementPage.module.css';

type GateStateItem = components['schemas']['CandidateGateState'];

export interface SourcingConfirmPanelProps {
  candidateId: number;
  candidate: CandidateDetail | undefined;
  /** ③ 현재 버전의 판정(없으면 확정할 수 없다) */
  judgement: PriceJudgementDetail | undefined;
  /** G2 게이트 상태(listCandidateGates) */
  gate: GateStateItem | undefined;
  /** ② 현재 버전이 비교를 하지 않은 URL 여정인가 — '비교 없이 확정'은 이때만 보인다 */
  uncompared: boolean;
}

/** '비교 없이 확정' 설명(보드 그대로) */
export const NO_COMPARISON_CAPTION = 'URL 여정만 체크합니다';

/**
 * '소싱 확정'(G2) 패널(Judgement.dc.html, F-PJ-02·20, P1-06 게이트 규약). 게이트 배지 · 통과 줄('통과 · 14:06 · 비교 결과로 확정') ·
 * 확정한 값('판매 사이즈 5개 · 167,300원 단일가') · '비교 없이 확정'(비교하지 않은 URL 여정만 보인다 — `PUT`·`DELETE
 * …/no-comparison-confirmation`) · '소싱 확정(G2)' 단추(P1-06 `usePassGate`, 막힌 이유는 게이트 목록의 blockedReasons).
 */
export function SourcingConfirmPanel({
  candidateId,
  candidate,
  judgement,
  gate,
  uncompared,
}: SourcingConfirmPanelProps) {
  const titleId = useId();
  const reasonId = useId();
  const pass = usePassGate();
  const confirm = useConfirmNoComparisonMutation();
  const revoke = useRevokeNoComparisonMutation();
  const valid = gate?.fingerprintValid === true;
  const state = valid ? 'passed' : judgement ? 'pending' : 'locked';
  const blocked = gate?.blockedReasons ?? [];
  const reason = !judgement
    ? '③ 판정을 마친 뒤 확정할 수 있습니다.'
    : judgement.stepStatus !== 'COMPLETED'
      ? '③ 판정을 다시 실행한 뒤 확정할 수 있습니다.'
      : (blocked[0]?.message ?? null);
  const checked = candidate?.noComparisonConfirmedAt != null;
  const mutationError = [pass.error, confirm.error, revoke.error].find(Boolean);
  const errorText = mutationError
    ? isApiRequestError(mutationError)
      ? mutationError.message
      : '요청을 처리하지 못했습니다.'
    : null;

  return (
    <section aria-labelledby={titleId} className={styles.panel}>
      <div className={styles.panelHead}>
        <h3 id={titleId} className={styles.panelTitle}>
          소싱 확정
        </h3>
        <GateBadge gate="G2" state={state} />
      </div>
      {valid && gate?.passedAt ? (
        <p className={styles.body}>
          통과 · <span className={styles.mono}>{formatKstTime(gate.passedAt)}</span> ·{' '}
          {uncompared ? '비교 없이 확정' : '비교 결과로 확정'}
          {candidate?.itemCode ? `(${candidate.itemCode})` : ''}
        </p>
      ) : gate?.passed && !valid ? (
        <p className={styles.body}>판정 값이 바뀌어 소싱 확정(G2)을 다시 통과해야 합니다.</p>
      ) : null}
      {judgement ? (
        <p className={styles.caption}>확정한 값: {confirmedValuesText(judgement)}</p>
      ) : null}
      {uncompared ? (
        <Checkbox
          label="비교 없이 확정"
          description={NO_COMPARISON_CAPTION}
          checked={checked}
          disabled={confirm.isPending || revoke.isPending || !!candidate?.locked}
          onChange={(e) => {
            confirm.reset();
            revoke.reset();
            if (e.target.checked) confirm.mutate(candidateId);
            else revoke.mutate(candidateId);
          }}
        />
      ) : null}
      {!valid ? (
        <div className={styles.confirmRow}>
          <Button
            variant="primary"
            disabled={reason !== null || pass.isPending}
            aria-describedby={reason ? reasonId : undefined}
            onClick={() => {
              if (!judgement) return;
              pass.reset();
              pass.mutate({
                candidateId,
                gate: 'G2',
                body: { basisStepRunId: judgement.stepRunId },
              });
            }}
          >
            소싱 확정(G2)
          </Button>
          {reason ? (
            <DisabledReason id={reasonId} tone="waiting">
              {reason}
            </DisabledReason>
          ) : null}
        </div>
      ) : null}
      {errorText ? (
        <p role="alert" className={styles.error}>
          {errorText}
        </p>
      ) : null}
    </section>
  );
}
