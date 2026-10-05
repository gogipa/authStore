import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import { categoryDecision, categorySelectionResult } from '@/test/fixtures/category';
import { domesticPriceEntry, fxLatest, naverLinks, priceJudgement } from '@/test/fixtures/pricing';
import { sourcingComparison } from '@/test/fixtures/sourcing';
import { candidateDetail, gateList, page, stepRail } from '@/test/fixtures/stepEngine';
import { renderRoute } from '@/test/renderRoute';
import type { CategoryDecisionDetail } from '@/features/category';
import type { PriceJudgementDetail } from '@/features/pricing';

const CANDIDATE_ID = 1;

/** 가짜 서버: 여정 1(② 완료, ③ 완료 — PRD §8.3 예시 판정) */
function setup({
  judgement = priceJudgement(),
  compared = true,
  pricingStatus = 'COMPLETED',
  links = naverLinks(),
  category = null,
  categoryStatus = 'NOT_RUN',
  gender = 'MALE',
  genderSource = 'STEP2',
  g2Passed = false,
  domesticSaved = judgement !== null,
  candidatePatch = {},
}: {
  judgement?: PriceJudgementDetail | null;
  compared?: boolean;
  pricingStatus?: 'COMPLETED' | 'WAITING_INPUT' | 'NOT_RUN';
  links?: ReturnType<typeof naverLinks>;
  /** ④ 결정(없으면 404 STEP_OUTPUT_NOT_FOUND) */
  category?: CategoryDecisionDetail | null;
  categoryStatus?: 'COMPLETED' | 'WAITING_INPUT' | 'NOT_RUN';
  gender?: 'MALE' | 'FEMALE';
  genderSource?: 'STEP2' | 'OWNER';
  /** 소싱 확정(G2)을 이미 통과했는가 */
  g2Passed?: boolean;
  /** 국내 기준가를 한 번이라도 저장했는가(기본: 판정이 있으면 저장함) */
  domesticSaved?: boolean;
  /** 여정 상세에 덮어쓸 값(잠금·상태 등) */
  candidatePatch?: Partial<ReturnType<typeof candidateDetail>>;
} = {}) {
  const api = stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList(38)),
    [`GET /candidates/${CANDIDATE_ID}`]: () =>
      jsonResponse(
        candidateDetail({
          id: CANDIDATE_ID,
          creationPath: compared ? 'KEYWORD' : 'RAKUTEN_URL',
          sourceKeyword: compared ? '아식스 젤카야노14' : null,
          itemCode: 'shop-a:10000123',
          resumeStepCode: 'PRICING',
          gender,
          genderSource,
          ...candidatePatch,
        }),
      ),
    [`GET /candidates/${CANDIDATE_ID}/steps`]: () =>
      jsonResponse(
        stepRail({
          SOURCING: { status: 'COMPLETED' },
          PRICING: { status: pricingStatus },
          CATEGORY: { status: categoryStatus },
        }),
      ),
    [`GET /candidates/${CANDIDATE_ID}/category-decision`]: () =>
      category
        ? jsonResponse(category)
        : errorResponse(404, 'STEP_OUTPUT_NOT_FOUND', '아직 ④ 카테고리를 실행하지 않았습니다.'),
    [`GET /candidates/${CANDIDATE_ID}/gates`]: () => jsonResponse(gateList({ G2: g2Passed })),
    [`GET /candidates/${CANDIDATE_ID}/price-judgement`]: () =>
      judgement
        ? jsonResponse(judgement)
        : errorResponse(404, 'STEP_OUTPUT_NOT_FOUND', '아직 ③ 판정을 실행하지 않았습니다.'),
    [`GET /candidates/${CANDIDATE_ID}/sourcing-comparison`]: () =>
      jsonResponse(
        sourcingComparison({
          candidateId: CANDIDATE_ID,
          comparisonPerformed: compared,
          action: compared ? 'SEARCH_COMPARE' : 'URL_CREATE',
        }),
      ),
    'GET /fx-rates/latest': () => jsonResponse(fxLatest()),
    [`GET /candidates/${CANDIDATE_ID}/naver-shopping-links`]: () => jsonResponse(links),
    [`GET /candidates/${CANDIDATE_ID}/domestic-prices`]: () =>
      jsonResponse(page(domesticSaved ? [domesticPriceEntry()] : [])),
    [`POST /candidates/${CANDIDATE_ID}/domestic-prices`]: () =>
      jsonResponse(
        { ...domesticPriceEntry({ id: 2, pRefKrw: 175000 }), pricingStepStatus: 'RERUN_REQUIRED' },
        201,
      ),
    [`POST /candidates/${CANDIDATE_ID}/steps/PRICING/runs`]: () =>
      jsonResponse({ stepRunId: 300, candidateId: CANDIDATE_ID }, 202),
    [`PUT /candidates/${CANDIDATE_ID}/no-comparison-confirmation`]: () =>
      jsonResponse({
        candidateId: CANDIDATE_ID,
        noComparisonConfirmedAt: '2026-09-28T05:06:00.000Z',
      }),
  });
  return api;
}

