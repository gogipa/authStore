import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import {
  CategoryPanel,
  GENDER_CHANGED_AFTER_DECISION,
  GENDER_RECHECK_DISABLED_REASON,
  GenderRecheck,
  useCategoryDecisionQuery,
} from '@/features/category';
import { JUDGEMENT_GUIDE, NowMark, ScreenGuidePanel, STEP_GUIDE_COMMON } from '@/features/guide';
import {
  CostBreakdownPanel,
  DomesticPricePanel,
  FxRateManualForm,
  FxRateSummary,
  judgedWithComparison,
  parseCouponYen,
  useDomesticPricesQuery,
  useLatestFxRatesQuery,
  usePriceJudgementQuery,
  type PriceJudgementDetail,
} from '@/features/pricing';
import {
  formatWeightKg,
  rateTableVersionLabel,
  useForwarderRateTableQuery,
} from '@/features/settings';
import { useSourcingComparison } from '@/features/sourcing';
import {
  parseCandidateId,
  railByCode,
  runButtonLabel,
  StepStatusBar,
  useCandidate,
  useCandidateGates,
  useCandidateSteps,
  useStartStepRun,
  type CandidateStepRailItem,
} from '@/features/step-engine';
import { useDocumentTitle } from '@/shared/lib/appName';
import { stepPath } from '@/shared/lib/steps';
import { Banner, Button, ButtonLink, DisabledReason, Icon } from '@/shared/ui';
import { judgementNowKey } from './judgementNow';
import { PricingSummary } from './PricingSummary';
import { SizeJudgementTable } from './SizeJudgementTable';
import { SourcingConfirmPanel } from './SourcingConfirmPanel';
import styles from './JudgementPage.module.css';

const TITLE = '판정 · 소싱 확정 · 카테고리';

/** 쿠폰 칸 안내(보드: URL 여정만 입력, 비교한 여정은 비교표 값) */
export const COUPON_LABEL = '쿠폰 · URL 여정만 입력';
export const WAITING_DOMESTIC_TEXT =
  '국내 기준가를 넣으면 판정을 이어 계산합니다. 네이버쇼핑에서 찾아본 뒤 판매가 + 고객 배송비 총액을 넣어 주세요.';
/** ④ 자리 문구(결정이 아직 없을 때) */
export const CATEGORY_PLACEHOLDER_TEXT =
  '④ 카테고리를 실행하면 리프 카테고리 후보가 여기에 나옵니다.';
export const CATEGORY_RUNNING_TEXT = '리프 카테고리 후보를 뽑는 중입니다.';

/** ③ 상태 줄 입력 출처(보드 '입력 출처: ② 소싱 v2 · 국내 기준가 직접 입력') */
function sourceText(
  sourcing: CandidateStepRailItem | undefined,
  judgement: PriceJudgementDetail | undefined,
): string {
  const version = sourcing?.currentRun ? `v${sourcing.currentRun.version}` : '';
  return ['② 소싱' + (version ? ` ${version}` : ''), judgement ? '국내 기준가 직접 입력' : null]
    .filter(Boolean)
    .join(' · ');
}

/** 비용 분해 배대지 줄 캡션(보드 '요금표 v2026-09 · 1.2kg'). 요금표가 없으면 기본 배대지비 가정값 */
function useForwarderNote(judgement: PriceJudgementDetail | undefined): string {
  const table = useForwarderRateTableQuery(judgement?.forwarderRateTableId ?? null).data;
  if (!judgement) return '';
  if (judgement.forwarderRateTableId == null) return '요금표 없음 · 기본값';
  const weight =
    judgement.chargeableWeightKg != null
      ? ` · ${formatWeightKg(judgement.chargeableWeightKg)}`
      : '';
  return `요금표 ${table ? rateTableVersionLabel(table) : `#${judgement.forwarderRateTableId}`}${weight}`;
}

