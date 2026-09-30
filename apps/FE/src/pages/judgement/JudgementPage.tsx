import { useState } from 'react';
import { useParams } from 'react-router';
import {
  CostBreakdownPanel,
  DomesticPricePanel,
  FxRateManualForm,
  FxRateSummary,
  judgedWithComparison,
  parseCouponYen,
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
import { Banner, Button, DisabledReason } from '@/shared/ui';
import { PricingSummary } from './PricingSummary';
import { SizeJudgementTable } from './SizeJudgementTable';
import { SourcingConfirmPanel } from './SourcingConfirmPanel';
import styles from './JudgementPage.module.css';

const TITLE = '판정 · 소싱 확정 · 카테고리';

/** 쿠폰 칸 안내(보드: URL 후보만 입력, 비교한 후보는 비교표 값) */
export const COUPON_LABEL = '쿠폰 · URL 후보만 입력';
export const WAITING_DOMESTIC_TEXT =
  '국내 기준가를 넣으면 판정을 이어 계산합니다. 네이버쇼핑에서 찾아본 뒤 판매가 + 고객 배송비 총액을 넣어 주세요.';

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
 * SCR-04 ③ 판정 · 소싱 확정(Judgement.dc.html, P2-05). 후보 작업 틀(CandidateLayout) 안 단계 본문:
 * - ③ 머리: 제목 + 상태 줄(StepStatusBar — '실행'/'다시 실행'은 URL 후보면 쿠폰 칸 값을 `ownerInputs.couponYen`으로)
 * - 가격 요약: 원가 환율(P2-04 `FxRateSummary`, '직접 넣기' → `FxRateManualForm`) · 쿠폰 칸(URL 후보만 입력, 비교한 후보는
 *   비교표 값) · 최소 판매가 · 판매가 · 순이익·마진율(PricingSummary)
 * - 왼쪽: 국내 기준가(네이버쇼핑 링크는 여기에만 — CON-14) · 사이즈별 판정 / 오른쪽: 비용 분해 · 소싱 확정(G2)
 * - ④ 카테고리(`id="category"`)는 P2-06이 채운다(지금은 상태 줄만)
 * 결과는 폴링하지 않고 SSE(step-run.status-changed·gate.*)가 판정·게이트를 다시 읽힌다. 셀라파인더·'판매가를 바꿔 계산해
 * 보기'(M2)는 만들지 않는다.
 */
export function JudgementPage() {
  const { candidateId: rawId = '' } = useParams();
  const candidateId = parseCandidateId(rawId);
  const candidate = useCandidate(candidateId);
  const rail = useCandidateSteps(candidateId);
  const gates = useCandidateGates(candidateId);
  const judgementQuery = usePriceJudgementQuery(candidateId);
  const comparison = useSourcingComparison(candidateId);
  const fx = useLatestFxRatesQuery();
  const start = useStartStepRun();
  const [fxFormOpen, setFxFormOpen] = useState(false);
  const [coupon, setCoupon] = useState<string | null>(null);

  const detail = candidate.data;
  const items = railByCode(rail.data?.items);
  const pricing = items.PRICING;
  const judgement = judgementQuery.data;
  const judgementError =
    judgementQuery.error && judgementQuery.error.code !== 'STEP_OUTPUT_NOT_FOUND'
      ? judgementQuery.error.message
      : null;
  const g2 = gates.data?.items.find((g) => g.gate === 'G2');
  // 비교하지 않은 URL 후보: ② 현재 버전(비교표 머리) → 판정 사본 → 후보 만든 경로
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
    ? '등록 진행 중인 후보라 바꿀 수 없습니다.'
    : detail?.status === 'EXCLUDED'
      ? "제외된 후보입니다. '다시 작업'을 먼저 눌러 주세요."
      : pricing?.status === 'RUNNING'
        ? '③ 판정이 실행 중입니다. 끝난 뒤 다시 넣어 주세요.'
        : null;

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
      <title>{`${TITLE} · 신발 자동등록`}</title>
      <h1 className={styles.srOnly}>{TITLE}</h1>
      <section aria-labelledby="step3-title" className={styles.step}>
        <div className={styles.stepHead}>
          <h2 id="step3-title" className={styles.stepTitle}>
            ③ 판정
          </h2>
          <span className={styles.screenId}>SCR-04</span>
          <div className={styles.bar}>
            {pricing ? (
              <StepStatusBar
                item={pricing}
                source={sourceText(items.SOURCING, judgement)}
                candidateId={candidateId ?? undefined}
                error={start.error ?? undefined}
                actions={
                  <Button
                    disabled={start.isPending || runReason !== null}
                    aria-describedby={runReason ? 'pricing-run-why' : undefined}
                    onClick={run}
                  >
                    {runButtonLabel(pricing.status)}
                  </Button>
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
        {judgement && !judgement.isSaleCandidate && judgement.exclusionReason ? (
          <Banner tone="blocked">판매 후보 아님 · {judgement.exclusionReason}</Banner>
        ) : null}

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
              <DomesticPricePanel candidateId={candidateId} blockedReason={locked} />
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
              <SourcingConfirmPanel
                candidateId={candidateId}
                candidate={detail}
                judgement={judgement}
                gate={g2}
                uncompared={uncompared}
              />
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
            {items.CATEGORY ? (
              <StepStatusBar
                item={items.CATEGORY}
                source="② 장르 · 후보 성별"
                candidateId={candidateId ?? undefined}
              />
            ) : null}
          </div>
        </div>
        <p className={styles.placeholder}>리프 카테고리 고르기는 준비 중입니다.</p>
      </section>
    </>
  );
}
