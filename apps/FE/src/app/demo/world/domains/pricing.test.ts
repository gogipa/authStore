import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@/shared/api/client';
import type { DemoApi } from '../../demoApi';
import { reachSourcingDone, reachSourcingSearch, startDemoKit } from '../testkit';

/**
 * ③ 판정 · G2 소싱 확정 · 국내 기준가(D-32). 실제 `api` 클라이언트로 화면이 보내는 요청 그대로 부르고, 실제 BE의 상태·오류 문구를
 * 글자 그대로 확인한다. 지연은 0이고 `world.flush()`가 맡겨 둔 결과를 지금 낸다.
 */
let demo: DemoApi;
let off: () => void;

beforeEach(() => {
  ({ demo, off } = startDemoKit());
});

afterEach(() => {
  off();
  expect(demo.serverErrors).toEqual([]);
  expect(demo.unknownRequests).toEqual([]);
});

const id = 1;
const path = { params: { path: { candidateId: id } } };

const runPricing = (body: object = {}) =>
  api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
    params: { path: { candidateId: id, stepCode: 'PRICING' } },
    body,
  });

const savePrice = (pRefKrw: unknown, extra: object = {}) =>
  api.POST('/candidates/{candidateId}/domestic-prices', {
    ...path,
    body: { pRefKrw, sourceUrl: null, sourceKind: 'MANUAL', ...extra } as never,
  });

const judgement = () => api.GET('/candidates/{candidateId}/price-judgement', path);

const passG2 = (basisStepRunId: unknown, extra: object = {}) =>
  api.POST('/candidates/{candidateId}/gates/{gateCode}/pass', {
    params: { path: { candidateId: id, gateCode: 'G2' } },
    body: { basisStepRunId, ...extra } as never,
  });

async function stepOf(code: string) {
  const rail = await api.GET('/candidates/{candidateId}/steps', path);
  return rail.data!.items.find((item) => item.stepCode === code)!;
}

const g2State = async () =>
  (await api.GET('/candidates/{candidateId}/gates', path)).data!.items.find(
    (g) => g.gate === 'G2',
  )!;

