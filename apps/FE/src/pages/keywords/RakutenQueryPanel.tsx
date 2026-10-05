import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  cidLabel,
  type RankedKeyword,
  useConvertKeywordToRakutenQueryMutation,
} from '@/features/keywords';
import { hasHangul, RakutenQueryField, useRakutenQueryCheck } from '@/features/sourcing';
import { useCreateCandidate, useStartStepRun } from '@/features/step-engine';
import { Button, DisabledReason, GateBadge, Icon, Panel } from '@/shared/ui';
import styles from './RakutenQueryPanel.module.css';

/** 키워드 없이 시작하는 입구(FE 05-1 §3-4 Proposed: 여정 없이 여는 소싱 경로가 없어 '입력 고르기' 목록으로) */
export const SOURCING_WITHOUT_KEYWORD_PATH = '/candidates?runnableStep=SOURCING';

/** '이 검색어로 소싱'이 꺼진 이유(Proposed — 보드에 없음) */
export const NO_SELECTED_KEYWORD_REASON = '키워드 표에서 키워드를 하나 고르면 켜집니다.';

/** 검색어 칸 자리 글·안내(Proposed — 보드에 없음). 칸이 비었거나 한글이면 소싱을 누를 때 AI가 일본어로 바꾼다 */
export const QUERY_PLACEHOLDER = '비워 두세요. 소싱을 누르면 AI가 일본어로 바꿔 검색합니다';
export const AUTO_CONVERT_CAPTION =
  '비워 두거나 한글이면 [이 검색어로 소싱]을 누를 때 AI가 일본어로 바꿔 검색합니다(10초쯤, 길면 2분까지). 일본어·영문을 직접 적으면 그대로 씁니다.';
export const KEYWORD_HANGUL_HINT =
  '한글이 들어 있습니다. [이 검색어로 소싱]을 누르면 AI가 고른 키워드를 일본어로 바꿔 검색합니다(여기 쓴 한글은 쓰지 않습니다).';

export interface RakutenQueryPanelProps {
  /** 지금 고른 키워드(D-33 — 표에서 하나 고른 것, 묶음 조회의 `selectedKeyword`). 고른 키워드가 없으면 null이고 소싱으로 넘기지 못한다 */
  keyword: RankedKeyword | null;
}

/**
 * SCR-02 '라쿠텐 검색어 확인'(Keywords.dc.html 아래 줄 오른쪽 위, F-KW-08, US-02 AC2, D-33).
 * 표에서 고른 키워드(G1 통과, 하나)를 라쿠텐 검색어로 바꿔 '이 검색어로 소싱': (칸이 비었거나 한글이면 먼저 AI가 이 키워드 1개를 일본어
 * 검색어로 바꾼다 — `convertKeywordToRakutenQuery`, F-BS-70) → 여정 만들기(`createCandidate` KEYWORD) → ② 실행(`startCandidateStepRun`
 * SOURCING) → `/candidates/:id/sourcing`. 한국어 원문은 칸 위에 늘 보이고, 바꾼 일본어 검색어는 ② 화면에서 원문과 함께 보인다.
 * ② 실행 실패(검색어 형식·키 없음 등)는 ② 화면의 단계 상태가 보인다.
 * P2-02: 입력이 멈추면 `validateRakutenQuery` 결과('반각 n/128자 · 형식 맞음' 또는 위반 문구)를 보이고, 형식이 틀리면
 * '이 검색어로 소싱'을 끈다(서버도 여정 만들기에서 422 RAKUTEN_QUERY_INVALID).
 * 한글 키워드는 라쿠텐에서 결과가 없어서(0건) 따로 버튼 없이 소싱을 누를 때 자동으로 바꾼다. 일본어·영문을 직접 적으면 AI를 부르지 않는다.
 * 바꾸지 못하면(AI 엔진 없음·시간 제한 등) 서버 문구를 보이고 여정은 만들지 않는다. 사전 제안(브랜드 사전 변환)은 M2라 그리지 않는다.
 */
