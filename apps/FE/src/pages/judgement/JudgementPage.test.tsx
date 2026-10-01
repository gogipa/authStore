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

/** 가짜 서버: 후보 1(② 완료, ③ 완료 — PRD §8.3 예시 판정) */
function setup({
  judgement = priceJudgement(),
  compared = true,
  pricingStatus = 'COMPLETED',
  links = naverLinks(),
  category = null,
  categoryStatus = 'NOT_RUN',
  gender = 'MALE',
  genderSource = 'STEP2',
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
    [`GET /candidates/${CANDIDATE_ID}/gates`]: () => jsonResponse(gateList()),
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
      jsonResponse(page(judgement ? [domesticPriceEntry()] : [])),
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

async function renderJudgement() {
  const view = renderRoute(`/candidates/${CANDIDATE_ID}/judgement`);
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
    expect(summary.getByText('판매가 · 국내가 −1%')).toBeInTheDocument();
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

  it("비교한 후보: '비교 없이 확정'이 없고 쿠폰 칸은 비교표 값(잠김)", async () => {
    setup({ compared: true });
    await renderJudgement();
    const confirm = within(await screen.findByRole('region', { name: '소싱 확정' }));
    expect(confirm.queryByRole('checkbox', { name: /비교 없이 확정/ })).not.toBeInTheDocument();
    const coupon = await screen.findByLabelText('쿠폰 · URL 후보만 입력');
    await waitFor(() => expect(coupon).toBeDisabled());
    expect(screen.getByText('비교표 값')).toBeInTheDocument();
  });

  it("URL 후보(비교 안 함): '비교 없이 확정' 체크 → PUT, 쿠폰 칸 값이 '다시 실행'의 ownerInputs.couponYen", async () => {
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
    expect(confirm.getByText('URL 후보만 체크합니다')).toBeInTheDocument();
    await userEvent.click(box);
    await waitFor(() =>
      expect(
        requestsTo(api, 'PUT', `/candidates/${CANDIDATE_ID}/no-comparison-confirmation`),
      ).toHaveLength(1),
    );

    const coupon = await screen.findByLabelText('쿠폰 · URL 후보만 입력');
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

  it("완료: 성별 재확인은 꺼지고 이유를 보이며 '다음: ⑤ 썸네일' 링크, 후보 성별이 바뀌었으면 경고 띠", async () => {
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
        '후보 성별이 바뀌어 고른 카테고리와 맞지 않을 수 있습니다. ④를 다시 실행해 카테고리를 다시 골라 주세요.',
      ),
    ).toBeInTheDocument();
  });
});
