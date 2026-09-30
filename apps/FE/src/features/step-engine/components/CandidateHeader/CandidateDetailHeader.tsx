import type { ReactNode } from 'react';
import { anchorKeyLabel, candidateDisplayName } from '../../model/displayName';
import { useCandidateGates } from '../../api/useContinuousRunQueries';
import { gateViewsFromList } from '../../model/gateViews';
import type { CandidateDetail } from '../../model/types';
import { CandidateHeader } from './CandidateHeader';
import styles from './CandidateHeader.module.css';

const GENDER_LABEL = { MALE: '남성', FEMALE: '여성' } as const;

/** 이름 옆: 앵커 키 ID 칩 · '남성 · 소싱 shop-b:20000456'(CandidateWork.dc.html) */
function CandidateMeta({ detail }: { detail: CandidateDetail }) {
  const anchor = anchorKeyLabel(detail);
  const parts: ReactNode[] = [];
  if (detail.gender) {
    parts.push(
      <span key="gender" className={detail.genderRecheckRequired ? styles.recheck : undefined}>
        {GENDER_LABEL[detail.gender]}
        {detail.genderRecheckRequired ? '(재확인 필요)' : ''}
      </span>,
    );
  }
  if (detail.itemCode) {
    parts.push(
      <span key="item">
        소싱 <span className={styles.mono}>{detail.itemCode}</span>
      </span>,
    );
  }
  return (
    <>
      {anchor ? <span className={styles.idChip}>{anchor}</span> : null}
      {parts.length > 0 ? (
        <span className={styles.meta}>
          {parts.flatMap((part, i) => (i === 0 ? [part] : [' · ', part]))}
        </span>
      ) : null}
    </>
  );
}

export interface CandidateDetailHeaderProps {
  detail: CandidateDetail;
  /** 오른쪽 버튼(단계 화면 틀: '후보 목록', 목록 화면: '후보 제외'·'다시 작업') */
  actions?: ReactNode;
}

/**
 * 후보 상세로 채운 후보 머리(표시명·앵커 키·성별·소싱 선택·게이트·출처 키워드). 게이트 배지는 게이트 목록
 * (`listCandidateGates`, P1-06)으로 그리고, 받기 전에는 후보 상세 `gates`로 그린다.
 */
export function CandidateDetailHeader({ detail, actions }: CandidateDetailHeaderProps) {
  const gateList = useCandidateGates(detail.id);
  return (
    <CandidateHeader
      title={candidateDisplayName(detail)}
      meta={<CandidateMeta detail={detail} />}
      gates={gateViewsFromList(gateList.data?.items, detail)}
      caption={detail.sourceKeyword ? `출처 키워드: ${detail.sourceKeyword}` : undefined}
      actions={actions}
    />
  );
}
