import { Link } from 'react-router';
import {
  findCallUsage,
  formatUsageCount,
  pageReadBlockedReason,
  useCallUsageQuery,
} from '@/features/integrations';
import {
  PRE_VALIDATION_NOTE,
  PRE_VALIDATION_RUNNING,
  PRE_VALIDATION_TITLE,
  REFETCH_CAPTION,
  STEP_LINK_LABEL,
  preValidationSummary,
  type PreValidationLineView,
} from '@/features/registration';
import { useRefetchCandidate } from '@/features/step-engine';
import { stepPath } from '@/shared/lib/steps';
import { Banner, Button, Chip, DisabledReason } from '@/shared/ui';
import styles from './PreValidationPanel.module.css';

export interface PreValidationPanelProps {
  candidateId: number;
  lines: readonly PreValidationLineView[];
  /** 검사 결과를 받는 중(처음·다시 검사) */
  checking: boolean;
  /** 검사 요청이 실패했다(409·네트워크 등) */
  error: { message: string } | null;
}

/**
 * SCR-08 '사전 검증 결과'(Approval.dc.html, P4-02 §5 FE `PreValidationPanel.tsx`, F-AP-09). 줄마다 통과·실패 칩, 이름(시안 문구)과
 * 실패 사유, 고칠 단계 링크(`shared/lib/steps.ts`로 stepCode → 경로 — 실패면 서버 stepCode, 통과면 시안 링크), 머리의 'n개 모두
 * 통과' 칩, '화면을 열 때 검사했고, 승인 직전에 한 번 더 검사합니다.' 문구. 시안 13줄 ↔ 검사 코드 15개 대응은
 * `PRE_VALIDATION_LINES`. 판정 유효 줄에는 '재조회'(P2-02 `POST /candidates/{id}/refetch` — ② 재조회 → ③ 재판정, 하루 조회에
 * 포함)를 둔다.
 */
export function PreValidationPanel({
  candidateId,
  lines,
  checking,
  error,
}: PreValidationPanelProps) {
  const summary = preValidationSummary(lines);
  const hasResult = lines.some((line) => line.passed !== null);
  const refetch = useRefetchCandidate();
  const usage = findCallUsage(useCallUsageQuery().data, 'RAKUTEN_PAGE');
  const refetchBlocked = pageReadBlockedReason(usage);
  const usageText = usage ? ` · 하루 조회 ${formatUsageCount(usage)}에 포함` : '';

  return (
    <section aria-labelledby="pre-validation-title" className={styles.panel}>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <h2 id="pre-validation-title" className={styles.title}>
            {PRE_VALIDATION_TITLE}
          </h2>
          {checking && !hasResult ? (
            <Chip tone="running">검사 중</Chip>
          ) : hasResult ? (
            <Chip
              tone={summary.allPassed ? 'done' : 'failed'}
              icon={summary.allPassed ? 'check' : 'alert'}
            >
              {summary.text}
            </Chip>
          ) : null}
        </div>
        <span className={styles.note}>{PRE_VALIDATION_NOTE}</span>
      </div>
      {error ? (
        <Banner tone="warning" role="alert">
          {error.message}
        </Banner>
      ) : null}
      {checking && !hasResult && !error ? (
        <p className={styles.note}>{PRE_VALIDATION_RUNNING}</p>
      ) : null}
      <ul aria-label="검사 항목" className={styles.lines}>
        {lines.map((line) => (
          <li key={line.id} className={styles.line} data-line={line.id}>
            <div className={styles.lineMain}>
              {line.passed === null ? (
                <Chip tone="idle">확인 전</Chip>
              ) : line.passed ? (
                <Chip tone="done" icon="check">
                  통과
                </Chip>
              ) : (
                <Chip tone="failed" icon="alert">
                  실패
                </Chip>
              )}
              <span className={styles.label}>
                {line.label}
                {line.detail ? <span className={styles.detail}> {line.detail}</span> : null}
              </span>
              {line.linkStep ? (
                <Link className={styles.link} to={stepPath(candidateId, line.linkStep)}>
                  {STEP_LINK_LABEL[line.linkStep]}
                </Link>
              ) : null}
              {line.id === 'JUDGEMENT_FRESHNESS' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={refetch.isPending || refetchBlocked !== null}
                  aria-describedby={refetchBlocked ? 'refetch-why' : undefined}
                  onClick={() => {
                    refetch.reset();
                    refetch.mutate(candidateId);
                  }}
                >
                  재조회
                </Button>
              ) : null}
            </div>
            {line.reasons.length > 0 ? (
              <ul className={styles.reasons}>
                {line.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
            {line.id === 'JUDGEMENT_FRESHNESS' ? (
              <>
                <span className={styles.note}>{`${REFETCH_CAPTION}${usageText}`}</span>
                {refetchBlocked ? (
                  <DisabledReason id="refetch-why">{refetchBlocked}</DisabledReason>
                ) : null}
                {refetch.error ? (
                  <span role="alert" className={styles.error}>
                    {refetch.error.message}
                  </span>
                ) : null}
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
