import {
  ADULT_CONFIRM_LABEL,
  adultConfirmDescription,
  type AdultConfirmationState,
} from '@/features/sourcing';
import { formatKstTime } from '@/shared/lib/format';
import { Checkbox } from '@/shared/ui';
import styles from './AdultConfirmPanel.module.css';

export interface AdultConfirmPanelProps {
  /** 현재 ② 버전의 성인용 확인 상태(`adultConfirmationOf`) */
  state: AdultConfirmationState;
  pending: boolean;
  /** 요청 오류 문구 */
  error?: string | null;
  onConfirm: () => void;
}

/**
 * '성인용 상품 확인'(Sourcing.dc.html URL 패널 오른쪽 220px, F-SO-06): 아동화 의심(최대 235mm 이하)·대상 외 장르로
 * 멈춘 ②(입력 대기)에서만 켠다. 체크하면 `confirmSourcingAdultProduct`(웹 화면 전용 기록) → 멈춘 ②가 이어진다.
 * 이미 체크했으면 체크된 채 꺼지고 확인 시각을 보인다. ④ 'KC 면제 성인용 확인'과 따로다.
 */
export function AdultConfirmPanel({ state, pending, error, onConfirm }: AdultConfirmPanelProps) {
  const confirmed = state.confirmedAt !== null;
  return (
    <div className={styles.box}>
      <Checkbox
        label={ADULT_CONFIRM_LABEL}
        description={adultConfirmDescription(state.maxMm)}
        checked={confirmed}
        disabled={!state.canConfirm || pending}
        onChange={(e) => {
          if (e.target.checked) onConfirm();
        }}
      />
      {confirmed && state.confirmedAt ? (
        <span className={styles.caption}>{formatKstTime(state.confirmedAt)} 확인함</span>
      ) : null}
      {error ? (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