describe('③ 실행 전', () => {
  it('② 전에는 시작 조건 409, 레일의 꺼진 이유도 같은 문구', async () => {
    await reachSourcingSearch(demo);
    const res = await runPricing();
    expect(res.response.status).toBe(409);
    expect(res.error).toMatchObject({
      code: 'STEP_START_CONDITION_UNMET',
      message: '시작에 필요한 값이 없습니다: ② 목표 사이즈 SKU가·재고, 성별.',
      details: { stepCode: 'PRICING' },
    });
    expect(res.error?.fieldErrors?.map((f) => f.field)).toEqual([
      'sourcing.targetSkus',
      'candidate.gender',
    ]);
    const item = await stepOf('PRICING');
    expect(item.status).toBe('NOT_RUN');
    expect(item.actions.run).toMatchObject({
      enabled: false,
      disabledReason: { code: 'STEP_START_CONDITION_UNMET' },
    });
  });

  it('판정·국내 기준가 이력은 비어 있고 조회는 404 STEP_OUTPUT_NOT_FOUND, 네이버쇼핑 링크는 2개', async () => {
    await reachSourcingDone(demo);
    const res = await judgement();
    expect(res.response.status).toBe(404);
    expect(res.error).toMatchObject({
      code: 'STEP_OUTPUT_NOT_FOUND',
      message: '아직 ③ 판정을 실행하지 않았습니다.',
      details: { stepCode: 'PRICING' },
    });
    const prices = await api.GET('/candidates/{candidateId}/domestic-prices', path);
    expect(prices.data).toMatchObject({
      content: [],
      page: { number: 0, totalElements: 0, totalPages: 0 },
    });
    const links = await api.GET('/candidates/{candidateId}/naver-shopping-links', path);
    expect(links.data?.items.map((l) => [l.kind, l.query])).toEqual([
      ['SOURCE_KEYWORD', '아식스 젤카야노14'],
      ['MODEL_CODE', '1201A019'],
    ]);
    expect(links.data?.items[0]?.url).toContain('query=');
    // 실행 가능 + 쿠폰은 비교표 행에 있다
    expect((await stepOf('PRICING')).actions.run.enabled).toBe(true);
    const coupon = await runPricing({ ownerInputs: { couponYen: 1000 } });
    expect(coupon.error).toMatchObject({
      code: 'COUPON_NOT_ALLOWED',
      message: '비교표가 있는 여정은 비교표 행에서 쿠폰을 넣어 주세요.',
    });
    expect((await stepOf('PRICING')).status).toBe('NOT_RUN');
    const bad = await runPricing({ ownerInputs: { faceOption: 'FULL_FACE' } });
    expect(bad.error).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('G2: 아직 판정이 없어 현재 버전이 없다 — 게이트 목록은 STEP_NOT_COMPLETED(미실행)', async () => {
    await reachSourcingDone(demo);
    const state = await g2State();
    expect(state).toMatchObject({ passed: false, fingerprintValid: false, gatePassId: null });
    expect(state.blockedReasons).toEqual([
      {
        code: 'STEP_NOT_COMPLETED',
        message: '③ 판정이 아직 완료되지 않았습니다(지금: 미실행).',
        details: { stepCode: 'PRICING', status: 'NOT_RUN' },
      },
    ]);
    const res = await passG2(1);
    expect(res.error).toMatchObject({
      code: 'VERSION_NOT_CURRENT',
      message: '화면을 연 뒤 값이 바뀌었습니다. 새로 고친 뒤 다시 해 주세요.',
      details: { stepCode: 'PRICING', currentStepRunId: null },
    });
  });
});

describe('③ 실행 먼저 → 입력 대기 → 국내 기준가', () => {
  it('실행 → 입력 대기(조회 404) → 국내 기준가 저장(RUNNING) → 같은 실행이 완료', async () => {
    await reachSourcingDone(demo);
    const accepted = await runPricing();
    expect(accepted.response.status).toBe(202);
    expect(accepted.data).toMatchObject({ stepCode: 'PRICING', status: 'RUNNING', version: 1 });
    const runId = accepted.data!.stepRunId;
    // 실행 중: 같은 단계를 또 누르면 409, 판정은 아직 없다
    expect((await runPricing()).error).toMatchObject({
      code: 'STEP_ALREADY_RUNNING',
      message: '이 단계가 이미 실행 중입니다.',
    });
    expect((await judgement()).response.status).toBe(404);
    demo.world.flush();

    // 입력 대기: 판정은 아직 없고, [다시 실행]은 입력 대기 문구로 막힌다
    const waiting = await stepOf('PRICING');
    expect(waiting.status).toBe('WAITING_INPUT');
    expect(waiting.currentStepRunId).toBe(runId);
    expect(waiting.actions.run.disabledReason?.message).toBe(
      '이 단계가 입력을 기다리고 있습니다. 입력을 마치면 이어서 실행됩니다.',
    );
    const again = await runPricing();
    expect(again.error).toMatchObject({
      code: 'STEP_ALREADY_RUNNING',
      message: '이 단계가 입력을 기다리고 있습니다. 입력을 마치면 이어서 실행됩니다.',
      details: { stepCode: 'PRICING', status: 'WAITING_INPUT' },
    });
    expect((await judgement()).response.status).toBe(404);
    expect(demo.world.s.steps.PRICING.runs.at(-1)).toMatchObject({
      waitingReasonCode: 'PRICING_DOMESTIC_PRICE_REQUIRED',
      pendingInputs: ['owner.domesticPrice'],
    });
    // G2: 입력 대기라 막힌 이유 '지금: 입력 대기'
    expect((await g2State()).blockedReasons[0]?.message).toBe(
      '③ 판정이 아직 완료되지 않았습니다(지금: 입력 대기).',
    );
    expect((await passG2(runId)).error).toMatchObject({
      code: 'STEP_NOT_COMPLETED',
      message: '③ 판정이 아직 완료되지 않았습니다(지금: 입력 대기).',
    });

    // 국내 기준가 저장 → 201, 이어 계산 중(RUNNING)
    const saved = await savePrice(169_000, { sourceUrl: 'http://localhost/p/1' });
    expect(saved.response.status).toBe(201);
    expect(saved.data).toMatchObject({
      id: 1,
      candidateId: id,
      pRefKrw: 169_000,
      sourceKind: 'MANUAL',
      sourceLabel: null,
      sourceUrl: 'http://localhost/p/1',
      domesticPriceImportRowId: null,
      pricingStepStatus: 'RUNNING',
    });
    expect((await stepOf('PRICING')).status).toBe('RUNNING');
    // 이어 계산하는 동안 같은 값을 또 넣을 수 없다
    expect((await savePrice(169_000)).error).toMatchObject({
      code: 'STEP_LOCKED_BY_RUNNING_STEP',
      message: '③ 판정이 실행 중이라 지금은 할 수 없습니다. 끝난 뒤 다시 해 주세요.',
      details: { stepCode: 'PRICING', runningStepCode: 'PRICING' },
    });
    expect((await judgement()).response.status).toBe(404);
    demo.world.flush();

    // 같은 실행(id·버전)이 완료되고 판정은 PRD 예시 값이다
    const done = await stepOf('PRICING');
    expect(done.status).toBe('COMPLETED');
    expect(done.currentStepRunId).toBe(runId);
    const res = await judgement();
    expect(res.data).toMatchObject({
      stepRunId: runId,
      version: 1,
      stepStatus: 'COMPLETED',
      isCurrent: true,
      candidateId: id,
      domesticPriceId: 1,
      pRefKrw: 169_000,
      salePriceKrw: 167_300,
      isSaleCandidate: true,
      sellableSizeCount: 5,
      exclusionReason: null,
      pricingRule: 'REF_MINUS_1PCT',
      skuPriceSource: 'STEP2',
    });
    expect(res.data?.sizes.map((s) => s.sizeMm)).toEqual([250, 255, 260, 265, 275]);
    expect(res.data?.sizes[0]).toMatchObject({
      skuPriceYen: 12_000,
      cGoodsKrw: 107_748,
      pMinKrw: 153_100,
      sizeSalePriceKrw: 167_300,
      cMktKrw: 11_092,
      vatAKrw: 3_042,
      vatBKrw: 14_201,
      profitAKrw: 27_418,
      profitBKrw: 16_259,
      marginRateA: 0.1639,
      isSellable: true,
    });
    expect(res.data?.costFxRate).toMatchObject({ rateValue: 876, unit: 100 });
    // 라쿠텐 페이지 수집 시각 + 6시간
    const collected = Date.parse(res.data!.rakutenPageCollectedAt!);
    expect(Date.parse(res.data!.pageValidUntil!)).toBe(collected + 6 * 60 * 60_000);
    expect(Date.parse(res.data!.judgedAt)).toBeGreaterThanOrEqual(collected);
    // 입력 이력(최신이 앞)
    const prices = await api.GET('/candidates/{candidateId}/domestic-prices', {
      params: { path: { candidateId: id }, query: { size: 1 } },
    });
    expect(prices.data?.content).toHaveLength(1);
    expect(prices.data?.page.totalElements).toBe(1);
    expect(prices.data?.content[0]?.pRefKrw).toBe(169_000);
  });

  it('국내 기준가를 먼저 저장하면 NOT_RUN 그대로 → [실행]은 대기 없이 완료', async () => {
    await reachSourcingDone(demo);
    const saved = await savePrice(169_000);
    expect(saved.data?.pricingStepStatus).toBe('NOT_RUN');
    expect((await stepOf('PRICING')).status).toBe('NOT_RUN');
    expect(demo.world.progress().next?.id).toBe('runPricing');
    await runPricing();
    demo.world.flush();
    expect((await stepOf('PRICING')).status).toBe('COMPLETED');
    expect((await judgement()).data?.salePriceKrw).toBe(167_300);
  });

  it('기준가에서 판매가·순이익을 같은 식으로 다시 계산한다(국내가 200,000원 → 판매가 198,000원)', async () => {
    await reachSourcingDone(demo);
    await savePrice(200_000);
    await runPricing();
    demo.world.flush();
    const sizes = (await judgement()).data!.sizes;
    expect(sizes[0]).toMatchObject({
      sizeSalePriceKrw: 198_000,
      cMktKrw: 13_127,
      vatAKrw: 5_648,
      profitAKrw: 53_477,
    });
  });
});

describe('국내 기준가 검사', () => {
  it('모양이 틀리면 422 VALIDATION_FAILED + 칸 문구(BE class-validator 그대로)', async () => {
    await reachSourcingDone(demo);
    const cases: [unknown, object, string, string][] = [
      [0, {}, 'pRefKrw', '0보다 커야 합니다.'],
      [1.5, {}, 'pRefKrw', '정수여야 합니다.'],
      ['169000', {}, 'pRefKrw', '정수여야 합니다.'],
      [2_147_483_648, {}, 'pRefKrw', '2,147,483,647 이하여야 합니다.'],
      [169_000, { sourceUrl: 'abc' }, 'sourceUrl', 'http(s) 주소여야 합니다.'],
      [
        169_000,
        { sourceKind: 'SELLAFINDER' },
        'sourceKind',
        'M1에서는 직접 입력(MANUAL)만 받습니다.',
      ],
      [
        169_000,
        { domesticPriceImportRowId: 3 },
        'domesticPriceImportRowId',
        '셀라파인더 가져오기는 M2입니다.',
      ],
    ];
    for (const [price, extra, field, message] of cases) {
      const res = await savePrice(price, extra);
      expect(res.response.status, field + message).toBe(422);
      expect(res.error, field + message).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: '입력값을 확인해 주세요.',
      });
      expect(res.error?.fieldErrors?.[0], field + message).toMatchObject({ field, message });
    }
    expect(demo.world.s.pricing.domesticPrices).toEqual([]);
  });

  it('체험 하한 154,647원 아래는 안내와 함께 거절(저장하지 않는다)', async () => {
    await reachSourcingDone(demo);
    const low = await savePrice(154_646);
    expect(low.response.status).toBe(403);
    expect(low.error).toMatchObject({ code: 'DEMO_READ_ONLY' });
    expect(low.error?.message).toContain('154,647원 이상');
    expect(demo.world.s.pricing.domesticPrices).toEqual([]);
    expect((await savePrice(154_647)).response.status).toBe(201);
    await runPricing();
    demo.world.flush();
    // 판매가 = max(국내가 −1%를 100원 단위 내림, 최소 판매가 153,100원)
    expect((await judgement()).data?.salePriceKrw).toBe(153_100);
  });

  it('제외된 여정에는 저장할 수 없다(409 CANDIDATE_EXCLUDED)', async () => {
    await reachSourcingDone(demo);
    demo.world.candidate().status = 'EXCLUDED';
    const res = await savePrice(169_000);
    expect(res.error).toMatchObject({
      code: 'CANDIDATE_EXCLUDED',
      message: "제외된 여정입니다. '다시 작업'을 먼저 눌러 주세요.",
    });
  });
});