async function renderJudgement(options: { demo?: boolean } = {}) {
  const view = renderRoute(`/candidates/${CANDIDATE_ID}/judgement`, options);
  await screen.findByRole('heading', { level: 1, name: '판정 · 소싱 확정 · 카테고리' });
  return view;
}

const requestsTo = (api: ReturnType<typeof stubApi>, method: string, path: string) =>
  api.requests.filter((r) => r.method === method && new URL(r.url).pathname === `/api/v1${path}`);

describe('③ 판정 화면(SCR-04, P2-05)', () => {
  it('PRD 예시: 153,100원 · 167,300원 · 27,418원 · 16.4% · 모드 B 문장 · 요금표 없음이면 배대지 가정값 칩', async () => {
    setup();
    await renderJudgement();
    const summary = within(await screen.findByRole('region', { name: '가격 요약' }));
    expect(await summary.findByText('153,100원')).toBeInTheDocument();
    expect(summary.getByText('최소 판매가 · 마진 10%')).toBeInTheDocument();
    expect(summary.getByText('판매가 · 국내 기준가 −1%')).toBeInTheDocument();
    expect(summary.getByText('167,300원')).toBeInTheDocument();
    expect(summary.getByText('27,418원')).toBeInTheDocument();
    expect(summary.getByText('16.4%')).toBeInTheDocument();
    expect(summary.getByText('8.76원/엔')).toBeInTheDocument();

    const cost = within(screen.getByRole('region', { name: '비용 분해' }));
    expect(cost.getByText('판매 사이즈 5개 공통 · 1켤레')).toBeInTheDocument();
    expect(cost.getByText('105,120원')).toBeInTheDocument();
    expect(cost.getByText('¥12,000 × 8.76')).toBeInTheDocument();
    expect(cost.getByText('2,628원')).toBeInTheDocument();
    expect(cost.getByText('5,019원')).toBeInTheDocument();
    expect(cost.getByText('6,073원')).toBeInTheDocument();
    expect(cost.getByText('3,042원')).toBeInTheDocument();
    expect(cost.getByText('27,418원 · 16.4%')).toBeInTheDocument();
    expect(cost.getByText('포인트 1,090pt는 참고만 · 이익에 넣지 않음')).toBeInTheDocument();
    expect(cost.getByText(/모드 B\(총액 과세\)로 다시 계산한 순이익 16,259원/)).toBeInTheDocument();
    // 배대지 줄(요금표 없음 → 가정값)과 기타비용 줄에 '가정값' 칩
    const forwarder = cost.getByText('배대지').closest('div')!;
    expect(within(forwarder).getByText('가정값')).toBeInTheDocument();
    expect(cost.getAllByText('가정값')).toHaveLength(2);

    const sizes = within(screen.getByRole('region', { name: '사이즈별 판정' }));
    expect(
      sizes.getByText('면세 한도 US$145 · 1켤레 US$77.37(¥22,490까지 면세) · 2켤레면 과세'),
    ).toBeInTheDocument();
    expect(sizes.getAllByText('판매 가능')).toHaveLength(5);
    expect(sizes.getByText('取り寄せ')).toBeInTheDocument();
    expect(sizes.getAllByText('품절')).toHaveLength(2);
    expect(sizes.getByText('없음')).toBeInTheDocument();
  });

  it('요금표가 있으면(가정값 아님) 배대지 줄에 칩이 없다', async () => {
    const api = setup({
      judgement: priceJudgement({
        fwdAssumed: false,
        forwarderRateTableId: 1,
        chargeableWeightKg: 1.2,
      }),
    });
    api.on('GET /forwarder-rate-tables/1', () =>
      jsonResponse({
        id: 1,
        forwarderName: null,
        sourceFileName: 'rate-table-v2026-09.csv',
        sourceFileSha256: 'a'.repeat(64),
        rowCount: 1,
        isActive: true,
        importedAt: '2026-09-28T00:00:00.000Z',
        activatedAt: '2026-09-28T00:00:00.000Z',
        tiers: [],
      }),
    );
    await renderJudgement();
    const cost = within(await screen.findByRole('region', { name: '비용 분해' }));
    expect(await cost.findByText('요금표 v2026-09 · 1.2kg')).toBeInTheDocument();
    expect(cost.getAllByText('가정값')).toHaveLength(1);
  });

  it('네이버쇼핑 링크는 국내 기준가 패널에만 있고 새 탭(target=_blank, rel=noopener noreferrer)으로 연다', async () => {
    setup();
    await renderJudgement();
    const domestic = within(await screen.findByRole('region', { name: '국내 기준가' }));
    const first = await domestic.findByRole('link', { name: /네이버쇼핑에서 찾아보기 \(새 탭\)/ });
    expect(first).toHaveAttribute('target', '_blank');
    expect(first).toHaveAttribute('rel', 'noopener noreferrer');
    expect(first).toHaveAttribute(
      'href',
      'search.shopping.naver.com/search/all?query=%EC%95%84%EC%8B%9D%EC%8A%A4',
    );
    const links = domestic.getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    // 라쿠텐 가격이 보이는 영역(사이즈 표·비용 분해)에는 링크가 없다(CON-14)
    const sizes = screen.getByRole('region', { name: '사이즈별 판정' });
    expect(within(sizes).queryAllByRole('link')).toHaveLength(0);
    const cost = screen.getByRole('region', { name: '비용 분해' });
    expect(within(cost).queryAllByRole('link')).toHaveLength(0);
    expect(
      domestic.getByText(/판정을 마친 뒤 값을 바꾸면 ③을 다시 실행해야 합니다\./),
    ).toBeInTheDocument();
  });

  it("비교한 여정: '비교 없이 확정'이 없고 쿠폰 칸은 비교표 값(잠김)", async () => {
    setup({ compared: true });
    await renderJudgement();
    const confirm = within(await screen.findByRole('region', { name: '소싱 확정' }));
    expect(confirm.queryByRole('checkbox', { name: /비교 없이 확정/ })).not.toBeInTheDocument();
    const coupon = await screen.findByLabelText('쿠폰 · URL 여정만 입력');
    await waitFor(() => expect(coupon).toBeDisabled());
    expect(screen.getByText('비교표 값')).toBeInTheDocument();
  });

  it("URL 여정(비교 안 함): '비교 없이 확정' 체크 → PUT, 쿠폰 칸 값이 '다시 실행'의 ownerInputs.couponYen", async () => {
    const api = setup({
      compared: false,
      judgement: priceJudgement({
        params: { ...priceJudgement().params, sourcing: { comparisonPerformed: false } },
      }),
      links: naverLinks(['MODEL_CODE']),
    });
    await renderJudgement();
    const confirm = within(await screen.findByRole('region', { name: '소싱 확정' }));
    const box = await confirm.findByRole('checkbox', { name: /비교 없이 확정/ });
    expect(confirm.getByText('URL 여정만 체크합니다')).toBeInTheDocument();
    await userEvent.click(box);
    await waitFor(() =>
      expect(
        requestsTo(api, 'PUT', `/candidates/${CANDIDATE_ID}/no-comparison-confirmation`),
      ).toHaveLength(1),
    );

    const coupon = await screen.findByLabelText('쿠폰 · URL 여정만 입력');
    await waitFor(() => expect(coupon).toBeEnabled());
    await userEvent.clear(coupon);
    await userEvent.type(coupon, '1000');
    await userEvent.click(screen.getByRole('button', { name: '다시 실행' }));
    await waitFor(() =>
      expect(
        requestsTo(api, 'POST', `/candidates/${CANDIDATE_ID}/steps/PRICING/runs`),
      ).toHaveLength(1),
    );
    const [run] = requestsTo(api, 'POST', `/candidates/${CANDIDATE_ID}/steps/PRICING/runs`);
    expect(await run!.json()).toEqual({ ownerInputs: { couponYen: 1000 } });
  });

  it('국내 기준가 저장 → POST 본문이 입력과 같고, 저장 뒤 판정을 다시 부른다', async () => {
    const api = setup();
    await renderJudgement();
    const domestic = within(await screen.findByRole('region', { name: '국내 기준가' }));
    const price = await domestic.findByLabelText('국내 기준가 · 판매가 + 고객 배송비');
    await waitFor(() => expect(price).toHaveValue('169,000'));
    const before = requestsTo(api, 'GET', `/candidates/${CANDIDATE_ID}/price-judgement`).length;
    await userEvent.clear(price);
    await userEvent.type(price, '175,000');
    const url = domestic.getByLabelText('근거 링크');
    await userEvent.clear(url);
    await userEvent.type(url, 'search.shopping.naver.com/search/all?query=x');
    await userEvent.click(domestic.getByRole('button', { name: '저장' }));
    await waitFor(() =>
      expect(requestsTo(api, 'POST', `/candidates/${CANDIDATE_ID}/domestic-prices`)).toHaveLength(
        1,
      ),
    );
    const [post] = requestsTo(api, 'POST', `/candidates/${CANDIDATE_ID}/domestic-prices`);
    expect(await post!.json()).toEqual({
      pRefKrw: 175000,
      sourceUrl: 'search.shopping.naver.com/search/all?query=x',
      sourceKind: 'MANUAL',
    });
    await waitFor(() =>
      expect(
        requestsTo(api, 'GET', `/candidates/${CANDIDATE_ID}/price-judgement`).length,
      ).toBeGreaterThan(before),
    );
  });

  it('입력 대기(판정 없음): 안내 띠 · 요약은 비고 · 국내 기준가 칸은 비어 있다', async () => {
    setup({ judgement: null, pricingStatus: 'WAITING_INPUT' });
    await renderJudgement();
    expect(
      await screen.findByText(/국내 기준가를 넣으면 판정을 이어 계산합니다/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('국내 기준가를 넣으면 사이즈별 판정과 비용 분해가 여기에 나옵니다.'),
    ).toBeInTheDocument();
    const price = await screen.findByLabelText('국내 기준가 · 판매가 + 고객 배송비');
    expect(price).toHaveValue('');
    expect(screen.queryByRole('region', { name: '사이즈별 판정' })).not.toBeInTheDocument();
    const confirm = within(screen.getByRole('region', { name: '소싱 확정' }));
    expect(confirm.getByRole('button', { name: '소싱 확정(G2)' })).toBeDisabled();
  });
});

describe('④ 카테고리 구역(SCR-04 #category, P2-06)', () => {
  const categorySection = () => within(screen.getByRole('region', { name: '④ 카테고리' }));

  it("실행 전: 자리 문구와 '실행'(POST …/steps/CATEGORY/runs)", async () => {
    const api = setup();
    api.on(`POST /candidates/${CANDIDATE_ID}/steps/CATEGORY/runs`, () =>
      jsonResponse({ stepRunId: 120, candidateId: CANDIDATE_ID }, 202),
    );
    await renderJudgement();
    const section = categorySection();
    expect(
      await section.findByText('④ 카테고리를 실행하면 리프 카테고리 후보가 여기에 나옵니다.'),
    ).toBeInTheDocument();
    await userEvent.click(await section.findByRole('button', { name: '실행' }));
    await waitFor(() =>
      expect(
        api.requests.filter(
          (r) =>
            r.method === 'POST' &&
            new URL(r.url).pathname === `/api/v1/candidates/${CANDIDATE_ID}/steps/CATEGORY/runs`,
        ),
      ).toHaveLength(1),
    );
  });

  it('입력 대기: 리프 라디오 · 성별 재확인(출처 ② 자동 판단) · 고르면 PUT → 결정·레일을 다시 읽는다', async () => {
    const api = setup({ category: categoryDecision(), categoryStatus: 'WAITING_INPUT' });
    api.on('PUT /category-decisions/21/selection', () => jsonResponse(categorySelectionResult()));
    await renderJudgement();
    const section = categorySection();
    const running = await section.findByRole('radio', {
      name: '패션잡화 > 남성신발 > 운동화 > 러닝화',
    });
    expect(section.getByRole('radiogroup', { name: '성별 재확인' })).toBeInTheDocument();
    expect(section.getByText('출처 ② 자동 판단')).toBeInTheDocument();
    expect(section.getByRole('radio', { name: '남성' })).toBeEnabled();
    const before = api.requests.filter(
      (r) =>
        r.method === 'GET' &&
        new URL(r.url).pathname === `/api/v1/candidates/${CANDIDATE_ID}/category-decision`,
    ).length;
    await userEvent.click(running);
    await userEvent.click(section.getByRole('button', { name: '이 카테고리로 확정' }));
    await waitFor(() =>
      expect(
        api.requests.filter(
          (r) =>
            r.method === 'GET' &&
            new URL(r.url).pathname === `/api/v1/candidates/${CANDIDATE_ID}/category-decision`,
        ).length,
      ).toBeGreaterThan(before),
    );
  });

  it("완료: 성별 재확인은 꺼지고 이유를 보이며 '다음: ⑤ 썸네일' 링크, 여정 성별이 바뀌었으면 경고 띠", async () => {
    setup({
      category: categoryDecision({
        stepStatus: 'COMPLETED',
        leafCategoryId: '50000830',
        wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
        genderPathMatch: true,
        exceptionDecision: 'PASS',
        decidedAt: '2026-09-28T05:07:00.000Z',
      }),
      categoryStatus: 'COMPLETED',
      gender: 'FEMALE',
      genderSource: 'OWNER',
    });
    await renderJudgement();
    const section = categorySection();
    const next = await section.findByRole('link', { name: '다음: ⑤ 썸네일' });
    expect(next).toHaveAttribute('href', `/candidates/${CANDIDATE_ID}/thumbnail`);
    expect(section.getByRole('radio', { name: '남성' })).toBeDisabled();
    expect(
      section.getByText('④가 입력 대기일 때 바꿀 수 있습니다. ④를 다시 실행한 뒤 바꿔 주세요.'),
    ).toBeInTheDocument();
    expect(
      section.getByText(
        '여정 성별이 바뀌어 고른 카테고리와 맞지 않을 수 있습니다. ④를 다시 실행해 카테고리를 다시 골라 주세요.',
      ),
    ).toBeInTheDocument();
  });
});

describe('③·④ 맨 위 안내(D-41): 하는 일 · 지금 할 일 · 낯선 말 풀이 · 지금 여기', () => {
  const MARK = '지금 여기';
  const intro = async () =>
    within(await screen.findByRole('region', { name: '③·④ 판정·카테고리 안내' }));
  const nowText = async () => (await intro()).getByRole('status');
  /** '지금 여기' 이름표가 붙은 칸(이름표의 부모) */
  const markHolders = async () => (await screen.findAllByText(MARK)).map((m) => m.parentElement!);

  it('하는 일 한 문장과 지금 할 일이 보이고, 풀이는 접혀 있다가 펼치면 용어가 나온다', async () => {
    setup();
    await renderJudgement({ demo: true });
    const panel = await intro();
    expect(
      panel.getByText(
        '국내 기준가로 사이즈마다 팔아도 남는지 판정하고, 판매가를 확인해 소싱 확정(G2)을 한 뒤, 스마트스토어에 올릴 카테고리를 고르는 단계입니다.',
      ),
    ).toBeInTheDocument();
    // ③ 완료 · G2 전 → [소싱 확정(G2)]
    expect(await nowText()).toHaveTextContent(
      /^지금 할 일 사이즈별 판정과 판매가를 확인한 뒤 \[소싱 확정\(G2\)\]을 누르세요\./,
    );
    const toggle = panel.getByRole('button', { name: /펼치기/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const term of [
      '실행 · 다시 실행',
      '여기부터 연속 실행',
      '국내 기준가',
      '최소 판매가 · 판매가',
      '순이익 · 마진율',
      '사이즈별 판정(상품 가격·면세)',
      '비용 분해(배대지·관부가세)',
      '소싱 확정(G2)',
      '리프 카테고리',
      '성별 재확인',
      'KC 면제 성인용 확인',
    ]) {
      expect(panel.getByText(term)).toBeVisible();
    }
    // 화면에 없는 말('앵커')은 쓰지 않는다
    expect(panel.queryByText(/앵커/)).toBeNull();
  });

  it('국내 기준가가 없고 ③이 입력을 기다리면 입력하라고 말하고, 표시는 국내 기준가 칸에만 붙는다', async () => {
    setup({ judgement: null, pricingStatus: 'WAITING_INPUT' });
    const view = await renderJudgement({ demo: true });
    expect(await nowText()).toHaveTextContent(/^지금 할 일 ③이 국내 기준가를 기다리는 중입니다\./);
    const holders = await markHolders();
    expect(holders).toHaveLength(1);
    expect(within(holders[0]!).getByRole('region', { name: '국내 기준가' })).toBeInTheDocument();
    expect(within(holders[0]!).queryByRole('region', { name: '소싱 확정' })).toBeNull();
    view.unmount();
  });

  it('③ 실행 전: 저장한 국내 기준가가 없으면 입력부터, 있으면 [실행]에 표시가 붙는다', async () => {
    setup({ judgement: null, pricingStatus: 'NOT_RUN', domesticSaved: false });
    const first = await renderJudgement({ demo: true });
    expect(await nowText()).toHaveTextContent(
      /^지금 할 일 '국내 기준가'에 .*\[저장\]을 누른 뒤 \[실행\]을 누르세요\./,
    );
    const [price] = await markHolders();
    expect(within(price!).getByRole('region', { name: '국내 기준가' })).toBeInTheDocument();
    first.unmount();

    setup({ judgement: null, pricingStatus: 'NOT_RUN', domesticSaved: true });
    await renderJudgement({ demo: true });
    await waitFor(async () =>
      expect(await nowText()).toHaveTextContent(
        /^지금 할 일 \[실행\]을 누르세요\. 저장해 둔 국내 기준가로/,
      ),
    );
    const holders = await markHolders();
    expect(holders).toHaveLength(1);
    // ③ 상태 줄의 [실행] 옆이다(아래 ④ [실행]이 아니다)
    expect(within(holders[0]!).getByRole('button', { name: '실행' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '④ 카테고리' })).queryByText(MARK)).toBeNull();
  });

  it('③ 완료 · G2 전: 표시가 소싱 확정 칸에 붙고, ④에는 없다', async () => {
    setup();
    await renderJudgement({ demo: true });
    const holders = await markHolders();
    expect(holders).toHaveLength(1);
    expect(within(holders[0]!).getByRole('region', { name: '소싱 확정' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '④ 카테고리' })).queryByText(MARK)).toBeNull();
  });

  it("비교하지 않은 URL 여정은 '비교 없이 확정'을 먼저 체크하라고 말한다", async () => {
    setup({
      compared: false,
      judgement: priceJudgement({
        params: { ...priceJudgement().params, sourcing: { comparisonPerformed: false } },
      }),
      links: naverLinks(['MODEL_CODE']),
    });
    await renderJudgement({ demo: true });
    await waitFor(async () =>
      expect(await nowText()).toHaveTextContent(/^지금 할 일 아래 '비교 없이 확정'을 체크하세요\./),
    );
    const holders = await markHolders();
    expect(holders).toHaveLength(1);
    expect(
      within(holders[0]!).getByRole('checkbox', { name: /비교 없이 확정/ }),
    ).toBeInTheDocument();
  });

  it('판매 후보가 아니면 이유를 말하고 표시는 이유 띠에 붙는다', async () => {
    setup({
      judgement: priceJudgement({
        isSaleCandidate: false,
        salePriceKrw: null,
        exclusionReason: '판매 가능한 사이즈가 없습니다',
      }),
    });
    await renderJudgement({ demo: true });
    await waitFor(async () =>
      expect(await nowText()).toHaveTextContent(/^지금 할 일 이 상품은 판매 후보가 아닙니다\./),
    );
    const holders = await markHolders();
    expect(holders).toHaveLength(1);
    expect(
      within(holders[0]!).getByText(/판매 후보 아님 · 판매 가능한 사이즈가 없습니다/),
    ).toBeInTheDocument();
  });

  it('G2 뒤 ④ 실행 전: [실행]을 누르라고 말하고 표시는 ④의 [실행]에 붙는다', async () => {
    setup({ g2Passed: true });
    await renderJudgement({ demo: true });
    await waitFor(async () =>
      expect(await nowText()).toHaveTextContent(
        /^지금 할 일 \[실행\]을 눌러 카테고리 후보를 받으세요\./,
      ),
    );
    const holders = await markHolders();
    expect(holders).toHaveLength(1);
    const category = within(screen.getByRole('region', { name: '④ 카테고리' }));
    expect(category.getByText(MARK)).toBeInTheDocument();
    expect(within(holders[0]!).getByRole('button', { name: '실행' })).toBeInTheDocument();
  });

  it('④ 입력 대기: 리프 카테고리 칸에 표시가 붙고 지금 할 일이 고르는 순서를 말한다', async () => {
    setup({ g2Passed: true, category: categoryDecision(), categoryStatus: 'WAITING_INPUT' });
    await renderJudgement({ demo: true });
    await waitFor(async () =>
      expect(await nowText()).toHaveTextContent(
        /^지금 할 일 여정 성별이 맞는지 '성별 재확인'에서 확인한 뒤, 리프 카테고리를 하나 골라 \[이 카테고리로 확정\]을 누르세요\./,
      ),
    );
    const holders = await markHolders();
    expect(holders).toHaveLength(1);
    expect(
      within(holders[0]!).getByRole('radio', { name: '패션잡화 > 남성신발 > 운동화 > 러닝화' }),
    ).toBeInTheDocument();
    expect(
      within(holders[0]!).getByRole('radiogroup', { name: '성별 재확인' }),
    ).toBeInTheDocument();
  });

  it("③·④를 모두 마치면 끝났다고 알리고 아래 [다음: ⑤ 썸네일]에 '지금 여기'를 붙인다", async () => {
    setup({
      g2Passed: true,
      category: categoryDecision({
        stepStatus: 'COMPLETED',
        leafCategoryId: '50000830',
        wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
        genderPathMatch: true,
        exceptionDecision: 'PASS',
        decidedAt: '2026-09-28T05:07:00.000Z',
      }),
      categoryStatus: 'COMPLETED',
    });
    await renderJudgement({ demo: true });
    await waitFor(async () =>
      expect(await nowText()).toHaveTextContent(/^지금 할 일 ③ 판정과 ④ 카테고리를 마쳤습니다\./),
    );
    // 다음으로 넘어가는 버튼은 아래 카테고리 칸에 있고(맨 위에는 링크를 두지 않는다) '지금 여기'가 거기 붙는다(D-42)
    expect((await intro()).queryByRole('link')).toBeNull();
    const marks = screen.getAllByText(MARK);
    expect(marks).toHaveLength(1);
    expect(
      within(marks[0]!.parentElement!).getByRole('link', { name: /다음: ⑤ 썸네일/ }),
    ).toHaveAttribute('href', `/candidates/${CANDIDATE_ID}/thumbnail`);
  });

  it('등록 진행 중인 여정은 지금 할 일을 말하지 않는다(줄을 감춘다)', async () => {
    setup({ candidatePatch: { locked: true } });
    await renderJudgement({ demo: true });
    expect((await intro()).getByRole('status')).toBeEmptyDOMElement();
    expect(screen.queryByText(MARK)).toBeNull();
  });
});
