import { useParams } from 'react-router';
import { parseCandidateId } from '@/features/step-engine';
import { UploadSection } from './UploadSection';
import styles from './ApprovalPage.module.css';

const TITLE = '최종 승인';

/**
 * SCR-08 ⑧⑨ 최종 승인·등록(Approval.dc.html). 후보 작업 틀(CandidateLayout) 안 단계 본문. P4-01은 맨 위 ⑧ 이미지 업로드 영역
 * (`UploadSection`)만 둔다 — 전체 미리보기·사전 검증·G4 승인(P4-02)과 ⑨ 등록·차단 스위치(P4-03)가 이 아래를 채운다.
 */
export function ApprovalPage() {
  const { candidateId: rawId = '' } = useParams();
  const candidateId = parseCandidateId(rawId);
  return (
    <>
      <title>{`${TITLE} · 신발 자동등록`}</title>
      <h1 className={styles.srOnly}>{TITLE}</h1>
      {candidateId !== null ? <UploadSection candidateId={candidateId} /> : null}
    </>
  );
}