describe('G2 소싱 확정', () => {
  async function judged() {
    await reachSourcingDone(demo);
    await savePrice(169_000);
    await runPricing();
    demo.world.flush();
    return (await judgement()).data!.stepRunId;
  }

  it('통과 201 → 같은 판정으로 다시 누르면 200(같은 기록)', async () => {
    const runId = await judged();
    expect(demo.world.progress().next?.id).toBe('passG2');
    // 완료 직후 G2는 막힌 이유가 없다(비교한 여정)
    expect(await g2State()).toMatchObject({ passed: false, blockedReasons: [] });
    const first = await passG2(runId);
    expect(first.response.status).toBe(201);
    expect(first.data).toMatchObject({
      gate: 'G2',
      basisStepRunId: runId,
      candidateStatus: 'WORKING',
      statusChanged: false,
      thumbnailSelectionId: null,
      thumbnailStepRunId: null,
      warnings: [],
    });
    expect(first.data?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const gate = await g2State();
    expect(gate).toMatchObject({
      passed: true,
      fingerprintValid: true,
      gatePassId: first.data!.gatePassId,
      basisStepRunId: runId,
      blockedReasons: [],
    });
    const detail = await api.GET('/candidates/{candidateId}', path);
    expect(detail.data?.gates.find((g) => g.gate === 'G2')).toMatchObject({
      valid: true,
      gatePassId: first.data!.gatePassId,
    });
    expect(demo.world.progress().next?.id).toBe('runCategory');
    const again = await passG2(runId);
    expect(again.response.status).toBe(200);
    expect(again.data?.gatePassId).toBe(first.data!.gatePassId);
  });

  it('틀린 요청: 모양 422 · 현재 버전이 아님 409', async () => {
    const runId = await judged();
    const shape = await passG2('abc', { checklist: {} });
    expect(shape.response.status).toBe(422);
    expect(shape.error?.code).toBe('VALIDATION_FAILED');
    expect(shape.error?.fieldErrors).toEqual([
      { field: 'checklist', message: 'G2 통과에서는 받지 않는 칸입니다.', rejectedValue: {} },
      {
        field: 'basisStepRunId',
        message: '1 이상의 정수여야 합니다.',
        rejectedValue: 'abc',
      },
    ]);
    const stale = await passG2(runId + 50);
    expect(stale.error).toMatchObject({
      code: 'VERSION_NOT_CURRENT',
      details: { stepCode: 'PRICING', currentStepRunId: runId },
    });
    expect(demo.world.s.gates.G2).toBeNull();
  });

  it('다시 실행하면 새 버전이 열리고(조회 404 · G2 일시 무효) 같은 판정이면 G2가 다시 유효하다', async () => {
    const runId = await judged();
    await passG2(runId);
    const rerun = await runPricing();
    expect(rerun.data).toMatchObject({ version: 2, status: 'RUNNING' });
    // 새 실행은 판정 스냅샷이 아직 없다
    expect((await judgement()).error).toMatchObject({ code: 'STEP_OUTPUT_NOT_FOUND' });
    expect(await g2State()).toMatchObject({ passed: false });
    demo.world.flush();
    const after = await judgement();
    expect(after.data).toMatchObject({ version: 2, isCurrent: true, salePriceKrw: 167_300 });
    expect(after.data!.stepRunId).toBe(rerun.data!.stepRunId);
    // 국내 기준가는 그대로(대기 없이 완료)이고 판정이 같아 G2는 그대로 유효하다
    expect(await g2State()).toMatchObject({ passed: true, fingerprintValid: true });
    expect(demo.world.s.gates.G2?.basisStepRunId).toBe(runId);
    // 다시 누르면 판정이 같아 기존 통과(200)
    expect((await passG2(rerun.data!.stepRunId)).response.status).toBe(200);
    // 지난 버전 조회는 지금 스냅샷이 아니라 404
    expect(
      (
        await api.GET('/candidates/{candidateId}/price-judgement', {
          params: { path: { candidateId: id }, query: { stepRunId: runId } },
        })
      ).error,
    ).toMatchObject({ code: 'STEP_OUTPUT_NOT_FOUND' });
  });

  it('완료 뒤 다른 금액을 넣으면 재실행 필요(옛 판정은 그대로라 G2 유효) → 다시 실행하면 새 판매가이고 G2는 다시 통과해야 한다', async () => {
    const runId = await judged();
    const firstId = (await passG2(runId)).data!.gatePassId;
    // 같은 금액: 그대로
    expect((await savePrice(169_000)).data?.pricingStepStatus).toBe('COMPLETED');
    expect((await stepOf('PRICING')).status).toBe('COMPLETED');
    // 다른 금액: 재실행 필요
    const changed = await savePrice(180_000);
    expect(changed.data?.pricingStepStatus).toBe('RERUN_REQUIRED');
    expect((await stepOf('PRICING')).status).toBe('RERUN_REQUIRED');
    const stale = await judgement();
    expect(stale.data).toMatchObject({ stepStatus: 'RERUN_REQUIRED', pRefKrw: 169_000 });
    // BE: 재실행 필요만으로 게이트 지문이 바뀌지 않는다(판정 산출물은 옛 버전 그대로)
    expect(await g2State()).toMatchObject({ passed: true, fingerprintValid: true });
    expect(demo.world.progress().next?.id).toBe('rerunStale');
    // 재실행 필요에서는 G2를 새로 통과할 수 없다
    expect((await passG2(runId)).error).toMatchObject({
      code: 'STEP_NOT_COMPLETED',
      message: '③ 판정이 아직 완료되지 않았습니다(지금: 재실행 필요).',
    });
    await runPricing();
    // 다시 실행하는 동안은 산출물이 없어 G2 확인 중(PENDING)이다
    expect(await g2State()).toMatchObject({ passed: false });
    demo.world.flush();
    expect((await judgement()).data).toMatchObject({ pRefKrw: 180_000, salePriceKrw: 178_200 });
    // 판매가가 달라져 이전 통과는 무효(MISMATCH): 통과 기록은 남고 바뀐 구성값이 보인다
    expect(demo.world.s.gates.G2).not.toBeNull();
    expect(await g2State()).toMatchObject({
      passed: false,
      fingerprintValid: false,
      changedBasisKeys: ['250', '255', '260', '265', '275'].map((mm) => `salePrices.${mm}`),
    });
    expect(demo.world.progress().next?.id).toBe('passG2');
    const second = await passG2((await judgement()).data!.stepRunId);
    expect(second.response.status).toBe(201);
    expect(second.data!.gatePassId).toBeGreaterThan(firstId);
    expect(await g2State()).toMatchObject({ passed: true, changedBasisKeys: [] });
  });

  it('② 다시 실행 중에는 통과할 수 없다(409 STEP_LOCKED_BY_RUNNING_STEP)', async () => {
    const runId = await judged();
    await api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
      params: { path: { candidateId: id, stepCode: 'SOURCING' } },
      body: {},
    });
    const res = await passG2(runId);
    expect(res.error).toMatchObject({
      code: 'STEP_LOCKED_BY_RUNNING_STEP',
      message: '② 소싱이 실행 중이라 지금은 할 수 없습니다. 끝난 뒤 다시 해 주세요.',
    });
    // ③ 실행 시작도 같은 이유로 막힌다
    expect((await runPricing()).error).toMatchObject({ code: 'STEP_LOCKED_BY_RUNNING_STEP' });
  });
});
