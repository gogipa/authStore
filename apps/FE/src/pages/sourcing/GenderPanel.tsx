import { useId, useState } from 'react';
import {
  comparisonGender,
  comparisonParams,
  GENDER_LABEL,
  targetRangeText,
  type CandidateGenderLike,
  type ComparisonGender,
  type SourcingComparisonDetail,
  useInvalidateSourcing,
} from '@/features/sourcing';
import { useSetCandidateGender } from '@/features/step-engine';
import { isApiRequestError } from '@/shared/api/errors';
import { Button, Chip, DisabledReason, Radio } from '@/shared/ui';
import styles from './GenderPanel.module.css';

export interface GenderPanelProps {
  candidateId: number | null;
  candidate: (CandidateGenderLike & { locked: boolean }) | undefined;
  head: SourcingComparisonDetail | undefined;
}

/** 성별을 몰라 목표 사이즈를 정할 수 없을 때(F-SO-19) */
export const GENDER_REQUIRED_TEXT =
  '성별을 판단하지 못했습니다. 골라 주면 목표 사이즈 범위로 재고를 다시 봅니다.';

/**
 * SCR-03 '성별 확인'(Sourcing.dc.html 검색 조건 오른쪽, F-SO-18·19, P2-03 규칙 5): '성별 확인 · 자동' + '남성 250~290mm' +
 * '바꾸기'. 오너가 고른 성별이면 '· 직접', ②의 판단과 다르면 '재확인 필요'. 앵커 뒤 성별을 몰라 ②가 기다리면 곧바로
 * 남성·여성 라디오를 보인다. 고르면 `setCandidateGender`(P1-04) — 열린 ②가 이어 간다(페이지 조회·재고 다시 계산).
 */
export function GenderPanel({ candidateId, candidate, head }: GenderPanelProps) {
  const uid = useId();
  const setGender = useSetCandidateGender();
  const invalidateSourcing = useInvalidateSourcing();
  const [editing, setEditing] = useState(false);
  const params = comparisonParams(head);
  const { gender, source } = comparisonGender(candidate, head);
  const needed =
    !!head &&
    !head.exploreMode &&
    head.comparisonPerformed &&
    head.isCurrent &&
    head.stepStatus === 'WAITING_INPUT' &&
    gender === null;
  const choosing = needed || editing;
  const disabled = candidateId === null || !candidate || candidate.locked || setGender.isPending;

  const choose = (value: ComparisonGender) => {
    if (candidateId === null) return;
    setGender.mutate(
      { candidateId, gender: value },
      {
        onSuccess: () => {
          setEditing(false);
          void invalidateSourcing();
        },
      },
    );
  };
  const error = setGender.error
    ? isApiRequestError(setGender.error)
      ? setGender.error.message
      : '성별을 저장하지 못했습니다.'
    : null;

  return (
    <div className={styles.box}>
      <span className={styles.label}>성별 확인 · {source === 'OWNER' ? '직접' : '자동'}</span>
      {choosing ? (
        <div role="radiogroup" aria-label="여정 성별" className={styles.radios}>
          {(['MALE', 'FEMALE'] as const).map((value) => (
            <Radio
              key={value}
              name={`gender-${uid}`}
              label={`${GENDER_LABEL[value]} ${targetRangeText(value, params)}`}
              checked={gender === value}
              disabled={disabled}
              onChange={() => choose(value)}
            />
          ))}
          {editing && !needed ? (
            <Button size="sm" onClick={() => setEditing(false)}>
              취소
            </Button>
          ) : null}
        </div>
      ) : (
        <div className={styles.value}>
          <span className={styles.lockedBox}>
            {gender ? (
              <>
                {GENDER_LABEL[gender]}{' '}
                <span className={styles.range}>{targetRangeText(gender, params)}</span>
              </>
            ) : (
              '판단 전'
            )}
          </span>
          <Button disabled={disabled} onClick={() => setEditing(true)}>
            {gender ? '바꾸기' : '고르기'}
          </Button>
          {candidate?.genderRecheckRequired ? <Chip tone="waiting">재확인 필요</Chip> : null}
        </div>
      )}
      {needed ? <DisabledReason>{GENDER_REQUIRED_TEXT}</DisabledReason> : null}
      {error ? (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