/**
 * SCR-04 ③ 판정 · 소싱 확정(Judgement.dc.html, P2-05). 여정 틀(CandidateLayout) 안 단계 본문:
 * - ③ 머리: 제목 + 상태 줄(StepStatusBar — '실행'/'다시 실행'은 URL 여정이면 쿠폰 칸 값을 `ownerInputs.couponYen`으로)
 * - 가격 요약: 원가 환율(P2-04 `FxRateSummary`, '직접 넣기' → `FxRateManualForm`) · 쿠폰 칸(URL 여정만 입력, 비교한 여정은
 *   비교표 값) · 최소 판매가 · 판매가 · 순이익·마진율(PricingSummary)
 * - 왼쪽: 국내 기준가(네이버쇼핑 링크는 여기에만 — CON-14) · 사이즈별 판정 / 오른쪽: 비용 분해 · 소싱 확정(G2)
 * - ④ 카테고리(`id="category"`, P2-06): 상태 줄('실행'/'다시 실행') + '리프 카테고리' 패널(`CategoryPanel`) — 가운데 칸에
 *   '성별 재확인'(`GenderRecheck`, ④ 입력 대기일 때만), 완료면 '다음: ⑤ 썸네일'. 단계 레일의 ④ 링크(`judgement#category`)로
 *   들어오면 이 구역으로 스크롤한다
 * - 맨 위 안내(D-41, `ScreenGuidePanel`): 하는 일 · 지금 할 일(`judgementNowKey`) · 낯선 말 풀이. 지금 할 일이 있는 자리
 *   ('국내 기준가'·③ 실행 단추·'판매 후보 아님' 띠·'소싱 확정'·④ 실행 단추·'리프 카테고리')는 `NowMark`('지금 여기')로 짚는다
 * 결과는 폴링하지 않고 SSE(step-run.status-changed·gate.*·candidate-step.changed)가 판정·게이트·카테고리 결정을 다시 읽힌다.
 * 셀라파인더·'판매가를 바꿔 계산해 보기'(M2)는 만들지 않는다.
 */
