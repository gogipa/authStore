import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  findCallUsage,
  formatUsageCount,
  pageReadBlockedReason,
  useCallUsageQuery,
} from '@/features/integrations';
import {
  fillText,
  NowMark,
  SOURCING_GLOSSARY,
  SOURCING_GUIDE_TEXT,
  SOURCING_NOW_TEXT,
  StepIntro,
  useStepGuideVisible,
} from '@/features/guide';
import {
  adultConfirmationOf,
  comparisonGender,
  comparisonParams,
  DEFAULT_RAKUTEN_GENRE_ID,
  kRankText,
  TABLE_MODE_CLOSED,
  TABLE_MODE_NEEDS_ANCHOR,
  TABLE_MODE_NOT_READY,
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
import { stepPath } from '@/shared/lib/steps';
import { Button, ButtonLink, DisabledReason, Icon } from '@/shared/ui';
import { AdultConfirmPanel } from './AdultConfirmPanel';
import { AnchorPanel } from './AnchorPanel';
import { ComparisonTable } from './ComparisonTable';
import { GenderPanel } from './GenderPanel';
import { SearchQueryPanel } from './SearchQueryPanel';
import { sourcingNowKey } from './sourcingNow';
import { UrlPastePanel } from './UrlPastePanel';
import styles from './SourcingPage.module.css';

/** 검색어 없이 실행할 수 없을 때(URL 여정은 앵커 상품의 型番으로 검색한다) */
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
 * SCR-03 ② 소싱(Sourcing.dc.html, P2-02·P2-03). 여정 틀(CandidateLayout) 안 단계 본문:
 * - 상태 줄(StepStatusBar): 상태·마지막 실행·버전·입력 출처 + '실행'/'다시 실행'(`startCandidateStepRun` SOURCING, 칸의 검색어를
 *   `ownerInputs.searchKeyword`로) · '재조회'(소싱 선택이 있을 때, 하루 조회 상한·쉼이면 끈다). '여기부터 연속 실행'은 없다(D-40)
 * - 검색 조건: 라쿠텐 검색어 + 형식 검사, 장르 고정, 성별 확인(GenderPanel), 기준 상품 머리 줄(AnchorPanel — 정한 뒤에만), 아동화 필터 안내
 * - 비교 칸(ComparisonTable, D-47): 기준 상품 전 '상품 고르기' 목록(SearchResultList) → 정한 뒤 '같은 상품을 파는 샵 비교'
 *   (같은 상품인가·재고 확인·실질가·선택), 펼친 행(사이즈·쿠폰·배율·포인트 분해·AI 참고), 크레딧
 * - 라쿠텐 URL 붙여넣기('비교표에 넣기'·'바로 여정 만들기') + '성인용 상품 확인'
 * 결과는 폴링하지 않고 SSE(step-run.status-changed·sourcing.*·gate.invalidated)가 다시 읽힌다.
 */
export function SourcingPage() {
  const { candidateId: rawId = '' } = useParams();
  const candidateId = parseCandidateId(rawId);
  const navigate = useNavigate();
  const guideVisible = useStepGuideVisible();
  const candidate = useCandidate(candidateId);
  const rail = useCandidateSteps(candidateId);
  const [includeNoMatch, setIncludeNoMatch] = useState(false);
  const comparison = useSourcingComparison(candidateId, { includeNoMatch });
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
        detail.anchorModelCode ? `모델 번호 ${detail.anchorModelCode}` : detail.anchorItemCode,
        detail.anchorColorCode ? `색상 번호 ${detail.anchorColorCode}` : null,
        detail.selectedColor,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const genderState = detail
    ? {
        gender: detail.gender ?? null,
        genderSource: detail.genderSource ?? null,
        genderRecheckRequired: detail.genderRecheckRequired,
        locked: !!detail.locked,
      }
    : undefined;
  const { gender } = comparisonGender(genderState, head);
  // 맨 위 안내(D-34): 하는 일 · 지금 할 일 · 낯선 말 풀이. 풀이의 {kRank}는 이 비교 버전의 포인트 계수
  const nowKey = sourcingNowKey({
    stepStatus: item?.status,
    head,
    genderKnown: gender !== null,
    adultPending: adult.canConfirm,
  });
  const kRank = kRankText(comparisonParams(head).kRank);
  const glossary = Object.entries(SOURCING_GLOSSARY).map(([id, entry]) => ({
    id,
    term: entry.term,
    text: fillText(entry.text, { kRank }),
  }));
  // 입력을 기다리느라 꺼진 버튼의 이유는 서버 글 대신 '어디서 무엇을 하면 켜지는지'를 말한다(D-36)
  const waitingBlocked =
    item?.status === 'WAITING_INPUT' &&
    runAction !== undefined &&
    !runAction.enabled &&
    runReason === (runAction.disabledReason?.message ?? null);
  // 그 글이 '지금 여기' 표시를 가리키므로 표시가 보이는 체험에서만 바꾼다(D-43). 실제 사용에서는 서버 글 그대로
  const shownRunReason =
    waitingBlocked && guideVisible ? SOURCING_GUIDE_TEXT.waitingReason : runReason;
  // '비교표에 넣기'(수동 행): 앵커를 정한, 입력을 기다리는 현재 검색·비교 버전에만
  const tableBlockedReason = !head?.comparisonPerformed
    ? TABLE_MODE_NOT_READY
    : !head.isCurrent || head.stepStatus !== 'WAITING_INPUT'
      ? TABLE_MODE_CLOSED
      : head.exploreMode
        ? TABLE_MODE_NEEDS_ANCHOR
        : null;

  return (
    <>
      <StepIntro
        label={SOURCING_GUIDE_TEXT.region}
        purpose={SOURCING_GUIDE_TEXT.purpose}
        nowLabel={SOURCING_GUIDE_TEXT.nowLabel}
        now={nowKey ? SOURCING_NOW_TEXT[nowKey] : null}
        glossaryTitle={SOURCING_GUIDE_TEXT.glossaryTitle}
        glossaryHint={SOURCING_GUIDE_TEXT.glossaryHint}
        glossary={glossary}
      />
      {item ? (
        <StepStatusBar
          item={item}
          source={sourceText(detail)}
          // candidateId를 주지 않아 '여기부터 연속 실행'을 그리지 않는다 — ②는 기준 상품·살 샵을 직접 골라야 해서 눌러도 입력에서 멈춘다(D-40)
          error={start.error ?? refetch.error ?? undefined}
          actions={
            <>
              <NowMark
                inline
                label={SOURCING_GUIDE_TEXT.nowMark}
                active={nowKey === 'start' || nowKey === 'rerun' || nowKey === 'failed'}
              >
                <Button
                  disabled={busy || runReason !== null}
                  aria-describedby={runReason ? 'sourcing-run-why' : undefined}
                  onClick={run}
                >
                  {runButtonLabel(item.status)}
                </Button>
              </NowMark>
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
          {shownRunReason}
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
        sourceKeyword={detail?.sourceKeyword ?? null}
        gender={
          <NowMark label={SOURCING_GUIDE_TEXT.nowMark} active={nowKey === 'pickGender'}>
            <GenderPanel candidateId={candidateId} candidate={genderState} head={head} />
          </NowMark>
        }
        anchor={
          <AnchorPanel
            head={head}
            fixedText={anchorText ?? (detail ? anchorKeyLabel(detail) : null)}
          />
        }
        placeholder={
          detail?.creationPath === 'RAKUTEN_URL'
            ? '비우면 기준 상품의 모델 번호로 검색합니다'
            : undefined
        }
      />
      {/* 한 자리에 '상품 고르기' 목록(pickAnchor)과 '같은 상품을 파는 샵 비교' 표(pickShop)가 번갈아 나온다 */}
      <NowMark
        label={SOURCING_GUIDE_TEXT.nowMark}
        active={nowKey === 'pickAnchor' || nowKey === 'pickShop'}
      >
        <ComparisonTable
          candidateId={candidateId}
          head={head}
          error={comparisonError}
          gender={gender}
          includeNoMatch={includeNoMatch}
          onIncludeNoMatchChange={setIncludeNoMatch}
          usageText={usage ? formatUsageCount(usage) : null}
          pageBlocked={pageBlocked}
        />
      </NowMark>
      <UrlPastePanel
        blockedReason={pageBlocked}
        tableComparisonId={head && tableBlockedReason === null ? head.id : null}
        tableBlockedReason={tableBlockedReason}
        onOpenCandidate={(id) => void navigate(`/candidates/${id}/sourcing`)}
        aside={
          <NowMark label={SOURCING_GUIDE_TEXT.nowMark} active={nowKey === 'confirmAdult'}>
            <AdultConfirmPanel
              state={adult}
              pending={confirm.isPending}
              error={confirmError}
              onConfirm={() => {
                if (head) confirm.mutate(head.id);
              }}
            />
          </NowMark>
        }
      />
      {nowKey === 'done' && candidateId !== null ? (
        // 입력을 마치고 넘어가는 버튼은 화면 맨 아래에 둔다(③~⑦과 같다, D-42)
        <div className={styles.next}>
          <NowMark inline label={SOURCING_GUIDE_TEXT.nowMark} active>
            <ButtonLink variant="primary" to={stepPath(candidateId, 'PRICING')}>
              {SOURCING_GUIDE_TEXT.nextStep}
              <Icon name="arrow-right" size={16} />
            </ButtonLink>
          </NowMark>
        </div>
      ) : null}
    </>
  );
}
