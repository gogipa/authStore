import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { findCallUsage, pageReadBlockedReason, useCallUsageQuery } from '@/features/integrations';
import {
  CHILD_FILTER_NOTE,
  RakutenQueryField,
  RakutenUrlForm,
  URL_PASTE_CAPTION,
  useRakutenQueryCheck,
} from '@/features/sourcing';
import { useCreateCandidate, useStartStepRun } from '@/features/step-engine';
import { isApiRequestError } from '@/shared/api/errors';
import { stepPath } from '@/shared/lib/steps';
import { Button, DisabledReason, Panel } from '@/shared/ui';
import styles from './SourcingEntry.module.css';

/** URL 붙여넣기 패널 id('URL로 만들기' 버튼이 `#rakuten-url`로 바로 간다) */
export const RAKUTEN_URL_PANEL_ID = 'rakuten-url';
/** '키워드 없이 시작' 입구(P2-01 SCR-02 링크·SCR-12 'URL로 만들기'가 여기로 온다) */
export const SOURCING_ENTRY_PATH = '/candidates?runnableStep=SOURCING';

/**
 * 키워드 없이 ② 소싱 시작(F-SO-01·F-SO-31, US-03 AC1·US-06 AC1, P2-02 Proposed — 위치는 SCR-12 '입력 고르기',
 * FE 05-1 route맵 §3-4). SCR-03 경로에 candidateId가 필요해 후보를 먼저 만든다.
 * - '검색어로 시작': 검색어 검사 → 후보 만들기(SEARCH_QUERY, G1 건너뜀) → ② 실행 → ② 화면
 * - 'URL로 바로 후보 만들기': 페이지 1건 읽기 → 색상 → 후보 만들기(RAKUTEN_URL, ② URL_CREATE) → ② 화면. 같은 상품·색상의
 *   진행 중 후보가 있으면 그 후보를 연다
 */
export function SourcingEntry() {
  const navigate = useNavigate();
  const reasonId = `query-start-why-${useId()}`;
  const [query, setQuery] = useState('');
  const check = useRakutenQueryCheck(query);
  const createCandidate = useCreateCandidate();
  const startStep = useStartStepRun();
  const usage = findCallUsage(useCallUsageQuery().data, 'RAKUTEN_PAGE');
  const openSourcing = (candidateId: number) => void navigate(stepPath(candidateId, 'SOURCING'));

  const trimmed = query.trim();
  const pending = createCandidate.isPending || startStep.isPending;
  const reason =
    trimmed === ''
      ? '라쿠텐 검색어를 넣으면 켜집니다.'
      : check.result?.rakutenQuery === trimmed && !check.result.valid
        ? '검색어 형식을 먼저 맞춰 주세요.'
        : null;
  const createError =
    createCandidate.error && isApiRequestError(createCandidate.error)
      ? createCandidate.error.message
      : createCandidate.error
        ? '후보를 만들지 못했습니다.'
        : undefined;

  const start = () => {
    if (reason !== null || pending) return;
    createCandidate.mutate(
      { creationPath: 'SEARCH_QUERY', rakutenQuery: trimmed },
      {
        onSuccess: (candidate) => {
          startStep.mutate(
            { candidateId: candidate.id, stepCode: 'SOURCING' },
            { onSettled: () => openSourcing(candidate.id) },
          );
        },
      },
    );
  };

  return (
    <>
      <Panel
        title="검색어로 시작"
        caption="키워드 없이 라쿠텐 검색어로 후보를 만들고 ② 소싱을 실행합니다"
      >
        <RakutenQueryField value={query} onChange={setQuery} check={check} error={createError} />
        <div className={styles.actions}>
          <Button
            disabled={reason !== null || pending}
            aria-describedby={reason ? reasonId : undefined}
            onClick={start}
          >
            {pending ? '후보 만드는 중…' : '검색어로 시작'}
          </Button>
          {reason ? <DisabledReason id={reasonId}>{reason}</DisabledReason> : null}
        </div>
        <p className={styles.caption}>{CHILD_FILTER_NOTE}</p>
      </Panel>
      <Panel id={RAKUTEN_URL_PANEL_ID} title="URL로 바로 후보 만들기">
        <RakutenUrlForm
          label="라쿠텐 URL"
          caption={URL_PASTE_CAPTION}
          modes={['CREATE']}
          blockedReason={pageReadBlockedReason(usage)}
          onOpenCandidate={openSourcing}
          note="바로 만든 후보는 비교표 없이 ②를 마치고 '비교 안 함' 배지가 붙습니다. 제외어(中古·インソール·キッズ 등)가 든 상품은 넣지 않고, 같은 상품·색상의 진행 중 후보가 있으면 그 후보를 엽니다."
        />
      </Panel>
    </>
  );
}
