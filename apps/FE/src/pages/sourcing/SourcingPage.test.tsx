import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import {
  comparisonRow,
  queryValidation,
  RAKUTEN_ITEM_ID,
  rakutenItemFetchResult,
  rakutenItemSnapshot,
  searchComparison,
  sourcingComparison,
  unverifiedRow,
} from '@/test/fixtures/sourcing';
import { candidateDetail, gateList, stepRail } from '@/test/fixtures/stepEngine';
import { renderRoute } from '@/test/renderRoute';

const CANDIDATE_ID = 1;
const QUERY = 'アシックス ゲルカヤノ14 1201A019';

type Detail = Parameters<typeof candidateDetail>[0];
type Comparison = Partial<Parameters<typeof sourcingComparison>[0]>;

/** 가짜 서버: 키워드 후보 1(② 완료·소싱 선택 있음), 검색어 검사는 'a' 단어가 있으면 WORD_TOO_SHORT */
function setup({
  pageCount = 38,
  detail = {},
  comparison = {},
  sourcingStatus = 'COMPLETED',
}: {
  pageCount?: number;
  detail?: Partial<Detail>;
  comparison?: Comparison | null;
  sourcingStatus?: 'COMPLETED' | 'WAITING_INPUT' | 'NOT_RUN';
} = {}) {
  const api = stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList(pageCount)),
    [`GET /candidates/${CANDIDATE_ID}`]: () =>
      jsonResponse(
        candidateDetail({
          id: CANDIDATE_ID,
          creationPath: 'KEYWORD',
          sourceKeyword: '아식스 젤카야노14',
          rakutenQuery: QUERY,
          itemCode: 'shop-a:10000123',
          resumeStepCode: 'SOURCING',
          ...detail,
        }),
      ),
    [`GET /candidates/${CANDIDATE_ID}/steps`]: () =>
      jsonResponse(stepRail({ SOURCING: { status: sourcingStatus } })),
    [`GET /candidates/${CANDIDATE_ID}/gates`]: () => jsonResponse(gateList()),
    [`GET /candidates/${CANDIDATE_ID}/sourcing-comparison`]: () =>
      comparison === null
        ? errorResponse(404, 'STEP_OUTPUT_NOT_FOUND', '② 소싱 산출물이 아직 없습니다.')
        : jsonResponse(sourcingComparison({ candidateId: CANDIDATE_ID, ...comparison })),
    'POST /rakuten-query-validations': async (req) => {
      const { rakutenQuery } = (await req.json()) as { rakutenQuery: string };
      const q = rakutenQuery.trim();
      const short = q.split(/\s+/).filter((w) => w === 'a');
      return jsonResponse(
        queryValidation(q, {
          halfWidthLength: [...q].length + 10,
          valid: short.length === 0,
          violations: short.map((word) => ({
            rule: 'WORD_TOO_SHORT' as const,
            word,
            message: `'${word}'이(가) 너무 짧습니다.`,
          })),
        }),
      );
    },
    [`POST /candidates/${CANDIDATE_ID}/steps/SOURCING/runs`]: () =>
      jsonResponse({ stepRunId: 200, candidateId: CANDIDATE_ID }, 202),
    [`POST /candidates/${CANDIDATE_ID}/refetch`]: () =>
      jsonResponse({ stepRunId: 201, candidateId: CANDIDATE_ID }, 202),
    [`GET /rakuten-items/${RAKUTEN_ITEM_ID}`]: () => jsonResponse(rakutenItemSnapshot()),
  });
  return api;
}

async function renderSourcing() {
  const view = renderRoute(`/candidates/${CANDIDATE_ID}/sourcing`);
  await screen.findByRole('heading', { level: 1, name: '라쿠텐 후보 비교' });
  return view;
}

const requestsTo = (api: ReturnType<typeof stubApi>, method: string, path: string) =>
  api.requests.filter((r) => r.method === method && new URL(r.url).pathname === `/api/v1${path}`);

