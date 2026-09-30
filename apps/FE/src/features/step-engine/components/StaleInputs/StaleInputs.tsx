import { useId, useState } from 'react';
import { isApiRequestError } from '@/shared/api/errors';
import type { StepCode } from '@/shared/lib/steps';
import { Button } from '@/shared/ui';
import { useOwnerEdit, useStaleDiff } from '../../api/useStepRunQueries';
import { inputKeyLabel, inputKeyLabels } from '../../model/inputLabels';
import styles from './StaleInputs.module.css';

export interface StaleInputsProps {
  candidateId: number;
  stepCode: StepCode;
  /** candidate_step.stale_inputs(바뀐 입력 이름) */
  staleInputs: readonly string[];
  /** 재실행 필요가 된 현재 버전(그대로 유지의 baseStepRunId) */
  currentStepRunId: number | null;
}

/**
 * '재실행 필요' 사유(F-CW-11·19): '바뀐 입력: 레퍼런스 선택' + '비교 보기'(쓴 버전 ↔ 지금 버전, stale-diff) +
 * ⑥-1 카피만 '그대로 유지'(KEEP_AS_IS, PRD §5.3 규칙 6 — 원산지·판정·업로드·게이트에는 없다).
 */
export function StaleInputs({
  candidateId,
  stepCode,
  staleInputs,
  currentStepRunId,
}: StaleInputsProps) {
  const [open, setOpen] = useState(false);
  const diffId = useId();
  const diff = useStaleDiff(candidateId, stepCode, { enabled: open });
  const keep = useOwnerEdit();
  const keepAllowed = stepCode === 'COPY';

  return (
    <div className={styles.stale}>
      <div className={styles.line}>
        <span className={styles.reason}>
          바뀐 입력: {staleInputs.length > 0 ? inputKeyLabels(staleInputs) : '—'}
        </span>
        <Button
          size="sm"
          aria-expanded={open}
          aria-controls={diffId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '비교 닫기' : '비교 보기'}
        </Button>
        {keepAllowed ? (
          <Button
            size="sm"
            disabled={keep.isPending || currentStepRunId === null}
            onClick={() => {
              if (currentStepRunId === null) return;
              keep.mutate({
                candidateId,
                stepCode,
                body: { ownerAction: 'KEEP_AS_IS', baseStepRunId: currentStepRunId },
              });
            }}
          >
            그대로 유지
          </Button>
        ) : null}
      </div>
      {keep.error ? (
        <p role="alert" className={styles.error}>
          {isApiRequestError(keep.error) ? keep.error.message : '요청을 처리하지 못했습니다.'}
        </p>
      ) : null}
      {open ? (
        <div id={diffId} className={styles.diff}>
          {diff.isError ? (
            <p className={styles.error}>{diff.error.message}</p>
          ) : !diff.data ? (
            <p className={styles.hint}>바뀐 입력을 불러오는 중입니다.</p>
          ) : (
            <ul className={styles.list} aria-label="입력 비교">
              {diff.data.inputs.map((input) => (
                <li key={input.inputKey} className={styles.item}>
                  <span className={styles.key}>{inputKeyLabel(input.inputKey)}</span>
                  <span className={input.changed ? styles.changed : styles.same}>
                    {input.changed ? '바뀜' : '같음'}
                  </span>
                  {input.usedSourceStepRunId !== null || input.currentSourceStepRunId !== null ? (
                    <span className={styles.versions}>
                      쓴 실행 #{input.usedSourceStepRunId ?? '—'} → 지금 #
                      {input.currentSourceStepRunId ?? '—'}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
