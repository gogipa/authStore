import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../../src/common/events/progress-events.service.js';
import { StepExecutor } from '../../src/modules/step-engine/execution/step-executor.js';
import { StepRunnerRegistry } from '../../src/modules/step-engine/runner/step-runner.registry.js';
import {
  forwarderCsv,
  SEED_COLLECTED_AT,
  seedFxRates,
  seedPricingCandidate,
  truncatePricing,
  type PricingSeedInput,
} from '../fixtures/pricing/seed-candidate.js';
import { createCandidate } from '../fixtures/step-engine/candidate.factory.js';
import { insertStepRun } from '../fixtures/step-engine/step-run.factory.js';
import { createTestApp, TEST_START_MS, truncate, type TestApp } from '../helpers/test-app.js';

interface ErrorBody {
  code: string;
  message: string;
  fieldErrors?: { field: string; message: string }[];
  details?: Record<string, unknown>;
}

interface SizeBody {
  sizeMm: number;
  skuPriceYen: number;
  cGoodsKrw: number;
  vUsd: number;
  isDutyFree: boolean;
  twoPairTaxable: boolean;
  isBoundary: boolean;
  cTaxKrw: number;
  pMinKrw: number | null;
  optionPriceKrw: number;
  sizeSalePriceKrw: number | null;
  cMktKrw: number | null;
  vatAKrw: number | null;
  vatBKrw: number | null;
  profitAKrw: number | null;
  profitBKrw: number | null;
  marginRateA: number | null;
  pointsReferencePt: number | null;
  isSellable: boolean;
  unsellableReason: string | null;
}

interface JudgementBody {
  id: number;
  stepRunId: number;
  version: number;
  stepStatus: string;
  isCurrent: boolean;
  rakutenPageCollectedAt: string | null;
  pageValidUntil: string | null;
  pRefKrw: number;
  couponYen: number;
  costFxRate: { id: number; rateValue: number; unit: number };
  customsJpyFxRate: { id: number };
  customsUsdFxRate: { id: number; rateValue: number };
  forwarderRateTableId: number | null;
  chargeableWeightKg: number | null;
  cFwdKrw: number;
  fwdAssumed: boolean;
  dutyFreeLimitYen: number | null;
  vatMode: string;
  pricingRule: string;
  targetMarginRate: number;
  minProfitKrw: number;
  params: Record<string, unknown>;
  isSaleCandidate: boolean;
  sellableSizeCount: number;
  salePriceKrw: number | null;
  exclusionReason: string | null;
  sizes: SizeBody[];
  unjudgedSizes: { sizeMm: number; stockStatus: string }[];
}

/** 05-2 PriceJudgementDetail required + 선택 칸(P2-05가 늘 주는 것) */
const DETAIL_KEYS = [
  'id',
  'stepRunId',
  'candidateId',
  'version',
  'stepStatus',
  'isCurrent',
  'skuPriceSource',
  'rakutenItemId',
  'rakutenPageCollectedAt',
  'pageValidUntil',
  'domesticPriceId',
  'pRefKrw',
  'couponYen',
  'shippingYen',
  'shippingEstimated',
  'costFxRate',
  'customsJpyFxRate',
  'customsUsdFxRate',
  'forwarderRateTableId',
  'chargeableWeightKg',
  'cShipIntlKrw',
  'cFwdKrw',
  'fwdCouponKrw',
  'fwdAssumed',
  'dutyFreeLimitYen',
  'vatMode',
  'pricingRule',
  'targetMarginRate',
  'minProfitKrw',
  'params',
  'isSaleCandidate',
  'sellableSizeCount',
  'salePriceKrw',
  'exclusionReason',
  'judgedAt',
  'sizes',
  'unjudgedSizes',
].sort();