export function RakutenQueryPanel({ keyword }: RakutenQueryPanelProps) {
  const reasonId = `query-reason-${useId()}`;
  const navigate = useNavigate();
  const createCandidate = useCreateCandidate();
  const startStep = useStartStepRun();
  const convert = useConvertKeywordToRakutenQueryMutation();
  const keywordId = keyword?.id ?? null;
  // 칸은 비어 있다가 직접 적거나 소싱을 누를 때 AI가 채운다(한국어 원문은 칸 위에 따로 보인다)
  const [query, setQuery] = useState('');
  const [queryFor, setQueryFor] = useState<number | null>(keywordId);
  // 키워드가 바뀌면 검색어 칸을 비운다
  if (keywordId !== queryFor) {
    setQueryFor(keywordId);
    setQuery('');
  }
  // 바꾸는 동안 다른 키워드로 옮겼다면 늦게 온 결과를 그 칸에 넣지 않는다
  const keywordIdRef = useRef(keywordId);
  useEffect(() => {
    keywordIdRef.current = keywordId;
  }, [keywordId]);
  // 다른 키워드로 바꾸면 앞 키워드의 요청 오류는 보이지 않는다
  const createError =
    createCandidate.isError &&
    createCandidate.variables?.creationPath === 'KEYWORD' &&
    createCandidate.variables.sourceKeywordId === keywordId
      ? createCandidate.error.message
      : undefined;
  const convertError =
    convert.isError && convert.variables === keywordId ? convert.error.message : undefined;
  const check = useRakutenQueryCheck(query);
  // 고른 키워드만 이 패널에 온다(D-33) — 있으면 G1 통과
  const selected = keyword !== null;
  const converting = convert.isPending;
  const pending = converting || createCandidate.isPending || startStep.isPending;
  // 지금 칸 값의 검사 결과가 '형식 틀림'일 때만 끈다(검사 전·검사 요청 실패는 서버가 만들 때 다시 본다)
  const queryInvalid =
    check.result !== undefined && check.result.rakutenQuery === query.trim() && !check.result.valid;
  const disabled = !selected || queryInvalid || pending;

  // 요청 상태(`pending`)는 화면이 다시 그려진 뒤에야 버튼을 끈다 — 그 전에 연달아 오는 클릭(더블클릭)을 동기로 막는다.
  // 막지 않으면 여정이 두 번 만들어지고(KEYWORD 경로는 서버에 중복 검사가 없다), 먼저 보낸 요청의 이동이 사라진다
  const started = useRef(false);

  const createAndStart = (sourceKeywordId: number, rakutenQuery: string) =>
    createCandidate.mutate(
      { creationPath: 'KEYWORD', sourceKeywordId, rakutenQuery },
      {
        onSuccess: (candidate) => {
          const go = () => void navigate(`/candidates/${candidate.id}/sourcing`);
          startStep.mutate({ candidateId: candidate.id, stepCode: 'SOURCING' }, { onSettled: go });
        },
        // 여정을 못 만들었을 때만 다시 누를 수 있다(성공하면 ②로 떠난다)
        onError: () => {
          started.current = false;
        },
      },
    );

  const startSourcing = () => {
    if (!keyword || started.current) return;
    started.current = true;
    const typed = query.trim();
    // 일본어·영문을 직접 적었으면 그대로 쓴다. 비었거나 한글이면 AI가 이 키워드 1개를 일본어로 바꾼다
    if (typed !== '' && !hasHangul(typed)) {
      createAndStart(keyword.id, typed);
      return;
    }
    const forKeyword = keyword.id;
    convert.mutate(forKeyword, {
      onSuccess: (result) => {
        if (keywordIdRef.current === forKeyword) setQuery(result.rakutenQuery);
        createAndStart(forKeyword, result.rakutenQuery);
      },
      // 못 바꿨으면 여정을 만들지 않는다(한글 검색어는 0건이라 소싱해도 소용없다) — 서버 문구를 보이고 다시 누를 수 있다
      onError: () => {
        started.current = false;
      },
    });
  };

  return (
    <Panel
      title="라쿠텐 검색어 확인"
      actions={<GateBadge gate="G1" state={selected ? 'passed' : 'pending'} />}
    >
      {keyword ? (
        <div key={keyword.id} className={styles.keywordRow}>
          <Icon name="check" size={16} strokeWidth={2.5} className={styles.pickedIcon} />
          <span className={styles.originLabel}>한국어 원문</span>
          <span className={styles.keyword}>{keyword.keyword}</span>
          <span className={styles.meta}>
            <span className={styles.num}>{keyword.rank}</span>위 · {cidLabel(keyword.cid)}
          </span>
        </div>
      ) : (
        <p className={styles.caption}>표에서 소싱할 키워드를 하나 고르세요.</p>
      )}
      <RakutenQueryField
        value={query}
        onChange={setQuery}
        check={check}
        disabled={keyword === null || converting}
        placeholder={QUERY_PLACEHOLDER}
        hangulHint={KEYWORD_HANGUL_HINT}
        error={createError}
      />
      {convertError ? (
        <p role="alert" className={styles.error}>
          {convertError}
        </p>
      ) : null}
      {converting && keyword ? (
        <p role="status" className={styles.caption}>
          AI가 &apos;{keyword.keyword}&apos;를 일본어 검색어로 바꾸는 중입니다 · 10초쯤 걸리고 길면
          2분까지 걸립니다
        </p>
      ) : (
        <p className={styles.caption}>{AUTO_CONVERT_CAPTION}</p>
      )}
      <div className={styles.actions}>
        <Button
          disabled={disabled}
          aria-busy={pending || undefined}
          aria-describedby={!selected ? reasonId : undefined}
          onClick={startSourcing}
        >
          {converting ? (
            <>
              <Icon name="refresh" size={16} className={styles.spin} />
              일본어로 바꾸는 중…
            </>
          ) : pending ? (
            '여정 만드는 중…'
          ) : (
            <>
              이 검색어로 소싱
              <Icon name="arrow-right" size={16} />
            </>
          )}
        </Button>
        <span className={styles.caption}>
          모델 번호(型番)·색상은 소싱에서 기준 상품으로 정합니다
        </span>
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