describe('② 소싱 화면(SCR-03, P2-02)', () => {
  it('보드 구성: 상태 줄(입력 출처 키워드)·검색 조건(장르 고정 靴 558885·아동화 필터 안내)·비교 칸(SCR-03)·URL 붙여넣기', async () => {
    setup({ comparison: null });
    await renderSourcing();
    expect(screen.getByText('SCR-03')).toBeInTheDocument();
    expect(await screen.findByText("입력 출처: 키워드 '아식스 젤카야노14'")).toBeInTheDocument();
    const search = within(screen.getByRole('region', { name: '검색 조건' }));
    expect(search.getByText('장르 · 고정')).toBeInTheDocument();
    expect(search.getByText('558885')).toBeInTheDocument();
    expect(
      search.getByText(/모든 검색에 장르 靴와 제외어\(中古·キッズ·ジュニア·ベビー 등\)를 붙이고/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('② 소싱을 실행하면 라쿠텐 검색 결과가 여기에 나옵니다.'),
    ).toBeInTheDocument();
    const url = within(screen.getByRole('region', { name: '라쿠텐 URL 붙여넣기' }));
    expect(url.getByText('건당 페이지 1회 조회 · 하루 조회에 포함')).toBeInTheDocument();
    // ② 검색·비교 전에는 '비교표에 넣기'(수동 행, P2-03)를 쓸 수 없다
    expect(url.getByRole('radio', { name: '바로 후보 만들기' })).toBeChecked();
    expect(url.getByRole('radio', { name: '비교표에 넣기' })).toBeDisabled();
    expect(url.getByText('② 소싱 검색·비교를 먼저 실행해 주세요')).toBeInTheDocument();
  });

  it("검색어를 고치면 '반각 n/128자 · 형식 맞음' 또는 위반 문구가 보이고, '다시 실행'은 고친 검색어를 실행 중 입력으로 보낸다", async () => {
    const api = setup();
    await renderSourcing();
    const search = within(screen.getByRole('region', { name: '검색 조건' }));
    const input = await search.findByLabelText('라쿠텐 검색어');
    await waitFor(() => expect(input).toHaveValue(QUERY));
    expect(await search.findByText(/형식 맞음/)).toBeInTheDocument();
    expect(search.getByText(`${[...QUERY].length + 10}/128`)).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, 'アシックス a');
    expect(await search.findByText("'a'이(가) 너무 짧습니다.")).toBeInTheDocument();
    expect(search.getByText(/짧은 단어가 있습니다/)).toBeInTheDocument();
    const rerun = screen.getByRole('button', { name: '다시 실행' });
    expect(rerun).toBeDisabled();
    expect(rerun).toHaveAccessibleDescription('검색어 형식을 먼저 맞춰 주세요.');

    await userEvent.clear(input);
    await userEvent.type(input, 'アシックス ゲルカヤノ');
    await waitFor(() => expect(screen.getByRole('button', { name: '다시 실행' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: '다시 실행' }));
    const runs = requestsTo(api, 'POST', `/candidates/${CANDIDATE_ID}/steps/SOURCING/runs`);
    await waitFor(() => expect(runs.length).toBe(1));
    expect(await runs[0]!.clone().json()).toEqual({
      ownerInputs: { searchKeyword: 'アシックス ゲルカヤノ' },
    });
  });

  it("'바로 후보 만들기': 넣기 → 색상 → 후보 만들기. CANDIDATE_DUPLICATE면 existingCandidateId 후보 화면으로 간다", async () => {
    const api = setup();
    api.on('POST /rakuten-items', () => jsonResponse(rakutenItemFetchResult(), 201));
    api.on('POST /candidates', () =>
      errorResponse(
        409,
        'CANDIDATE_DUPLICATE',
        '같은 상품·색상으로 진행 중인 후보가 있습니다. 그 후보를 열어 주세요.',
        { details: { existingCandidateId: 9 } },
      ),
    );
    const { router } = await renderSourcing();
    const url = within(screen.getByRole('region', { name: '라쿠텐 URL 붙여넣기' }));
    await userEvent.type(
      url.getByLabelText('라쿠텐 URL 붙여넣기'),
      'item.rakuten.co.jp/shop-a/asics-1201a019-108/',
    );
    await userEvent.click(url.getByRole('button', { name: '넣기' }));
    expect(await url.findByText('アシックス ゲルカヤノ14 1201A019-108')).toBeInTheDocument();
    expect(await requestsTo(api, 'POST', '/rakuten-items')[0]!.clone().json()).toEqual({
      sourceUrl: 'item.rakuten.co.jp/shop-a/asics-1201a019-108/',
    });
    const color = await url.findByLabelText('색상');
    await userEvent.selectOptions(color, 'ホワイト(100)');
    await userEvent.click(url.getByRole('button', { name: '이 색상으로 후보 만들기' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/candidates/9/sourcing'));
    expect(await requestsTo(api, 'POST', '/candidates')[0]!.clone().json()).toEqual({
      creationPath: 'RAKUTEN_URL',
      rakutenItemId: RAKUTEN_ITEM_ID,
      selectedColor: 'ホワイト(100)',
    });
  });

  it('제외어 상품은 후보를 만들지 않고 오류 문구를 보인다(입구 검사·422 모두)', async () => {
    const api = setup();
    api.on('POST /rakuten-items', () =>
      jsonResponse(
        rakutenItemFetchResult(
          { excludedWords: ['中古'] },
          { itemName: '【中古】アシックス ゲルカヤノ14' },
        ),
        201,
      ),
    );
    await renderSourcing();
    const url = within(screen.getByRole('region', { name: '라쿠텐 URL 붙여넣기' }));
    await userEvent.type(
      url.getByLabelText('라쿠텐 URL 붙여넣기'),
      'item.rakuten.co.jp/shop-u2/used-kayano14/',
    );
    await userEvent.click(url.getByRole('button', { name: '넣기' }));
    expect(
      await url.findByText('상품명에 제외어(中古)가 있어 쓸 수 없습니다.'),
    ).toBeInTheDocument();
    expect(url.queryByRole('button', { name: '이 색상으로 후보 만들기' })).toBeNull();

    // 입구 검사 뒤 설정이 바뀌어 후보 만들기에서 422가 나도 같은 문구를 보인다
    api.on('POST /rakuten-items', () => jsonResponse(rakutenItemFetchResult(), 201));
    api.on('POST /candidates', () =>
      errorResponse(
        422,
        'RAKUTEN_ITEM_EXCLUDED_WORD',
        '상품명에 제외어(キッズ)가 있어 쓸 수 없습니다.',
      ),
    );
    await userEvent.click(url.getByRole('button', { name: '넣기' }));
    await userEvent.selectOptions(await url.findByLabelText('색상'), 'クリーム×ブラック(108)');
    await userEvent.click(url.getByRole('button', { name: '이 색상으로 후보 만들기' }));
    expect(
      await url.findByText('상품명에 제외어(キッズ)가 있어 쓸 수 없습니다.'),
    ).toBeInTheDocument();
  });

  it('성인용 확인이 필요 없으면(adultConfirmationRequired=false) 체크가 꺼져 있다', async () => {
    setup();
    await renderSourcing();
    const box = await screen.findByRole('checkbox', { name: '성인용 상품 확인' });
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(
      screen.getByText('아동화 의심(최대 235mm 이하)·대상 외 장르로 멈춘 상품만 체크합니다'),
    ).toBeInTheDocument();
  });

  it('아동화 의심으로 멈춘 ②(입력 대기)면 체크를 켜고, 누르면 확인을 기록한다(웹 화면 전용)', async () => {
    const api = setup({
      sourcingStatus: 'WAITING_INPUT',
      comparison: { stepStatus: 'WAITING_INPUT', childSizeSuspect: true },
    });
    api.on('PUT /sourcing-comparisons/31/adult-product-confirmation', () =>
      jsonResponse({
        sourcingComparisonId: 31,
        stepRunId: 100,
        adultProductConfirmedAt: '2026-09-28T05:10:00.000Z',
        stepStatus: 'COMPLETED',
      }),
    );
    await renderSourcing();
    const box = await screen.findByRole('checkbox', { name: '성인용 상품 확인' });
    await waitFor(() => expect(box).toBeEnabled());
    await userEvent.click(box);
    await waitFor(() =>
      expect(
        requestsTo(api, 'PUT', '/sourcing-comparisons/31/adult-product-confirmation'),
      ).toHaveLength(1),
    );
  });

  it("이미 확인했으면 체크된 채 꺼지고 확인 시각을 보인다, URL 후보는 '비교 안 함'", async () => {
    setup({
      detail: { creationPath: 'RAKUTEN_URL', rakutenQuery: null, sourceKeyword: null },
      comparison: { childSizeSuspect: true, adultProductConfirmedAt: '2026-09-28T05:10:00.000Z' },
    });
    await renderSourcing();
    const box = await screen.findByRole('checkbox', { name: '성인용 상품 확인' });
    await waitFor(() => expect(box).toBeChecked());
    expect(box).toBeDisabled();
    expect(screen.getByText('14:10 확인함')).toBeInTheDocument();
    const comparison = within(screen.getByRole('region', { name: /라쿠텐 후보 비교/ }));
    expect(comparison.getByText('비교 안 함')).toBeInTheDocument();
    expect(comparison.getByText('Supported by Rakuten Developers')).toBeInTheDocument();
    expect(screen.getByText('입력 출처: 라쿠텐 URL')).toBeInTheDocument();
  });

  it("오늘 페이지 조회 한도(getCallUsage.limitReached)면 '넣기'·'재조회'가 꺼지고 사유가 보인다", async () => {
    const api = setup({ pageCount: 110 });
    await renderSourcing();
    const reason = '오늘 페이지 조회 한도(110건)를 다 썼습니다. 내일 0시(한국 시간)에 다시 됩니다.';
    const refetch = await screen.findByRole('button', { name: '재조회' });
    await waitFor(() => expect(refetch).toBeDisabled());
    expect(refetch).toHaveAccessibleDescription(reason);
    const url = within(screen.getByRole('region', { name: '라쿠텐 URL 붙여넣기' }));
    await userEvent.type(
      url.getByLabelText('라쿠텐 URL 붙여넣기'),
      'item.rakuten.co.jp/shop-a/asics-1201a019-108/',
    );
    const put = url.getByRole('button', { name: '넣기' });
    expect(put).toBeDisabled();
    expect(put).toHaveAccessibleDescription(reason);
    expect(requestsTo(api, 'POST', '/rakuten-items')).toHaveLength(0);
  });

  it("'재조회'는 POST /candidates/{id}/refetch 한 번(202 — 결과는 SSE로 다시 읽는다)", async () => {
    const api = setup();
    await renderSourcing();
    const refetch = await screen.findByRole('button', { name: '재조회' });
    await waitFor(() => expect(refetch).toBeEnabled());
    await userEvent.click(refetch);
    await waitFor(() =>
      expect(requestsTo(api, 'POST', `/candidates/${CANDIDATE_ID}/refetch`)).toHaveLength(1),
    );
  });
});

// ── P2-03 비교표 ────────────────────────────────────────────────────────────

type ComparisonRowFixture = ReturnType<typeof comparisonRow>;

const SHOP_A = comparisonRow(1, { shopName: '샵 A', itemCode: 'shop-a:10000123' });
const SHOP_B = comparisonRow(2, {
  shopName: '샵 B',
  itemCode: 'shop-b:20000456',
  apiPointRate: 5,
  apiPostageFlag: 1,
  inStockSizeCount: 3,
  representativePriceYen: 11_800,
  shippingYen: 800,
  shippingSource: 'DEFAULT_ESTIMATE',
  pointBaseAmountYen: 10_727,
  pointsBasePt: 107,
  pointsItemPt: 429,
  pointsTotalPt: 536,
  effectivePriceYen: 12_332,
});
const SHOP_C = unverifiedRow(3, {
  shopName: '샵 C',
  itemCode: 'shop-c:30003',
  itemName: '【並行輸入品】アシックス ゲルカヤノ14 1201A019',
  anchorMatch: 'NEEDS_REVIEW',
  colorCode: null,
});

/**
 * 검색·비교 버전(입력 대기)의 비교표. 후보는 아직 소싱 선택·앵커 확정 전(키워드 후보). 행은 서버 순서(검증 → 실질가 순,
 * 미검증 뒤) 그대로 준다
 */
function setupTable({
  rows = [SHOP_A, SHOP_B, SHOP_C],
  comparison = {},
  detail = {},
}: {
  rows?: ComparisonRowFixture[];
  comparison?: Comparison;
  detail?: Partial<Detail>;
} = {}) {
  const api = setup({
    sourcingStatus: 'WAITING_INPUT',
    detail: {
      itemCode: null,
      selectedColor: null,
      anchorFixedAt: null,
      anchorModelCode: null,
      anchorColorCode: null,
      gender: null,
      genderSource: null,
      ...detail,
    },
  });
  api.on(`GET /candidates/${CANDIDATE_ID}/sourcing-comparison`, () =>
    jsonResponse(searchComparison({ candidateId: CANDIDATE_ID, rows, ...comparison })),
  );
  return api;
}

/** 표의 상품 행 이름(샵 이름 — tr aria-label) 순서 */
function shopOrder(): string[] {
  const table = screen.getByRole('table', { name: '라쿠텐 후보 비교' });
  return within(table)
    .getAllByRole('row')
    .map((row) => row.getAttribute('aria-label'))
    .filter((name): name is string => name !== null);
}

describe('② 소싱 비교표(SCR-03, P2-03)', () => {
  it("검증 행은 실질가 순이고 포인트 분해·'근사'가 보인다. 미검증 행은 고를 수 없고 '재고 확인'만 있다", async () => {
    setupTable();
    await renderSourcing();
    await screen.findByRole('table', { name: '라쿠텐 후보 비교' });
    expect(shopOrder()).toEqual(['샵 A', '샵 B', '샵 C']);
    expect(
      screen.getByText(
        '실질가 = SKU가 + 송료 − 쿠폰 − 포인트 × 0.5 · 검증된 샵만 실질가 낮은 순으로 세웁니다 · 포인트는 근사',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '검증 2 · 상품 페이지와 JAN·メーカー型番으로 같은 상품인지 확인 · 실질가 낮은 순',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^미검증 1 · 상품 페이지를 읽지 않아 고를 수 없고/),
    ).toBeInTheDocument();

    const a = within(screen.getByRole('row', { name: '샵 A' }));
    expect(a.getByText('5/9')).toBeInTheDocument();
    expect(a.getByText('¥12,000')).toBeInTheDocument();
    expect(a.getByText('¥11,455')).toBeInTheDocument();
    expect(a.getByText('일치')).toBeInTheDocument();
    expect(a.getByRole('radio', { name: '샵 A 고르기' })).toBeEnabled();
    const b = within(screen.getByRole('row', { name: '샵 B' }));
    expect(b.getByText('3/9')).toBeInTheDocument();
    expect(b.getByText('추정')).toBeInTheDocument();
    expect(b.getByText('¥12,332')).toBeInTheDocument();

    // 펼친 행(첫 검증 행): 포인트 분해 + '근사', 사이즈별 재고
    expect(
      await screen.findByText(
        '포인트 10배 = 기본 1 + 상품 추가 9 + 샵·이벤트 0 → 1,090pt (근사). 실질가에는 포인트의 절반을 반영합니다. 값을 바꾸면 바로 다시 계산합니다.',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: '샵 A 사이즈별 재고' })).toBeInTheDocument();

    const c = within(screen.getByRole('row', { name: '샵 C' }));
    expect(c.getByRole('radio', { name: '샵 C 고르기' })).toBeDisabled();
    expect(c.queryByText('선택')).toBeNull();
    expect(c.getByRole('button', { name: '재고 확인' })).toBeEnabled();
    expect(c.getByText('확인 필요')).toBeInTheDocument();
    expect(c.getByText('색상 코드 없음')).toBeInTheDocument();
    expect(c.getByText('並行輸入品')).toBeInTheDocument();
  });

  it('쿠폰 금액을 넣으면 PATCH를 보내고 응답의 rankedRowIds 순서로 다시 그린다', async () => {
    const api = setupTable();
    const recalculated = {
      ...SHOP_A,
      couponYen: 1_000,
      pointsTotalPt: 1_000,
      effectivePriceYen: 12_500,
    };
    api.on('PATCH /sourcing-comparison-rows/1', () =>
      jsonResponse({ row: recalculated, rankedRowIds: [2, 1] }),
    );
    await renderSourcing();
    const coupon = await screen.findByLabelText('쿠폰 금액');
    await waitFor(() => expect(coupon).toBeEnabled());
    await userEvent.clear(coupon);
    await userEvent.type(coupon, '1000{Enter}');
    const patches = requestsTo(api, 'PATCH', '/sourcing-comparison-rows/1');
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(await patches[0]!.clone().json()).toEqual({ couponYen: 1_000 });
    await waitFor(() => expect(shopOrder()).toEqual(['샵 B', '샵 A', '샵 C']));
    expect(
      within(screen.getByRole('row', { name: '샵 A' })).getByText('¥12,500'),
    ).toBeInTheDocument();
    // 순위가 바뀌어도 고친 행(샵 A)이 펼친 채 남는다
    expect(screen.getByRole('button', { name: '샵 A' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('쿠폰 금액')).toHaveValue('1000');

    // 샵·이벤트 배율도 같은 방식(칸을 떠나면 보낸다)
    api.on('PATCH /sourcing-comparison-rows/1', () =>
      jsonResponse({ row: { ...recalculated, shopEventMultiplier: 1.5 }, rankedRowIds: [2, 1] }),
    );
    const multiplier = screen.getByLabelText('샵·이벤트 배율');
    await userEvent.clear(multiplier);
    await userEvent.type(multiplier, '1.5');
    await userEvent.tab();
    await waitFor(() =>
      expect(requestsTo(api, 'PATCH', '/sourcing-comparison-rows/1')).toHaveLength(2),
    );
    expect(
      await requestsTo(api, 'PATCH', '/sourcing-comparison-rows/1')[1]!.clone().json(),
    ).toEqual({ shopEventMultiplier: 1.5 });
  });

  it("'Supported by Rakuten Developers'가 있고 네이버 링크가 없다. 라쿠텐 링크는 새 창", async () => {
    setupTable();
    const { container } = await renderSourcing();
    const region = within(screen.getByRole('region', { name: /라쿠텐 후보 비교/ }));
    expect(await region.findByText('Supported by Rakuten Developers')).toBeInTheDocument();
    const link = await region.findByRole('link', { name: '샵 A 상품을 라쿠텐에서 보기' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('href', SHOP_A.itemUrl);
    expect(container.querySelector('a[href*="naver.com"]')).toBeNull();
    expect(container.innerHTML).not.toContain('naver.com');
  });

  it("앵커 뒤 앵커 칸은 읽기 전용이고 '이 후보에서는 바꿀 수 없습니다'가 보인다", async () => {
    setupTable();
    await renderSourcing();
    const anchor = await screen.findByLabelText('앵커');
    expect(
      within(anchor).getByText('型番 1201A019 · 색상 코드 108 · クリーム×ブラック(108)'),
    ).toBeInTheDocument();
    expect(
      within(anchor).getByText(
        '이 후보에서는 바꿀 수 없습니다 · 다른 모델·색상은 새 후보로 만듭니다',
      ),
    ).toBeInTheDocument();
    expect(within(anchor).queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: '앵커 정하기' })).toBeNull();
    // 성별은 자동 판단(남성 250~290mm) + '바꾸기'
    expect(screen.getByText('성별 확인 · 자동')).toBeInTheDocument();
    expect(screen.getByText('250~290mm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '바꾸기' })).toBeEnabled();
  });

  it('앵커 전(탐색 모드)은 型番+색상 코드로 앵커를 정한다 — PUT anchor, 고르기는 꺼져 있다', async () => {
    const api = setupTable({
      rows: [
        unverifiedRow(1, { shopName: '샵 A', anchorMatch: null }),
        unverifiedRow(2, { shopName: '샵 B', anchorMatch: null }),
      ],
      comparison: {
        exploreMode: true,
        anchorInputMethod: null,
        anchorItemCode: null,
        anchorModelCode: null,
        anchorModelCodeNorm: null,
        anchorColorCode: null,
        anchorColorLabel: null,
        detectedGender: null,
        genderBasis: null,
      },
    });
    api.on('PUT /sourcing-comparisons/41/anchor', () =>
      jsonResponse(
        {
          candidateId: CANDIDATE_ID,
          sourcingComparisonId: 41,
          stepRunId: 120,
          stepStatus: 'WAITING_INPUT',
          rowId: null,
        },
        202,
      ),
    );
    await renderSourcing();
    const editor = within(await screen.findByLabelText('앵커 정하기'));
    expect(screen.getByText(/^검색 결과 2 · 앵커\(型番·색상\)를 정하면/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '샵 A 고르기' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '재고 확인' })).toBeNull();
    await userEvent.click(editor.getByRole('radio', { name: '型番+색상 코드 입력' }));
    await userEvent.type(editor.getByLabelText('型番'), '1201a019');
    await userEvent.type(editor.getByLabelText('색상 코드(선택)'), '108');
    await userEvent.click(editor.getByRole('button', { name: '앵커 정하기' }));
    const puts = requestsTo(api, 'PUT', '/sourcing-comparisons/41/anchor');
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(await puts[0]!.clone().json()).toEqual({
      anchorInputMethod: 'CODE_ENTRY',
      anchorModelCode: '1201a019',
      anchorColorCode: '108',
    });
  });

  it('성별을 판단하지 못해 ②가 기다리면 성별 고르기가 보이고, 고르면 PUT /candidates/{id}/gender', async () => {
    const api = setupTable({ comparison: { detectedGender: null, genderBasis: null } });
    api.on(`PUT /candidates/${CANDIDATE_ID}/gender`, () =>
      jsonResponse({
        candidateId: CANDIDATE_ID,
        gender: 'FEMALE',
        genderSource: 'OWNER',
        genderRecheckRequired: false,
        affectedSteps: [],
        resumedStepRunIds: [120],
      }),
    );
    await renderSourcing();
    const group = await screen.findByRole('radiogroup', { name: '후보 성별' });
    expect(
      screen.getByText(
        '성별을 판단하지 못했습니다. 골라 주면 목표 사이즈 범위로 재고를 다시 봅니다.',
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(group).getByRole('radio', { name: '여성 220~260mm' })).toBeEnabled(),
    );
    await userEvent.click(within(group).getByRole('radio', { name: '여성 220~260mm' }));
    const puts = requestsTo(api, 'PUT', `/candidates/${CANDIDATE_ID}/gender`);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(await puts[0]!.clone().json()).toEqual({ gender: 'FEMALE' });
  });

  it("미검증 행 '재고 확인'은 POST stock-checks, 검증 행을 고르면 PUT selection(다른 샵이면 G2 안내)", async () => {
    const api = setupTable();
    api.on('POST /sourcing-comparison-rows/3/stock-checks', () =>
      jsonResponse(
        {
          candidateId: CANDIDATE_ID,
          sourcingComparisonId: 41,
          stepRunId: 120,
          stepStatus: 'WAITING_INPUT',
          rowId: 3,
        },
        202,
      ),
    );
    api.on('PUT /sourcing-comparisons/41/selection', () =>
      jsonResponse({
        candidateId: CANDIDATE_ID,
        sourcingComparisonId: 41,
        stepRunId: 120,
        stepStatus: 'COMPLETED',
        selectedRowId: 2,
        itemCode: 'shop-b:20000456',
        selectedColor: 'クリーム×ブラック(108)',
        g2Invalidated: true,
        staleDownstreamSteps: ['PRICING'],
      }),
    );
    await renderSourcing();
    const c = within(await screen.findByRole('row', { name: '샵 C' }));
    await userEvent.click(c.getByRole('button', { name: '재고 확인' }));
    await waitFor(() =>
      expect(requestsTo(api, 'POST', '/sourcing-comparison-rows/3/stock-checks')).toHaveLength(1),
    );
    await userEvent.click(screen.getByRole('radio', { name: '샵 B 고르기' }));
    const puts = requestsTo(api, 'PUT', '/sourcing-comparisons/41/selection');
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(await puts[0]!.clone().json()).toEqual({ rowId: 2 });
    expect(
      await screen.findByText('다른 샵으로 바꿔 판정(G2)을 다시 통과해야 합니다.'),
    ).toBeInTheDocument();
  });

  it("URL 상품 '비교표에 넣기'(기본 선택) → POST /sourcing-comparisons/{id}/rows", async () => {
    const api = setupTable();
    api.on('POST /rakuten-items', () => jsonResponse(rakutenItemFetchResult(), 201));
    api.on('POST /sourcing-comparisons/41/rows', () =>
      jsonResponse(comparisonRow(9, { rowSource: 'MANUAL', searchRank: null }), 201),
    );
    await renderSourcing();
    const url = within(screen.getByRole('region', { name: '라쿠텐 URL 붙여넣기' }));
    await waitFor(() => expect(url.getByRole('radio', { name: '비교표에 넣기' })).toBeChecked());
    await userEvent.type(
      url.getByLabelText('라쿠텐 URL 붙여넣기'),
      'item.rakuten.co.jp/shop-a/asics-1201a019-108/',
    );
    await userEvent.click(url.getByRole('button', { name: '넣기' }));
    await userEvent.click(await url.findByRole('button', { name: '비교표에 넣기' }));
    const posts = requestsTo(api, 'POST', '/sourcing-comparisons/41/rows');
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(await posts[0]!.clone().json()).toEqual({ rakutenItemId: RAKUTEN_ITEM_ID });
    expect(await url.findByText("비교표에 '수동' 행으로 넣었습니다.")).toBeInTheDocument();
  });
  it("펼친 행 '상품' 줄: 상품명·리뷰 수·평점·해외 배송 가능(F-SO-28 — 보드 9열에 없는 값), 샵 이름 title은 상품명", async () => {
    const shopB = {
      ...SHOP_B,
      itemName: 'アシックス ゲルカヤノ14 1201A019-108 送料無料',
      reviewCount: null,
      reviewAverage: null,
      shipOverseas: true,
    };
    setupTable({ rows: [SHOP_A, shopB, SHOP_C] });
    await renderSourcing();
    const a = within(await screen.findByRole('group', { name: '샵 A 상품 정보' }));
    expect(a.getByText(SHOP_A.itemName)).toBeInTheDocument();
    expect(a.getByText('리뷰 12건 · 평점 4.50 · 해외 배송 안 함')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '샵 A' })).toHaveAttribute('title', SHOP_A.itemName);

    await userEvent.click(screen.getByRole('button', { name: '샵 B' }));
    const b = within(await screen.findByRole('group', { name: '샵 B 상품 정보' }));
    expect(b.getByText(shopB.itemName)).toBeInTheDocument();
    expect(b.getByText('리뷰 정보 없음 · 해외 배송 가능')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '샵 A 상품 정보' })).toBeNull();
  });

  it("불확실한 행 '같은 상품인가': 앵커와 이 상품(상품명·型番·색상 코드·JAN)을 나란히, '같은 상품'·'다른 상품'은 PATCH ownerMatchDecision", async () => {
    const shopC = {
      ...SHOP_C,
      aiMatch: { match: true, confidence: 0.8, reason: '型番と色名が同じです' },
    };
    const api = setupTable({
      rows: [SHOP_A, SHOP_B, shopC],
      comparison: { anchorItemCode: SHOP_A.itemCode },
    });
    api.on('PATCH /sourcing-comparison-rows/3', async (req) => {
      const body = (await req.clone().json()) as { ownerMatchDecision: 'MATCH' | 'NO_MATCH' };
      return jsonResponse({
        row: { ...shopC, ownerMatchDecision: body.ownerMatchDecision },
        rankedRowIds: [1, 2],
      });
    });
    await renderSourcing();
    await userEvent.click(await screen.findByRole('button', { name: '샵 C' }));
    const decision = within(await screen.findByRole('group', { name: '같은 상품 판단' }));
    // 앵커 = 검색에서 고른 샵 A 상품(이름 + 型番·색상), 이 상품 = 샵 C(이름 + 型番·색상 코드 없음·JAN 확인 전)
    expect(decision.getByText(SHOP_A.itemName)).toBeInTheDocument();
    expect(
      decision.getByText('型番 1201A019 · 색상 코드 108 · クリーム×ブラック(108)'),
    ).toBeInTheDocument();
    expect(decision.getByText(SHOP_C.itemName)).toBeInTheDocument();
    expect(decision.getByText('型番 1201A019 · 색상 코드 없음 · JAN 확인 전')).toBeInTheDocument();
    expect(
      decision.getByText('AI 판정 참고 · 같은 상품(확신도 80%) — 型番と色名が同じです'),
    ).toBeInTheDocument();

    await userEvent.click(decision.getByRole('button', { name: '같은 상품' }));
    const patches = requestsTo(api, 'PATCH', '/sourcing-comparison-rows/3');
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(await patches[0]!.clone().json()).toEqual({ ownerMatchDecision: 'MATCH' });
    const c = within(screen.getByRole('row', { name: '샵 C' }));
    expect(await c.findByText('오너 판단')).toBeInTheDocument();
    expect(c.getByText('같은 상품')).toBeInTheDocument();
    await waitFor(() =>
      expect(decision.getByRole('button', { name: '같은 상품' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );

    await userEvent.click(decision.getByRole('button', { name: '다른 상품' }));
    await waitFor(() =>
      expect(requestsTo(api, 'PATCH', '/sourcing-comparison-rows/3')).toHaveLength(2),
    );
    expect(
      await requestsTo(api, 'PATCH', '/sourcing-comparison-rows/3')[1]!.clone().json(),
    ).toEqual({ ownerMatchDecision: 'NO_MATCH' });
    expect(await c.findByText('다른 상품')).toBeInTheDocument();
  });

  it('펼친 사이즈 칸(스냅샷으로 다시 그림)의 있음 수가 서버 판정과 다르면 안내한다 — 같으면 안내 없음', async () => {
    // 스냅샷 fixture: 색상 108의 250·260만 재고 → 화면 칸 2개, 서버 판정 5개
    setupTable();
    await renderSourcing();
    expect(await screen.findByRole('list', { name: '샵 A 사이즈별 재고' })).toBeInTheDocument();
    expect(
      screen.getByText(
        '사이즈 칸(재고 2개)이 서버 판정(재고 5개)과 다릅니다. 고르기·순위는 서버 판정을 따릅니다.',
      ),
    ).toBeInTheDocument();
  });

  it('사이즈 칸의 있음 수가 서버 판정과 같으면 안내가 없다', async () => {
    setupTable({ rows: [{ ...SHOP_A, inStockSizeCount: 2 }, SHOP_B, SHOP_C] });
    await renderSourcing();
    expect(await screen.findByRole('list', { name: '샵 A 사이즈별 재고' })).toBeInTheDocument();
    expect(screen.queryByText(/서버 판정\(재고/)).toBeNull();
  });
});
