import { CandidateStatusChip, useCandidate, useCandidateGates } from '@/features/step-engine';
import { GateBadge } from '@/shared/ui';
import styles from './ApprovalStatusBadges.module.css';

/**
 * SCR-08 ⑧ 줄 오른쪽의 '여정 상태 승인대기'·'G4 최종 승인 · 확인 필요'(Approval.dc.html, P4-02). 여정 상태는 여정 상세
 * (`getCandidate` — 여정 틀이 이미 읽은 캐시), G4는 게이트 목록(`listCandidateGates` — G4 통과 = 등록 기록 승인 시각, P4-03)으로 보인다.
 */
export function ApprovalStatusBadges({ candidateId }: { candidateId: number }) {
  const candidate = useCandidate(candidateId).data;
  const g4 = useCandidateGates(candidateId).data?.items.find((item) => item.gate === 'G4');
  return (
    <span className={styles.badges}>
      {candidate ? (
        <span className={styles.status}>
          여정 상태 <CandidateStatusChip status={candidate.status} />
        </span>
      ) : null}
      <GateBadge gate="G4" state={g4?.passed ? 'passed' : 'pending'} />
    </span>
  );
}
