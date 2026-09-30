import { useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { useSetCandidateGender } from '@/features/step-engine';
import { isApiRequestError } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import { DisabledReason, Radio } from '@/shared/ui';
import { GENDER_LABEL, GENDER_RECHECK_NOTE, type CategoryGender } from '../../model/category';
import styles from './GenderRecheck.module.css';

export interface GenderRecheckProps {
  candidateId: number;
  /** 지금 성별(④ 결정의 성별 — 재확인 반영 뒤 값) */
  gender: CategoryGender | null;
  /** 성별 출처(후보 `genderSource`): STEP2 = '② 자동 판단', OWNER = '오너 입력' */
  genderSource: 'STEP2' | 'OWNER' | null;
  /** 바꿀 수 없는 이유(④ 입력 대기가 아님·잠긴 후보). 있으면 라디오를 끈다 */
  disabledReason?: string | null;
}

const SOURCE_LABEL: Record<'STEP2' | 'OWNER', string> = {
  STEP2: '출처 ② 자동 판단',
  OWNER: '출처 오너 입력',
};

/**
 * '성별 재확인'(SCR-04 ④, F-CA-05, P2-06 규칙 14): 남성·여성 라디오와 출처, 안내 '바꾸면 카테고리 후보를 다시 뽑고 ③·⑥-3·⑦을
 * 다시 실행해야 합니다.'(보드 그대로). 고르면 곧바로 step-engine 성별 훅(`PUT /candidates/{id}/gender`, P1-04)을 부르고,
 * 끝나면 ④ 결정을 다시 읽는다(서버가 같은 실행에서 후보를 다시 뽑았다).
 */
export function GenderRecheck({
  candidateId,
  gender,
  genderSource,
  disabledReason = null,
}: GenderRecheckProps) {
  const labelId = useId();
  const reasonId = useId();
  const queryClient = useQueryClient();
  const setGender = useSetCandidateGender();
  const error =
    setGender.error && isApiRequestError(setGender.error) ? setGender.error.message : null;
  const disabled = setGender.isPending || disabledReason !== null;

  const change = (next: CategoryGender) => {
    if (next === gender || disabled) return;
    setGender.mutate(
      { candidateId, gender: next },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({
            queryKey: qk('category', 'getCategoryDecision', { candidateId }),
          }),
      },
    );
  };

  return (
    <div className={styles.recheck}>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={disabledReason ? reasonId : undefined}
        className={styles.group}
      >
        <div className={styles.head}>
          <span id={labelId} className={styles.label}>
            성별 재확인
          </span>
          {genderSource ? (
            <span className={styles.source}>{SOURCE_LABEL[genderSource]}</span>
          ) : null}
        </div>
        <div className={styles.options}>
          {(['MALE', 'FEMALE'] as const).map((value) => (
            <Radio
              key={value}
              name={`gender-recheck-${candidateId}`}
              value={value}
              label={GENDER_LABEL[value]}
              checked={gender === value}
              disabled={disabled}
              onChange={() => change(value)}
            />
          ))}
        </div>
      </div>
      <p className={styles.note}>{GENDER_RECHECK_NOTE}</p>
      {disabledReason ? (
        <DisabledReason id={reasonId} tone="muted">
          {disabledReason}
        </DisabledReason>
      ) : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
