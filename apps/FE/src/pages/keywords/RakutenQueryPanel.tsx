import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { cidLabel, type RankedKeyword } from '@/features/keywords';
import { RakutenQueryField, useRakutenQueryCheck } from '@/features/sourcing';
import { useCreateCandidate, useStartStepRun } from '@/features/step-engine';
import { Button, DisabledReason, GateBadge, Icon, Panel } from '@/shared/ui';
import styles from './RakutenQueryPanel.module.css';

/** 키워드 없이 시작하는 입구(FE 05-1 §3-4 Proposed: 후보 없는 소싱 경로가 없어 '입력 고르기' 목록으로) */
export const SOURCING_WITHOUT_KEYWORD_PATH = '/candidates?runnableStep=SOURCING';

/** '이 검색어로 소싱'이 꺼진 이유(Proposed — 보드에 없음) */
export const NO_SELECTED_KEYWORD_REASON = '키워드 표에서 키워드를 하나 이상 고르면 켜집니다.';

export interface RakutenQueryPanelProps {
  /** '검색어로 쓰기'로 고른(또는 가장 최근에 고른) 키워드. G1을 통과한 키워드만 소싱으로 넘길 수 있다 */
  keyword: RankedKeyword | null;
}

/**
 * SCR-02 '라쿠텐 검색어 확인'(Keywords.dc.html 아래 줄 오른쪽 위, F-KW-08, US-02 AC2).
 * G1(키워드 선택)을 통과한 키워드를 라쿠텐 검색어(기본 = 키워드 원문, M1)로 바꿔 '이 검색어로 소싱':
 * 후보 만들기(`createCandidate` KEYWORD) → ② 실행(`startCandidateStepRun` SOURCING) → `/candidates/:id/sourcing`.
 * ② 실행 실패(검색어 형식·키 없음 등)는 ② 화면의 단계 상태가 보인다.
 * P2-02: 입력이 멈추면 `validateRakutenQuery` 결과('반각 n/128자 · 형식 맞음' 또는 위반 문구)를 보이고, 형식이 틀리면
 * '이 검색어로 소싱'을 끈다(서버도 후보 만들기에서 422 RAKUTEN_QUERY_INVALID).
 * 사전 제안(브랜드 사전 변환)은 M2라 그리지 않는다.
 */
export function RakutenQueryPanel({ keyword }: RakutenQueryPanelProps) {
  const reasonId = `query-reason-${useId()}`;
  const navigate = useNavigate();
  const createCandidate = useCreateCandidate();
  const startStep = useStartStepRun();
  const keywordId = keyword?.id ?? null;
  const [query, setQuery] = useState(keyword?.keyword ?? '');
  const [queryFor, setQueryFor] = useState<number | null>(keywordId);
  // 키워드가 바뀌면 검색어 칸을 그 키워드 원문(M1 기본값)으로 되돌린다
  if (keywordId !== queryFor) {
    setQueryFor(keywordId);
    setQuery(keyword?.keyword ?? '');
  }
  // 다른 키워드로 바꾸면 앞 키워드의 요청 오류는 보이지 않는다
  const createError =
    createCandidate.isError &&
    createCandidate.variables?.creationPath === 'KEYWORD' &&
    createCandidate.variables.sourceKeywordId === keywordId
      ? createCandidate.error.message
      : undefined;
  const check = useRakutenQueryCheck(query);
  const selected = keyword !== null && keyword.selectedAt !== null;
  const pending = createCandidate.isPending || startStep.isPending;
  // 지금 칸 값의 검사 결과가 '형식 틀림'일 때만 끈다(검사 전·검사 요청 실패는 서버가 만들 때 다시 본다)
  const queryInvalid =
    check.result !== undefined && check.result.rakutenQuery === query.trim() && !check.result.valid;
  const disabled = !selected || query.trim() === '' || queryInvalid || pending;

  const startSourcing = () => {
    if (!keyword || !selected) return;
    createCandidate.mutate(
      { creationPath: 'KEYWORD', sourceKeywordId: keyword.id, rakutenQuery: query.trim() },
      {
        onSuccess: (candidate) => {
          const go = () => void navigate(`/candidates/${candidate.id}/sourcing`);
          startStep.mutate({ candidateId: candidate.id, stepCode: 'SOURCING' }, { onSettled: go });
        },
      },
    );
  };

  return (
    <Panel
      title="라쿠텐 검색어 확인"
      actions={<GateBadge gate="G1" state={selected ? 'passed' : 'pending'} />}
    >
      {keyword ? (
        <div className={styles.keywordRow}>
          <span className={styles.keyword}>{keyword.keyword}</span>
          <span className={styles.meta}>
            <span className={styles.num}>{keyword.rank}</span>위 · {cidLabel(keyword.cid)}
          </span>
        </div>
      ) : (
        <p className={styles.caption}>
          표에서 키워드를 고르고 &apos;검색어로 쓰기&apos;를 누르세요.
        </p>
      )}
      <RakutenQueryField
        value={query}
        onChange={setQuery}
        check={check}
        disabled={keyword === null}
        error={createError}
      />
      <p className={styles.caption}>
        키워드 원문을 검색어로 씁니다 · 칸에서 직접 고칠 수 있습니다.
      </p>
      <div className={styles.actions}>
        <Button
          disabled={disabled}
          aria-describedby={!selected ? reasonId : undefined}
          onClick={startSourcing}
        >
          {pending ? '후보 만드는 중…' : '이 검색어로 소싱'}
          <Icon name="arrow-right" size={16} />
        </Button>
        <span className={styles.caption}>型番·색상은 소싱에서 앵커로 정합니다</span>
      </div>
      {!selected ? (
        <DisabledReason id={reasonId}>{NO_SELECTED_KEYWORD_REASON}</DisabledReason>
      ) : null}
      <p className={styles.caption}>
        키워드 없이 시작하려면 <Link to={SOURCING_WITHOUT_KEYWORD_PATH}>소싱 화면</Link>으로 갑니다.
      </p>
    </Panel>
  );
}
