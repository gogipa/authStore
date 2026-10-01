import {
  API_BLOCKED_NOTE,
  APPROVE_LABEL,
  REGISTER_TITLE,
  freshnessNote,
  type ApprovalPreview,
} from '@/features/registration';
import { Button, DisabledReason } from '@/shared/ui';
import styles from './ApproveSection.module.css';

export interface ApproveSectionProps {
  preview: ApprovalPreview | undefined;
  /** '사전 검증 13개 모두 통과' 등 */
  summaryText: string | null;
  enabled: boolean;
  /** 꺼진 이유(켜져 있으면 null) */
  reason: string | null;
  /** 누른 뒤 동작은 P4-03(승인·등록 API)이 붙인다 */
  onApprove?: () => void;
}

/**
 * SCR-08 '⑨ 등록' 영역의 승인 버튼 자리(P4-02 §5 FE, F-AP-10, 규칙 15). 주 버튼 '승인·등록' + 꺼진 이유(DisabledReason).
 * BLOCK 실패가 하나라도 있거나 `approveEnabled=false`면 끄고 이유를 글로 보인다. 승인은 이 웹 화면에서만 한다 — 연속 실행·CLI·
 * 설정으로 대신하거나 끄는 길이 없다. 등록 모드·직전 결과·차단 스위치·누른 뒤 동작은 P4-03이 이 영역에 더한다. 시안의 '20:02가
 * 지나면 … 자동으로 다시 읽고'(M2 F-AP-52)는 M1 동작(재조회 버튼·409 JUDGEMENT_EXPIRED) 문구로 고쳤다.
 */
export function ApproveSection({
  preview,
  summaryText,
  enabled,
  reason,
  onApprove,
}: ApproveSectionProps) {
  return (
    <section aria-labelledby="register-title" className={styles.section}>
      <h2 id="register-title" className={styles.title}>
        {REGISTER_TITLE}
      </h2>
      <div className={styles.bar}>
        <div className={styles.text}>
          {summaryText ? <span className={styles.summary}>{summaryText}</span> : null}
          {preview?.apiBlocked ? <span className={styles.note}>{API_BLOCKED_NOTE}</span> : null}
          {preview ? (
            <span className={styles.note}>{freshnessNote(preview.judgementExpiresAt)}</span>
          ) : null}
          {reason ? (
            <DisabledReason id="approve-why" tone="waiting">
              {reason}
            </DisabledReason>
          ) : null}
        </div>
        <Button
          variant="primary"
          disabled={!enabled}
          aria-describedby={reason ? 'approve-why' : undefined}
          onClick={onApprove}
        >
          {APPROVE_LABEL}
        </Button>
      </div>
    </section>
  );
}