describe('③ 가격 판정(P2-05) e2e — autostore_test·실제 PRICING 실행기·G2 공급자', () => {
  let t: TestApp;
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;

  const http = () => request(t.app.getHttpServer());
  const post = (path: string, body?: object) => {
    const req = http().post(`/api/v1${path}`).set('X-AutoStore-Client', '1');
    return body ? req.send(body) : req;
  };
  const put = (path: string) => http().put(`/api/v1${path}`).set('X-AutoStore-Client', '1');
  const del = (path: string) => http().delete(`/api/v1${path}`).set('X-AutoStore-Client', '1');
  const get = (path: string) => http().get(`/api/v1${path}`);
  const idle = () => t.app.get(StepExecutor).whenIdle();
  const errorOf = (res: { body: unknown }) => res.body as ErrorBody;
  const runPricing = (candidateId: number, body?: object) =>
    post(`/candidates/${candidateId}/steps/PRICING/runs`, body ?? {});
  const enterPrice = (candidateId: number, pRefKrw: number, extra: object = {}) =>
    post(`/candidates/${candidateId}/domestic-prices`, { pRefKrw, ...extra });
  const judgement = async (candidateId: number, query = ''): Promise<JudgementBody> => {
    const res = await get(`/candidates/${candidateId}/price-judgement${query}`);
    expect(res.status).toBe(200);
    return res.body as JudgementBody;
  };
  const pricingStep = (candidateId: number) =>
    t.prisma.candidateStep.findUniqueOrThrow({
      where: { candidateId_stepCode: { candidateId, stepCode: 'PRICING' } },
    });
  /** ③ 실행 → 입력 대기 → 국내 기준가 → 완료까지 */
  const judge = async (input: PricingSeedInput, pRefKrw = 169000, runBody?: object) => {
    const seed = await seedPricingCandidate(t.prisma, input);
    const res = await runPricing(seed.candidate.id, runBody);
    expect(res.status).toBe(202);
    await idle();
    const entered = await enterPrice(seed.candidate.id, pRefKrw);
    expect(entered.status).toBe(201);
    await idle();
    return { seed, runId: (res.body as { stepRunId: number }).stepRunId };
  };

  beforeAll(async () => {
    t = await createTestApp();
    const sub = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
  });

  beforeEach(async () => {
    await idle();
    await truncatePricing(t.prisma);
    await seedFxRates(t.prisma);
    t.clock.ms = TEST_START_MS;
    events.length = 0;
  });

  afterAll(async () => {
    await idle();
    await truncatePricing(t.prisma);
    unsubscribe();
    await t.app.close();
  });

  describe('POST …/steps/PRICING/runs — 시작 조건·입력 대기', () => {
    it('국내 기준가 없음 → 202, 끝나면 WAITING_INPUT(owner.domesticPrice) · 판정 조회 404 STEP_OUTPUT_NOT_FOUND', async () => {
      const seed = await seedPricingCandidate(t.prisma, { kind: 'COMPARED' });
      const res = await runPricing(seed.candidate.id);
      expect(res.status).toBe(202);
      await idle();
      const run = await get(`/step-runs/${(res.body as { stepRunId: number }).stepRunId}`);
      expect(run.status).toBe(200);
      expect((run.body as { status: string }).status).toBe('WAITING_INPUT');
      const waiting = events.find(
        (e) =>
          e.name === 'step-run.status-changed' &&
          (e.data as { status?: string }).status === 'WAITING_INPUT',
      );
      expect(waiting?.data).toMatchObject({
        waitingReasonCode: 'PRICING_DOMESTIC_PRICE_REQUIRED',
        pendingInputs: ['owner.domesticPrice'],
      });
      const missing = await get(`/candidates/${seed.candidate.id}/price-judgement`);
      expect(missing.status).toBe(404);
      expect(errorOf(missing)).toMatchObject({
        code: 'STEP_OUTPUT_NOT_FOUND',
        details: { stepCode: 'PRICING' },
      });
    });

    it('환율 없음 → 409 FX_RATE_UNAVAILABLE(실행을 만들지 않는다)', async () => {
      await truncate(t.prisma, ['fx_rate']);
      const seed = await seedPricingCandidate(t.prisma, { kind: 'COMPARED' });
      const res = await runPricing(seed.candidate.id);
      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('FX_RATE_UNAVAILABLE');
      expect(await t.prisma.stepRun.count({ where: { stepCode: 'PRICING' } })).toBe(0);
    });

    it('비교 후보 + ownerInputs.couponYen → 422 COUPON_NOT_ALLOWED(쿠폰 행 없음)', async () => {
      const seed = await seedPricingCandidate(t.prisma, { kind: 'COMPARED' });
      const res = await runPricing(seed.candidate.id, { ownerInputs: { couponYen: 500 } });
      expect(res.status).toBe(422);
      expect(errorOf(res).code).toBe('COUPON_NOT_ALLOWED');
      expect(await t.prisma.pricingCouponInput.count()).toBe(0);
    });

    it('URL 후보 쿠폰 ¥1,000 → pricing_coupon_input 새 행(owner.coupon 시작 조건) · C_goods만 98,769', async () => {
      const { seed, runId } = await judge({ kind: 'URL' }, 169000, {
        ownerInputs: { couponYen: 1000 },
      });
      expect(await t.prisma.pricingCouponInput.count()).toBe(1);
      const input = await t.prisma.stepRunInput.findUniqueOrThrow({
        where: { stepRunId_inputKey: { stepRunId: runId, inputKey: 'owner.coupon' } },
      });
      expect(input.isStartCondition).toBe(true);
      const body = await judgement(seed.candidate.id);
      expect(body.couponYen).toBe(1000);
      expect(body.sizes[0]).toMatchObject({ cGoodsKrw: 98769, vUsd: 77.37 });
    });
  });

  describe('POST …/domestic-prices → 판정(PRD §8.3 기대값)', () => {
    it('입력 대기 중 169,000 → 201 RUNNING → 완료 뒤 판정이 PRD 예시와 같다', async () => {
      const seed = await seedPricingCandidate(t.prisma, { kind: 'COMPARED' });
      await runPricing(seed.candidate.id);
      await idle();
      const res = await enterPrice(seed.candidate.id, 169000, {
        sourceLabel: '네이버쇼핑 전체 최저가',
        sourceUrl: 'https://search.shopping.naver.com/search/all?query=1201A019-108',
      });
      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(`/api/v1/candidates/${seed.candidate.id}/domestic-prices`);
      expect(res.body).toMatchObject({
        candidateId: seed.candidate.id,
        pRefKrw: 169000,
        sourceKind: 'MANUAL',
        sourceLabel: '네이버쇼핑 전체 최저가',
        pricingStepStatus: 'RUNNING',
      });
      await idle();

      const body = await judgement(seed.candidate.id);
      expect(Object.keys(body).sort()).toEqual(DETAIL_KEYS);
      expect(body).toMatchObject({
        stepStatus: 'COMPLETED',
        isCurrent: true,
        version: 1,
        pRefKrw: 169000,
        couponYen: 0,
        cFwdKrw: 15000,
        fwdAssumed: true,
        forwarderRateTableId: null,
        dutyFreeLimitYen: 22490,
        vatMode: 'A',
        pricingRule: 'REF_MINUS_1PCT',
        targetMarginRate: 0.1,
        minProfitKrw: 5000,
        isSaleCandidate: true,
        sellableSizeCount: 5,
        salePriceKrw: 167300,
        exclusionReason: null,
      });
      expect(body.sizes.map((s) => s.sizeMm)).toEqual([250, 255, 260, 265, 275]);
      expect(body.sizes[0]).toMatchObject({
        skuPriceYen: 12000,
        cGoodsKrw: 107748,
        vUsd: 77.37,
        isDutyFree: true,
        twoPairTaxable: true,
        isBoundary: false,
        cTaxKrw: 0,
        pMinKrw: 153100,
        optionPriceKrw: 0,
        sizeSalePriceKrw: 167300,
        cMktKrw: 11092,
        vatAKrw: 3042,
        profitAKrw: 27418,
        marginRateA: 0.1639,
        profitBKrw: 16259,
        pointsReferencePt: 1090,
        isSellable: true,
        unsellableReason: null,
      });
      expect(body.unjudgedSizes).toEqual([
        { sizeMm: 270, stockStatus: 'SOLD_OUT' },
        { sizeMm: 280, stockStatus: 'BACK_ORDER' },
        { sizeMm: 285, stockStatus: 'SOLD_OUT' },
        { sizeMm: 290, stockStatus: 'NONE' },
      ]);
      // 판정에 쓴 환율 3종·페이지 유효 시간(수집 시각 + 6시간)
      expect(body.costFxRate).toMatchObject({ rateValue: 876, unit: 100 });
      expect(body.customsUsdFxRate).toMatchObject({ rateValue: 1358.72 });
      expect(body.rakutenPageCollectedAt).toBe(SEED_COLLECTED_AT.toISOString());
      expect(body.pageValidUntil).toBe(
        new Date(SEED_COLLECTED_AT.getTime() + 6 * 3_600_000).toISOString(),
      );
      expect(body.params).toMatchObject({
        cardSurchargePct: 2.5,
        saleFeePct: 3,
        npayFeePct: 3.63,
        miscCostKrw: 3000,
        judgementMarginPct: 1,
        sourcing: { comparisonPerformed: true },
      });
      // 6시간 규칙(P1-06)이 읽는 시각 = ② 수집 시각 사본
      const runner = t.app.get(StepRunnerRegistry).get('PRICING')!;
      expect(await runner.judgementPageCollectedAt!(t.prisma, body.stepRunId)).toEqual(
        SEED_COLLECTED_AT,
      );
    });

    it('완료 뒤 다시 입력(다른 금액) → RERUN_REQUIRED(owner.domesticPrice), 같은 금액이면 그대로', async () => {
      const { seed } = await judge({ kind: 'COMPARED' });
      const same = await enterPrice(seed.candidate.id, 169000);
      expect(same.status).toBe(201);
      expect((same.body as { pricingStepStatus: string }).pricingStepStatus).toBe('COMPLETED');
      const changed = await enterPrice(seed.candidate.id, 170000);
      expect(changed.status).toBe(201);
      expect((changed.body as { pricingStepStatus: string }).pricingStepStatus).toBe(
        'RERUN_REQUIRED',
      );
      const step = await pricingStep(seed.candidate.id);
      expect(step.staleInputs).toEqual(['owner.domesticPrice']);
      const list = await get(`/candidates/${seed.candidate.id}/domestic-prices`);
      expect(list.status).toBe(200);
      const page = list.body as { content: { pRefKrw: number }[]; page: { totalElements: number } };
      expect(page.page.totalElements).toBe(3);
      expect(page.content.map((c) => c.pRefKrw)).toEqual([170000, 169000, 169000]);
    });

    it('pRefKrw 0 → 422 VALIDATION_FAILED · SELLAFINDER → 422 · 없는 후보 → 404 · ③ 실행 중 → 409', async () => {
      const seed = await seedPricingCandidate(t.prisma, { kind: 'COMPARED' });
      const zero = await enterPrice(seed.candidate.id, 0);
      expect(zero.status).toBe(422);
      expect(errorOf(zero).code).toBe('VALIDATION_FAILED');
      // 저장 열(integer) 범위를 넘는 금액도 500이 아니라 422(05-2 maximum)
      const huge = await enterPrice(seed.candidate.id, 2_147_483_648);
      expect(huge.status).toBe(422);
      expect(errorOf(huge).fieldErrors?.[0]?.field).toBe('pRefKrw');
      const sella = await enterPrice(seed.candidate.id, 169000, { sourceKind: 'SELLAFINDER' });
      expect(sella.status).toBe(422);
      expect(errorOf(sella).fieldErrors?.[0]?.field).toBe('sourceKind');
      const missing = await enterPrice(999999, 169000);
      expect(missing.status).toBe(404);
      expect(errorOf(missing).code).toBe('CANDIDATE_NOT_FOUND');
      await insertStepRun(t.prisma, {
        candidateId: seed.candidate.id,
        stepCode: 'PRICING',
        status: 'RUNNING',
      });
      const locked = await enterPrice(seed.candidate.id, 169000);
      expect(locked.status).toBe(409);
      expect(errorOf(locked).code).toBe('STEP_LOCKED_BY_RUNNING_STEP');
      expect(await t.prisma.domesticPrice.count()).toBe(0);
    });

    it('등록 진행으로 잠긴 후보 → 국내 기준가·비교 없이 확정 모두 409 CANDIDATE_LOCKED(행을 넣지 않는다)', async () => {
      // 잠긴 상태는 등록 준비 칸(ck_candidate_ready)이 채워진 후보만 될 수 있어 후보 fixture로 만든다
      const { candidate } = await createCandidate(t.prisma, { status: 'REGISTERING' });
      const seed = { candidate };
      const price = await enterPrice(seed.candidate.id, 169000);
      expect(price.status).toBe(409);
      expect(errorOf(price)).toMatchObject({
        code: 'CANDIDATE_LOCKED',
        details: { status: 'REGISTERING' },
      });
      const confirm = await put(`/candidates/${seed.candidate.id}/no-comparison-confirmation`);
      expect(confirm.status).toBe(409);
      expect(errorOf(confirm).code).toBe('CANDIDATE_LOCKED');
      expect(await t.prisma.domesticPrice.count()).toBe(0);
      expect(
        await t.prisma.userActionLog.count({ where: { candidateId: seed.candidate.id } }),
      ).toBe(0);
    });

    it('활성 요금표(v2026-09, 1.2kg 15,000원) → 가정값 아님 · 요금표 id · 청구무게 1.2kg', async () => {
      const imported = await http()
        .post('/api/v1/forwarder-rate-tables')
        .set('X-AutoStore-Client', '1')
        .field('forwarderName', '배대지 A')
        .attach('file', forwarderCsv('rate-table-v2026-09.csv'), 'rate-table-v2026-09.csv');
      expect(imported.status).toBe(201);
      const { seed } = await judge({ kind: 'COMPARED' });
      const body = await judgement(seed.candidate.id);
      expect(body).toMatchObject({
        fwdAssumed: false,
        forwarderRateTableId: (imported.body as { rateTable: { id: number } }).rateTable.id,
        chargeableWeightKg: 1.2,
        cFwdKrw: 15000,
        salePriceKrw: 167300,
      });
    });
  });

  describe('GET …/price-judgement — 버전·오류', () => {
    it('실행 전 → 404 STEP_OUTPUT_NOT_FOUND(details.stepCode=PRICING) · 없는 후보 → 404 CANDIDATE_NOT_FOUND', async () => {
      const seed = await seedPricingCandidate(t.prisma, { kind: 'COMPARED' });
      const before = await get(`/candidates/${seed.candidate.id}/price-judgement`);
      expect(before.status).toBe(404);
      expect(errorOf(before)).toMatchObject({
        code: 'STEP_OUTPUT_NOT_FOUND',
        details: { stepCode: 'PRICING' },
      });
      const bad = await get(`/candidates/${seed.candidate.id}/price-judgement?stepRunId=abc`);
      expect(bad.status).toBe(422);
      expect(errorOf(bad).code).toBe('INVALID_QUERY_PARAMETER');
      const missing = await get('/candidates/999999/price-judgement');
      expect(missing.status).toBe(404);
      expect(errorOf(missing).code).toBe('CANDIDATE_NOT_FOUND');
    });

    it('다른 단계 stepRunId → 422 · 없는 실행 → 404 STEP_RUN_NOT_FOUND · ③만 다시 실행하면 수집 시각은 그대로', async () => {
      const { seed, runId } = await judge({ kind: 'COMPARED' });
      const other = await get(
        `/candidates/${seed.candidate.id}/price-judgement?stepRunId=${seed.sourcingStepRunId}`,
      );
      expect(other.status).toBe(422);
      expect(errorOf(other).code).toBe('INVALID_QUERY_PARAMETER');
      const none = await get(`/candidates/${seed.candidate.id}/price-judgement?stepRunId=99999`);
      expect(none.status).toBe(404);
      expect(errorOf(none).code).toBe('STEP_RUN_NOT_FOUND');

      t.clock.ms = TEST_START_MS + 2 * 3_600_000;
      const again = await runPricing(seed.candidate.id);
      expect(again.status).toBe(202);
      await idle();
      const v2 = await judgement(seed.candidate.id);
      expect(v2.version).toBe(2);
      expect(v2.stepRunId).not.toBe(runId);
      const v1 = await judgement(seed.candidate.id, `?stepRunId=${runId}`);
      expect(v1.isCurrent).toBe(false);
      expect(v2.rakutenPageCollectedAt).toBe(v1.rakutenPageCollectedAt);
      expect(v2.rakutenPageCollectedAt).toBe(SEED_COLLECTED_AT.toISOString());
    });

    it('이전 버전 다시 고르기(RESTORE_VERSION) → 새 버전이 그 판정 스냅샷을 그대로 복사한다', async () => {
      const { seed, runId } = await judge({ kind: 'COMPARED' });
      await enterPrice(seed.candidate.id, 175000);
      await runPricing(seed.candidate.id);
      await idle();
      expect((await judgement(seed.candidate.id)).salePriceKrw).toBe(173200);
      const restored = await post(`/candidates/${seed.candidate.id}/steps/PRICING/owner-edits`, {
        ownerAction: 'RESTORE_VERSION',
        baseStepRunId: runId,
      });
      expect(restored.status).toBe(201);
      const v3 = await judgement(seed.candidate.id);
      expect(v3.version).toBe(3);
      expect(v3.salePriceKrw).toBe(167300);
      expect(v3.pRefKrw).toBe(169000);
      expect(v3.sizes).toHaveLength(5);
      expect(v3.rakutenPageCollectedAt).toBe(SEED_COLLECTED_AT.toISOString());
    });

    it('트리거: 닫힌 실행의 price_judgement UPDATE → 오류(price_judgement_frozen)', async () => {
      const { seed } = await judge({ kind: 'COMPARED' });
      const body = await judgement(seed.candidate.id);
      await expect(
        t.prisma.$executeRawUnsafe(
          `UPDATE price_judgement SET sale_price_krw = 1 WHERE id = ${body.id}`,
        ),
      ).rejects.toThrow(/cannot change/);
    });
  });

  describe('판매 후보 아님 → 후보 제외', () => {
    it('재고 있는 목표 사이즈 2개 → 판매 후보 아님 · 후보 EXCLUDED(NOT_SALE_CANDIDATE) · 이력 1행 · 다시 실행 409 CANDIDATE_EXCLUDED', async () => {
      const { seed } = await judge({
        kind: 'COMPARED',
        sizes: [
          { sizeMm: 250, priceYen: 12000, quantity: 2 },
          { sizeMm: 255, priceYen: 12000, quantity: 2 },
          { sizeMm: 260, priceYen: 12000, quantity: 0 },
        ],
      });
      const body = await judgement(seed.candidate.id);
      expect(body.isSaleCandidate).toBe(false);
      expect(body.sellableSizeCount).toBe(2);
      expect(body.exclusionReason).toBe('판매 가능 사이즈가 2개로 최소 기준 3개보다 적습니다.');
      const candidate = await t.prisma.candidate.findUniqueOrThrow({
        where: { id: seed.candidate.id },
      });
      expect(candidate).toMatchObject({ status: 'EXCLUDED', excludedReason: 'NOT_SALE_CANDIDATE' });
      const history = await t.prisma.candidateStatusHistory.findMany({
        where: { candidateId: seed.candidate.id, reason: 'NOT_SALE_CANDIDATE' },
      });
      expect(history).toHaveLength(1);
      expect(history[0]?.stepRunId).toBe(body.stepRunId);
      const again = await runPricing(seed.candidate.id);
      expect(again.status).toBe(409);
      expect(errorOf(again).code).toBe('CANDIDATE_EXCLUDED');
      const price = await enterPrice(seed.candidate.id, 180000);
      expect(price.status).toBe(409);
      expect(errorOf(price).code).toBe('CANDIDATE_EXCLUDED');

      // reopen 뒤 G2는 판매 후보 아님으로 막힌다
      const reopened = await post(`/candidates/${seed.candidate.id}/reopen`);
      expect(reopened.status).toBe(200);
      const g2 = await post(`/candidates/${seed.candidate.id}/gates/G2/pass`, {
        basisStepRunId: body.stepRunId,
      });
      expect(g2.status).toBe(409);
      expect(errorOf(g2).code).toBe('NOT_SALE_CANDIDATE');
    });
  });

  describe('GET …/naver-shopping-links', () => {
    it('키워드 후보 → 출처 키워드·型番 2개 / 키워드 없는 URL 후보 → MODEL_CODE 1개', async () => {
      const keyword = await seedPricingCandidate(t.prisma, { kind: 'COMPARED' });
      const res = await get(`/candidates/${keyword.candidate.id}/naver-shopping-links`);
      expect(res.status).toBe(200);
      expect((res.body as { items: unknown[] }).items).toEqual([
        {
          kind: 'SOURCE_KEYWORD',
          query: '아식스 젤카야노14',
          url: 'https://search.shopping.naver.com/search/all?query=%EC%95%84%EC%8B%9D%EC%8A%A4+%EC%A0%A4%EC%B9%B4%EC%95%BC%EB%85%B814',
        },
        {
          kind: 'MODEL_CODE',
          query: '1201A019-108',
          url: 'https://search.shopping.naver.com/search/all?query=1201A019-108',
        },
      ]);
      const url = await seedPricingCandidate(t.prisma, { kind: 'URL' });
      const one = await get(`/candidates/${url.candidate.id}/naver-shopping-links`);
      expect((one.body as { items: { kind: string }[] }).items.map((i) => i.kind)).toEqual([
        'MODEL_CODE',
      ]);
      const missing = await get('/candidates/999999/naver-shopping-links');
      expect(missing.status).toBe(404);
    });
  });

  describe("'비교 없이 확정'과 G2", () => {
    it('비교 후보 PUT → 409 CONFIRMATION_NOT_APPLICABLE', async () => {
      const seed = await seedPricingCandidate(t.prisma, { kind: 'COMPARED' });
      const res = await put(`/candidates/${seed.candidate.id}/no-comparison-confirmation`);
      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('CONFIRMATION_NOT_APPLICABLE');
    });

    it('URL 후보: G2 체크 없음 409 → PUT 200(다시 PUT 같은 시각, 감사 1행) → G2 201 → DELETE 409 GATE_ALREADY_PASSED', async () => {
      const { seed, runId } = await judge({ kind: 'URL' });
      const g2Path = `/candidates/${seed.candidate.id}/gates/G2/pass`;
      const blocked = await post(g2Path, { basisStepRunId: runId });
      expect(blocked.status).toBe(409);
      expect(errorOf(blocked).code).toBe('NO_COMPARISON_NOT_CONFIRMED');

      const path = `/candidates/${seed.candidate.id}/no-comparison-confirmation`;
      const first = await put(path);
      expect(first.status).toBe(200);
      const at = (first.body as { noComparisonConfirmedAt: string }).noComparisonConfirmedAt;
      expect(first.body).toEqual({ candidateId: seed.candidate.id, noComparisonConfirmedAt: at });
      t.clock.ms = TEST_START_MS + 60_000;
      const second = await put(path);
      expect(second.status).toBe(200);
      expect((second.body as { noComparisonConfirmedAt: string }).noComparisonConfirmedAt).toBe(at);
      expect(
        await t.prisma.userActionLog.count({
          where: { candidateId: seed.candidate.id, eventType: 'OWNER_CONFIRMED' },
        }),
      ).toBe(1);

      const revoked = await del(path);
      expect(revoked.status).toBe(204);
      expect(await del(path).then((r) => r.status)).toBe(204);
      expect((await put(path)).status).toBe(200);

      const passed = await post(g2Path, { basisStepRunId: runId });
      expect(passed.status).toBe(201);
      const afterPass = await del(path);
      expect(afterPass.status).toBe(409);
      expect(errorOf(afterPass).code).toBe('GATE_ALREADY_PASSED');
    });

    it('같은 값으로 ③ 재실행 → G2 유효 · 판매가가 바뀌면 SSE gate.invalidated', async () => {
      const { seed, runId } = await judge({ kind: 'COMPARED' });
      const passed = await post(`/candidates/${seed.candidate.id}/gates/G2/pass`, {
        basisStepRunId: runId,
      });
      expect(passed.status).toBe(201);
      const gatesOf = async () => {
        const res = await get(`/candidates/${seed.candidate.id}/gates`);
        return (res.body as { items: { gate: string; fingerprintValid: boolean }[] }).items.find(
          (g) => g.gate === 'G2',
        )!;
      };
      expect((await gatesOf()).fingerprintValid).toBe(true);

      await runPricing(seed.candidate.id);
      await idle();
      expect((await gatesOf()).fingerprintValid).toBe(true);
      expect(events.some((e) => e.name === 'gate.invalidated')).toBe(false);

      await enterPrice(seed.candidate.id, 175000);
      await runPricing(seed.candidate.id);
      await idle();
      const g2 = await gatesOf();
      expect(g2.fingerprintValid).toBe(false);
      const invalidated = events.find((e) => e.name === 'gate.invalidated');
      expect(invalidated?.data).toMatchObject({ candidateId: seed.candidate.id, gate: 'G2' });
      expect((invalidated?.data as { changedBasisKeys: string[] }).changedBasisKeys).toContain(
        'salePrices.250',
      );
    });
  });
});
