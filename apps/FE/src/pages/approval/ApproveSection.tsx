import {
  API_BLOCKED_NOTE,
  APPROVE_LABEL,
  APPROVING_LABEL,
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
  /** 누르면 승인·등록(P4-03 — 키는 누를 때 한 번 만든다) */
  onApprove?: () => void;
  /** 승인 요청을 보내는 중(버튼 잠금) */
  pending?: boolean;
  /** 승인 요청 실패(409·422 문구) */
  error?: { message: string } | null;
}

/**
 * SCR-08 '⑨ 등록' 맨 아래 승인 바(P4-02 §5 FE, P4-03 §5 FE, F-AP-10, 규칙 15). 왼쪽 안내 글(사전 검증 요약 · 차단 켬 안내 · 판정 유효
 * 시간) · 오른쪽 주 버튼 '승인·등록'. BLOCK 실패가 하나라도 있거나 `approveEnabled=false`면 끄고 이유를 글로 보인다. 누르는 동안
 * 잠근다(P4-03). 승인은 이 웹 화면에서만 한다 — 연속 실행·CLI·설정으로 대신하거나 끄는 길이 없다. 시안의 '20:02가 지나면 …
 * 자동으로 다시 읽고'(M2 F-AP-52)는 M1 동작(재조회 버튼·409 JUDGEMENT_EXPIRED) 문구로 고쳤다.
 */
export function ApproveSection({
  preview,
  summaryText,
  enabled,
  reason,
  onApprove,
  pending = false,
  error = null,
}: ApproveSectionProps) {
  const why = pending ? APPROVING_LABEL : reason;
  return (
    <div className={styles.bar}>
      <div className={styles.text}>
        {summaryText ? <span className={styles.summary}>{summaryText}</span> : null}
        {preview?.apiBlocked ? <span className={styles.warn}>{API_BLOCKED_NOTE}</span> : null}
        {preview ? (
          <span className={styles.note}>{freshnessNote(preview.judgementExpiresAt)}</span>
        ) : null}
        {why ? (
          <DisabledReason id="approve-why" tone={pending ? 'muted' : 'waiting'}>
            {why}
          </DisabledReason>
        ) : null}
        {error ? (
          <span role="alert" className={styles.error}>
            {error.message}
          </span>
        ) : null}
      </div>
      <Button
        variant="primary"
        disabled={!enabled || pending}
        aria-busy={pending || undefined}
        aria-describedby={why ? 'approve-why' : undefined}
        onClick={onApprove}
      >
        {APPROVE_LABEL}
      </Button>
    </div>
  );
}
