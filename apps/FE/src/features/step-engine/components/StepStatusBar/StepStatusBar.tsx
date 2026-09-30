import type { ReactNode } from 'react';
import { formatKstTime } from '@/shared/lib/format';
import { StatusChip, type StepFailureKind } from '@/shared/ui';
import { inputKeyLabels } from '../../model/inputLabels';
import { lastRunAt } from '../../model/stepTable';
import type { CandidateStepRailItem } from '../../model/types';
import styles from './StepStatusBar.module.css';

export interface StepStatusBarProps {
  /** 단계 레일 한 칸(listCandidateSteps) */
  item: CandidateStepRailItem;
  /** 입력 출처 글(예 '② 소싱 산출물') */
  source: string;
  /** 오른쪽 버튼 자리('다시 실행'·'여기부터 연속 실행'과 꺼진 이유) */
  actions?: ReactNode;
}

/**
 * 단계 본문 맨 위 상태 줄(공통부품 §H, 04-3 StepStatusBar): 상태 칩 · '마지막 실행 14:08 · 버전 v2' ·
 * '입력 출처: ② 소싱 산출물' · 버튼. 재실행 필요면 '바뀐 입력: …' 글을 함께 보인다. 단계 화면(P2~P4)이 쓴다.
 */
export function StepStatusBar({ item, source, actions }: StepStatusBarProps) {
  const at = lastRunAt(item);
  const run = item.currentRun;
  return (
    <div className={styles.bar} data-step={item.stepCode}>
      <StatusChip
        status={item.status}
        detail={(run?.failureKind ?? null) as StepFailureKind | null}
      />
      <span className={styles.meta}>
        마지막 실행 {at ? formatKstTime(at) : '—'} · 버전 {run ? `v${run.version}` : '—'}
      </span>
      <span className={styles.meta}>입력 출처: {source}</span>
      {item.status === 'RERUN_REQUIRED' && item.staleInputs.length > 0 ? (
        <span className={styles.stale}>바뀐 입력: {inputKeyLabels(item.staleInputs)}</span>
      ) : null}
      <span className={styles.spacer} />
      {actions}
    </div>
  );
}
