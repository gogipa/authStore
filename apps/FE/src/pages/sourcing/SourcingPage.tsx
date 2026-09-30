import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { findCallUsage, pageReadBlockedReason, useCallUsageQuery } from '@/features/integrations';
import {
  adultConfirmationOf,
  comparisonSummaryText,
  DEFAULT_RAKUTEN_GENRE_ID,
  useConfirmAdultProduct,
  useRakutenQueryCheck,
  useSourcingComparison,
} from '@/features/sourcing';
import {
  anchorKeyLabel,
  parseCandidateId,
  railByCode,
  runButtonLabel,
  StepStatusBar,
  useCandidate,
  useCandidateSteps,
  useRefetchCandidate,
  useStartStepRun,
  type CandidateDetail,
} from '@/features/step-engine';
import { isApiRequestError } from '@/shared/api/errors';
import { Button, Chip, DisabledReason } from '@/shared/ui';
import { AdultConfirmPanel } from './AdultConfirmPanel';
import { SearchQueryPanel } from './SearchQueryPanel';
import { UrlPastePanel } from './UrlPastePanel';
import styles from './SourcingPage.module.css';

const TITLE = '라쿠텐 후보 비교';
/** 비교표 캡션(보드 그대로) */
const COMPARISON_CAPTION =
  '실질가 = SKU가 + 송료 − 쿠폰 − 포인트 × 0.5 · 검증된 샵만 실질가 낮은 순으로 세웁니다 · 포인트는 근사';
/** 검색어 없이 실행할 수 없을 때(URL 후보는 앵커 상품의 型番으로 검색한다) */
const QUERY_REQUIRED_REASON = '라쿠텐 검색어를 넣어 주세요.';
const QUERY_INVALID_REASON = '검색어 형식을 먼저 맞춰 주세요.';

/** ② 입력 출처 글(보드 "입력 출처: 키워드 '아식스 젤카야노14'") */
function sourceText(detail: CandidateDetail | undefined): string {
  if (!detail) return '—';
  switch (detail.creationPath) {
    case 'KEYWORD':
      return detail.sourceKeyword ? `키워드 '${detail.sourceKeyword}'` : '키워드';
    case 'SEARCH_QUERY':
      return '검색어 직접 입력';
    case 'RAKUTEN_URL':
      return '라쿠텐 URL';
    case 'DIRECT_INPUT':
      return '직접 입력';
  }
}

/**
 * SCR-03 ② 소싱(Sourcing.dc.html, P2-02). 후보 작업 틀(CandidateLayout) 안 단계 본문:
 * - 상태 줄(StepStatusBar): 상태·마지막 실행·버전·입력 출처 + '실행'/'다시 실행'(`startCandidateStepRun` SOURCING, 칸의 검색어를
 *   `ownerInputs.searchKeyword`로) · '재조회'(소싱 선택이 있을 때, 하루 조회 상한·쉼이면 끈다) · '여기부터 연속 실행'
 * - 검색 조건: 라쿠텐 검색어 + 형식 검사, 장르 고정, 앵커, 아동화 필터 안내
 * - 라쿠텐 후보 비교: P2-02는 검색 결과 수·'비교 안 함'·크레딧만(비교표는 P2-03)
 * - 라쿠텐 URL 붙여넣기 + '성인용 상품 확인'(현재 ② 버전이 아동화 의심·대상 외 장르로 입력 대기일 때만)
 * 결과는 폴링하지 않고 SSE(step-run.status-changed·sourcing.search-completed)가 다시 읽힌다.
 */