export function JudgementPage() {
  const pageTitle = useDocumentTitle(TITLE);
  const { candidateId: rawId = '' } = useParams();
  const candidateId = parseCandidateId(rawId);
  const candidate = useCandidate(candidateId);
  const rail = useCandidateSteps(candidateId);
  const gates = useCandidateGates(candidateId);
  const judgementQuery = usePriceJudgementQuery(candidateId);
  const comparison = useSourcingComparison(candidateId);
  const fx = useLatestFxRatesQuery();
  const start = useStartStepRun();
  const startCategory = useStartStepRun();
  const categoryQuery = useCategoryDecisionQuery(candidateId);
  // 최신 한 건만 본다 — '국내 기준가' 패널과 같은 요청이라 한 번만 받는다. 지금 할 일이 '입력'인지 '실행'인지 가르는 데 쓴다
  const domesticPrices = useDomesticPricesQuery(candidateId, { size: 1 });
  const { hash } = useLocation();
  const [fxFormOpen, setFxFormOpen] = useState(false);
  const [coupon, setCoupon] = useState<string | null>(null);

  // 단계 레일 ④ 링크(`judgement#category`)로 들어오면 ④ 구역으로 스크롤한다(React Router는 해시로 스크롤하지 않는다)
  useEffect(() => {
    const id = hash.startsWith('#') ? hash.slice(1) : '';
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
  }, [hash]);

  const detail = candidate.data;
  const items = railByCode(rail.data?.items);
  const pricing = items.PRICING;
  const judgement = judgementQuery.data;
  const judgementError =
    judgementQuery.error && judgementQuery.error.code !== 'STEP_OUTPUT_NOT_FOUND'
      ? judgementQuery.error.message
      : null;
  const g2 = gates.data?.items.find((g) => g.gate === 'G2');
  // 비교하지 않은 URL 여정: ② 현재 버전(비교표 머리) → 판정 사본 → 여정 만든 경로
  const uncompared =
    comparison.data !== undefined
      ? !comparison.data.comparisonPerformed
      : judgement
        ? judgedWithComparison(judgement) === false
        : detail?.creationPath === 'RAKUTEN_URL';
  const couponText = coupon ?? String(uncompared ? (judgement?.couponYen ?? 0) : 0);
  const couponValue = parseCouponYen(couponText);
  const rowCoupon = judgement && !uncompared ? judgement.couponYen : null;
  const forwarderNote = useForwarderNote(judgement);

  const runAction = pricing?.actions.run;
  const runReason =
    runAction && !runAction.enabled
      ? (runAction.disabledReason?.message ?? null)
      : uncompared && couponValue === null
        ? '쿠폰은 0 이상의 엔 금액(숫자)으로 넣어 주세요.'
        : null;
  const locked = detail?.locked
    ? '등록 진행 중인 여정이라 바꿀 수 없습니다.'
    : detail?.status === 'EXCLUDED'
      ? "제외된 여정입니다. '다시 작업'을 먼저 눌러 주세요."
      : pricing?.status === 'RUNNING'
        ? '③ 판정이 실행 중입니다. 끝난 뒤 다시 넣어 주세요.'
        : null;

  const categoryItem = items.CATEGORY;
  const decision = categoryQuery.data;
  const categoryError =
    categoryQuery.error && categoryQuery.error.code !== 'STEP_OUTPUT_NOT_FOUND'
      ? categoryQuery.error.message
      : null;
  const categoryRunAction = categoryItem?.actions.run;
  const categoryRunReason =
    categoryRunAction && !categoryRunAction.enabled
      ? (categoryRunAction.disabledReason?.message ?? null)
      : null;
  const categoryLocked = detail?.locked
    ? '등록 진행 중인 여정이라 바꿀 수 없습니다.'
    : detail?.status === 'EXCLUDED'
      ? "제외된 여정입니다. '다시 작업'을 먼저 눌러 주세요."
      : null;
  // 이 화면에 보이는 결정이 ④ 현재 버전이고 입력 대기일 때만 성별을 다시 확인한다(같은 실행에서 후보를 다시 뽑는다)
  const categoryWaiting = decision?.stepStatus === 'WAITING_INPUT' && decision.isCurrent;
  const genderChanged =
    decision?.stepStatus === 'COMPLETED' &&
    detail?.gender != null &&
    detail.gender !== decision.gender;

  const runCategory = () => {
    if (candidateId === null) return;
    startCategory.reset();
    startCategory.mutate({ candidateId, stepCode: 'CATEGORY', body: {} });
  };

  const notSaleCandidate = !!judgement && !judgement.isSaleCandidate && !!judgement.exclusionReason;
  const g2Passed = gates.data ? g2?.fingerprintValid === true : undefined;
  // 맨 위 안내(D-41): 하는 일 · 지금 할 일 · 낯선 말 풀이. 여정을 아직 못 읽었으면 줄을 감춘다
  const nowKey = judgementNowKey({
    pricingStatus: detail ? pricing?.status : undefined,
    categoryStatus: categoryItem?.status,
    domesticPriceSaved: domesticPrices.isPending
      ? undefined
      : (domesticPrices.data?.content.length ?? 0) > 0,
    notSaleCandidate,
    noComparisonPending: uncompared && detail?.noComparisonConfirmedAt == null,
    g2Passed,
    categoryPickable: categoryWaiting,
    genderChanged,
    blocked: !!detail?.locked || detail?.status === 'EXCLUDED',
  });
  const mark = STEP_GUIDE_COMMON.nowMark;

  const run = () => {
    if (candidateId === null) return;
    start.reset();
    start.mutate({
      candidateId,
      stepCode: 'PRICING',
      body: uncompared && couponValue !== null ? { ownerInputs: { couponYen: couponValue } } : {},
    });
  };

  return (
    <>
      <title>{pageTitle}</title>
      <h1 className={styles.srOnly}>{TITLE}</h1>
      <ScreenGuidePanel guide={JUDGEMENT_GUIDE} nowKey={nowKey} />
      <section aria-labelledby="step3-title" className={styles.step}>
        <div className={styles.stepHead}>
          <h2 id="step3-title" className={styles.stepTitle}>
            ③ 판정
          </h2>
          <div className={styles.bar}>
            {pricing ? (
              <StepStatusBar
                item={pricing}
                source={sourceText(items.SOURCING, judgement)}
                candidateId={candidateId ?? undefined}
                error={start.error ?? undefined}
                actions={
                  <NowMark
                    inline
                    label={mark}
                    active={
                      nowKey === 'runPricing' ||
                      nowKey === 'rerunPricing' ||
                      nowKey === 'failedPricing'
                    }
                  >
                    <Button
                      disabled={start.isPending || runReason !== null}
                      aria-describedby={runReason ? 'pricing-run-why' : undefined}
                      onClick={run}
                    >
                      {runButtonLabel(pricing.status)}
                    </Button>
                  </NowMark>
                }
              />
            ) : null}
          </div>
        </div>
        {runReason ? (
          <DisabledReason id="pricing-run-why" className={styles.reason}>
            {runReason}
          </DisabledReason>
        ) : null}
        {pricing?.status === 'WAITING_INPUT' ? (
          <Banner tone="info">{WAITING_DOMESTIC_TEXT}</Banner>
        ) : null}
        {judgementError ? <Banner tone="warning">{judgementError}</Banner> : null}
        <NowMark label={mark} active={nowKey === 'notSaleCandidate'}>
          {judgement && !judgement.isSaleCandidate && judgement.exclusionReason ? (
            <Banner tone="blocked">판매 후보 아님 · {judgement.exclusionReason}</Banner>
          ) : null}
        </NowMark>

        <section aria-label="가격 요약" className={styles.summary}>
          <div className={styles.cell}>
            <FxRateSummary
              latest={fx.data}
              series={['COST/JPY']}
              pending={fx.isPending}
              error={fx.error ? fx.error.message : null}
              onManualInput={() => setFxFormOpen((open) => !open)}
            />
          </div>
          <div className={styles.cell}>
            <label htmlFor="pricing-coupon" className={styles.cellLabel}>
              {COUPON_LABEL}
            </label>
            <span className={styles.cellValue}>
              <span className={uncompared ? styles.couponBox : styles.couponBoxLocked}>
                <span className={styles.unit}>¥</span>
                <input
                  id="pricing-coupon"
                  className={styles.couponInput}
                  inputMode="numeric"
                  value={uncompared ? couponText : String(rowCoupon ?? 0)}
                  disabled={!uncompared}
                  aria-invalid={uncompared && couponValue === null ? true : undefined}
                  onChange={(e) => setCoupon(e.target.value)}
                />
              </span>
              <span className={styles.caption}>{uncompared ? '실행할 때 반영' : '비교표 값'}</span>
            </span>
          </div>
          <PricingSummary judgement={judgement} />
        </section>
        {fxFormOpen ? (
          <FxRateManualForm initialSeries="COST/JPY" onSaved={() => setFxFormOpen(false)} />
        ) : null}

        <div className={styles.columns}>
          <div className={styles.left}>
            {candidateId !== null ? (
              <NowMark label={mark} active={nowKey === 'enterPrice' || nowKey === 'waitingPrice'}>
                <DomesticPricePanel candidateId={candidateId} blockedReason={locked} />
              </NowMark>
            ) : null}
            {judgement ? <SizeJudgementTable judgement={judgement} /> : null}
          </div>
          <div className={styles.right}>
            {judgement ? (
              <CostBreakdownPanel judgement={judgement} forwarderNote={forwarderNote} />
            ) : (
              <p className={styles.placeholder}>
                {pricing?.status === 'WAITING_INPUT'
                  ? '국내 기준가를 넣으면 사이즈별 판정과 비용 분해가 여기에 나옵니다.'
                  : '③ 판정을 실행하면 사이즈별 판정과 비용 분해가 여기에 나옵니다.'}
              </p>
            )}
            {candidateId !== null ? (
              <NowMark label={mark} active={nowKey === 'checkNoComparison' || nowKey === 'passG2'}>
                <SourcingConfirmPanel
                  candidateId={candidateId}
                  candidate={detail}
                  judgement={judgement}
                  gate={g2}
                  uncompared={uncompared}
                />
              </NowMark>
            ) : null}
          </div>
        </div>
      </section>

      <section id="category" aria-labelledby="step4-title" className={styles.step}>
        <div className={styles.stepHead}>
          <h2 id="step4-title" className={styles.stepTitle}>
            ④ 카테고리
          </h2>
          <div className={styles.bar}>
            {categoryItem ? (
              <StepStatusBar
                item={categoryItem}
                source="② 장르 · 여정 성별"
                candidateId={candidateId ?? undefined}
                error={startCategory.error ?? undefined}
                actions={
                  <NowMark
                    inline
                    label={mark}
                    active={
                      nowKey === 'runCategory' ||
                      nowKey === 'rerunCategory' ||
                      nowKey === 'failedCategory' ||
                      nowKey === 'genderChanged'
                    }
                  >
                    <Button
                      disabled={startCategory.isPending || categoryRunReason !== null}
                      aria-describedby={categoryRunReason ? 'category-run-why' : undefined}
                      onClick={runCategory}
                    >
                      {runButtonLabel(categoryItem.status)}
                    </Button>
                  </NowMark>
                }
              />
            ) : null}
          </div>
        </div>
        {categoryRunReason ? (
          <DisabledReason id="category-run-why" className={styles.reason}>
            {categoryRunReason}
          </DisabledReason>
        ) : null}
        {categoryError ? <Banner tone="warning">{categoryError}</Banner> : null}
        {genderChanged ? <Banner tone="warning">{GENDER_CHANGED_AFTER_DECISION}</Banner> : null}
        {decision && candidateId !== null ? (
          <NowMark label={mark} active={nowKey === 'pickCategory' || nowKey === 'done'}>
            <CategoryPanel
              key={`${decision.id}:${decision.gender}:${decision.stepStatus}`}
              candidateId={candidateId}
              decision={decision}
              blockedReason={categoryLocked}
              genderSlot={
                <GenderRecheck
                  candidateId={candidateId}
                  gender={decision.gender}
                  genderSource={detail?.genderSource ?? null}
                  disabledReason={
                    categoryLocked ?? (categoryWaiting ? null : GENDER_RECHECK_DISABLED_REASON)
                  }
                />
              }
              nextSlot={
                decision.stepStatus === 'COMPLETED' && decision.isCurrent ? (
                  <ButtonLink variant="primary" to={stepPath(candidateId, 'THUMBNAIL')}>
                    다음: ⑤ 썸네일
                    <Icon name="arrow-right" size={16} />
                  </ButtonLink>
                ) : null
              }
            />
          </NowMark>
        ) : (
          <p className={styles.placeholder}>
            {categoryItem?.status === 'RUNNING' ? CATEGORY_RUNNING_TEXT : CATEGORY_PLACEHOLDER_TEXT}
          </p>
        )}
      </section>
    </>
  );
}