export function SourcingPage() {
  const { candidateId: rawId = '' } = useParams();
  const candidateId = parseCandidateId(rawId);
  const navigate = useNavigate();
  const candidate = useCandidate(candidateId);
  const rail = useCandidateSteps(candidateId);
  const comparison = useSourcingComparison(candidateId);
  const usage = findCallUsage(useCallUsageQuery().data, 'RAKUTEN_PAGE');
  const pageBlocked = pageReadBlockedReason(usage);
  const start = useStartStepRun();
  const refetch = useRefetchCandidate();
  const confirm = useConfirmAdultProduct();

  const detail = candidate.data;
  const head = comparison.data;
  const item = railByCode(rail.data?.items).SOURCING;
  const [editedQuery, setEditedQuery] = useState<string | null>(null);
  const query = editedQuery ?? head?.searchKeyword ?? detail?.rakutenQuery ?? '';
  const check = useRakutenQueryCheck(query);

  const trimmed = query.trim();
  const queryInvalid =
    trimmed !== '' &&
    check.result !== undefined &&
    check.result.rakutenQuery === trimmed &&
    !check.result.valid;
  const queryMissing = trimmed === '' && detail?.creationPath !== 'RAKUTEN_URL';
  const runAction = item?.actions.run;
  const runReason =
    runAction && !runAction.enabled
      ? (runAction.disabledReason?.message ?? null)
      : queryMissing
        ? QUERY_REQUIRED_REASON
        : queryInvalid
          ? QUERY_INVALID_REASON
          : null;
  const busy = start.isPending || refetch.isPending;
  const hasSelection = !!detail?.itemCode;
  const refetchReason =
    pageBlocked ?? (item?.status === 'RUNNING' ? '② 소싱이 실행 중입니다.' : null);

  const run = () => {
    if (candidateId === null) return;
    refetch.reset();
    start.reset();
    start.mutate({
      candidateId,
      stepCode: 'SOURCING',
      body: trimmed !== '' ? { ownerInputs: { searchKeyword: trimmed } } : {},
    });
  };

  const doRefetch = () => {
    if (candidateId === null) return;
    start.reset();
    refetch.reset();
    refetch.mutate(candidateId);
  };

  const adult = adultConfirmationOf(head);
  const confirmError = confirm.error
    ? isApiRequestError(confirm.error)
      ? confirm.error.message
      : '확인을 기록하지 못했습니다.'
    : null;
  const comparisonError =
    comparison.error && comparison.error.code !== 'STEP_OUTPUT_NOT_FOUND'
      ? comparison.error.message
      : null;
  const anchorText = detail?.anchorFixedAt
    ? [
        detail.anchorModelCode ? `型番 ${detail.anchorModelCode}` : detail.anchorItemCode,
        detail.anchorColorCode ? `색상 코드 ${detail.anchorColorCode}` : null,
        detail.selectedColor,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <>
      {item ? (
        <StepStatusBar
          item={item}
          source={sourceText(detail)}
          candidateId={candidateId ?? undefined}
          error={start.error ?? refetch.error ?? undefined}
          actions={
            <>
              <Button
                disabled={busy || runReason !== null}
                aria-describedby={runReason ? 'sourcing-run-why' : undefined}
                onClick={run}
              >
                {runButtonLabel(item.status)}
              </Button>
              {hasSelection ? (
                <Button
                  disabled={busy || refetchReason !== null || !!detail?.locked}
                  aria-describedby={refetchReason ? 'sourcing-refetch-why' : undefined}
                  onClick={doRefetch}
                >
                  재조회
                </Button>
              ) : null}
            </>
          }
        />
      ) : null}
      {runReason ? (
        <DisabledReason id="sourcing-run-why" className={styles.reason}>
          {runReason}
        </DisabledReason>
      ) : null}
      {hasSelection && refetchReason ? (
        <DisabledReason id="sourcing-refetch-why" className={styles.reason}>
          {refetchReason}
        </DisabledReason>
      ) : null}
      <SearchQueryPanel
        query={query}
        onQueryChange={setEditedQuery}
        check={check}
        genreId={check.result?.genreId ?? DEFAULT_RAKUTEN_GENRE_ID}
        anchorText={anchorText ?? (detail ? anchorKeyLabel(detail) : null)}
        placeholder={
          detail?.creationPath === 'RAKUTEN_URL'
            ? '비우면 앵커 상품의 型番으로 검색합니다'
            : undefined
        }
      />
      <section aria-labelledby="sourcing-cmp-title" className={styles.comparison}>
        <title>{`${TITLE} · 신발 자동등록`}</title>
        <div className={styles.cmpHead}>
          <div className={styles.titleRow}>
            <h1 id="sourcing-cmp-title" className={styles.title}>
              {TITLE}
            </h1>
            <span className={styles.screenId}>SCR-03</span>
            {head && !head.comparisonPerformed ? <Chip tone="outline">비교 안 함</Chip> : null}
          </div>
        </div>
        <p className={styles.caption}>{COMPARISON_CAPTION}</p>
        <div className={styles.summary}>
          {comparisonError ? (
            <span role="alert" className={styles.error}>
              {comparisonError}
            </span>
          ) : (
            <span>{comparisonSummaryText(head)}</span>
          )}
        </div>
        {head ? (
          <div className={styles.footer}>
            <span className={styles.credit}>{head.creditText}</span>
          </div>
        ) : null}
      </section>
      <UrlPastePanel
        blockedReason={pageBlocked}
        onOpenCandidate={(id) => void navigate(`/candidates/${id}/sourcing`)}
        aside={
          <AdultConfirmPanel
            state={adult}
            pending={confirm.isPending}
            error={confirmError}
            onConfirm={() => {
              if (head) confirm.mutate(head.id);
            }}
          />
        }
      />
    </>
  );
}
