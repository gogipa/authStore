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
import { candidateDetail, disabled, gateList, stepRail } from '@/test/fixtures/stepEngine';
import { renderRoute } from '@/test/renderRoute';

const CANDIDATE_ID = 1;
const QUERY = 'アシックス ゲルカヤノ14 1201A019';

type Detail = Parameters<typeof candidateDetail>[0];
type Comparison = Partial<Parameters<typeof sourcingComparison>[0]>;

/** 가짜 서버: 키워드 여정 1(② 완료·소싱 선택 있음), 검색어 검사는 'a' 단어가 있으면 WORD_TOO_SHORT */
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

async function renderSourcing(options: { demo?: boolean } = {}) {
  const view = renderRoute(`/candidates/${CANDIDATE_ID}/sourcing`, options);
  // 기준 상품을 정하기 전엔 '상품 고르기', 그 밖(검색 전·정한 뒤)엔 '같은 상품을 파는 샵 비교'(D-47)
  await screen.findByRole('heading', {
    level: 1,
    name: /^(상품 고르기|같은 상품을 파는 샵 비교)$/,
  });
  return view;
}

const requestsTo = (api: ReturnType<typeof stubApi>, method: string, path: string) =>
  api.requests.filter((r) => r.method === method && new URL(r.url).pathname === `/api/v1${path}`);

describe('② 소싱 화면(SCR-03, P2-02)', () => {
  it('보드 구성: 상태 줄(입력 출처 키워드)·검색 조건(검색 분류 고정 신발(靴) 558885·아동화 필터 안내)·비교 칸(화면 ID 칩 없음, D-27)·URL 붙여넣기', async () => {
    setup({ comparison: null });
    await renderSourcing();
    expect(screen.queryByText('SCR-03')).not.toBeInTheDocument();
    expect(await screen.findByText("입력 출처: 키워드 '아식스 젤카야노14'")).toBeInTheDocument();
    const search = within(screen.getByRole('region', { name: '검색 조건' }));
    expect(search.getByText('검색 분류 · 고정')).toBeInTheDocument();
    expect(search.getByText('558885')).toBeInTheDocument();
    expect(
      search.getByText(
        /신발\(靴\)만 검색하고, 중고\(中古\)·아동용\(キッズ·ジュニア·ベビー\) 상품은 빼고 찾습니다/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('② 소싱을 실행하면 라쿠텐 검색 결과가 여기에 나옵니다.'),
    ).toBeInTheDocument();
    const url = within(screen.getByRole('region', { name: '라쿠텐 URL 붙여넣기' }));
    expect(url.getByText('건당 페이지 1회 조회 · 하루 조회에 포함')).toBeInTheDocument();
    // ② 검색·비교 전에는 '비교표에 넣기'(수동 행, P2-03)를 쓸 수 없다
    expect(url.getByRole('radio', { name: '바로 여정 만들기' })).toBeChecked();
    expect(url.getByRole('radio', { name: '비교표에 넣기' })).toBeDisabled();
    expect(url.getByText('② 소싱 검색·비교를 먼저 실행해 주세요')).toBeInTheDocument();
  });

  it("검색어를 고치면 '길이 n/128 · 사용 가능' 또는 위반 문구가 보이고, '다시 실행'은 고친 검색어를 실행 중 입력으로 보낸다", async () => {
    const api = setup();
    await renderSourcing();
    const search = within(screen.getByRole('region', { name: '검색 조건' }));
    const input = await search.findByLabelText('라쿠텐 검색어');
    await waitFor(() => expect(input).toHaveValue(QUERY));
    expect(await search.findByText(/사용 가능/)).toBeInTheDocument();
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

  it('키워드에서 만든 여정은 한국어 원문과 지금 일본어 검색어를 함께 보인다. 따로 [일본어로 바꾸기] 버튼은 없다', async () => {
    setup({
      comparison: null,
      detail: { sourceKeyword: '뉴발란스 530', rakutenQuery: 'ニューバランス 530' },
    });
    await renderSourcing();
    const search = within(screen.getByRole('region', { name: '검색 조건' }));
    await waitFor(() =>
      expect(search.getByLabelText('라쿠텐 검색어')).toHaveValue('ニューバランス 530'),
    );
    expect(search.getByText('한국어 원문')).toBeInTheDocument();
    expect(search.getByText('뉴발란스 530')).toBeInTheDocument();
    expect(
      search.getByText('→ 위 일본어 검색어로 검색합니다 · 칸에서 고칠 수 있습니다'),
    ).toBeInTheDocument();
    expect(search.queryByRole('button', { name: '일본어로 바꾸기' })).toBeNull();
  });

  it('검색어가 아직 한글 원문 그대로면 원문 줄 대신 한글 안내가 보이고, 출처 키워드가 없는 여정에는 원문 줄이 없다', async () => {
    setup({
      comparison: null,
      detail: { sourceKeyword: '뉴발란스 530', rakutenQuery: '뉴발란스 530' },
    });
    const first = await renderSourcing();
    const search = within(screen.getByRole('region', { name: '검색 조건' }));
    await waitFor(() => expect(search.getByLabelText('라쿠텐 검색어')).toHaveValue('뉴발란스 530'));
    expect(search.getByText(/^한글이 들어 있습니다\./)).toBeInTheDocument();
    expect(search.queryByText('한국어 원문')).toBeNull();
    first.unmount();

    setup({
      comparison: null,
      detail: { creationPath: 'SEARCH_QUERY', sourceKeywordId: null, sourceKeyword: null },
    });
    await renderSourcing();
    const other = within(screen.getByRole('region', { name: '검색 조건' }));
    await waitFor(() => expect(other.getByLabelText('라쿠텐 검색어')).toHaveValue(QUERY));
    expect(other.queryByText('한국어 원문')).toBeNull();
  });

  it("'바로 여정 만들기': 넣기 → 색상 → 여정 만들기. CANDIDATE_DUPLICATE면 existingCandidateId 여정 화면으로 간다", async () => {
    const api = setup();
    api.on('POST /rakuten-items', () => jsonResponse(rakutenItemFetchResult(), 201));
    api.on('POST /candidates', () =>
      errorResponse(
        409,
        'CANDIDATE_DUPLICATE',
        '같은 상품·색상으로 진행 중인 여정이 있습니다. 그 여정을 열어 주세요.',
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
    await userEvent.click(url.getByRole('button', { name: '이 색상으로 여정 만들기' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/candidates/9/sourcing'));
    expect(await requestsTo(api, 'POST', '/candidates')[0]!.clone().json()).toEqual({
      creationPath: 'RAKUTEN_URL',
      rakutenItemId: RAKUTEN_ITEM_ID,
      selectedColor: 'ホワイト(100)',
    });
  });

  it('제외어 상품은 여정을 만들지 않고 오류 문구를 보인다(입구 검사·422 모두)', async () => {
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
    expect(url.queryByRole('button', { name: '이 색상으로 여정 만들기' })).toBeNull();

    // 입구 검사 뒤 설정이 바뀌어 여정 만들기에서 422가 나도 같은 문구를 보인다
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
    await userEvent.click(url.getByRole('button', { name: '이 색상으로 여정 만들기' }));
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

  it("이미 확인했으면 체크된 채 꺼지고 확인 시각을 보인다, URL 여정은 '비교 안 함'", async () => {
    setup({
      detail: { creationPath: 'RAKUTEN_URL', rakutenQuery: null, sourceKeyword: null },
      comparison: { childSizeSuspect: true, adultProductConfirmedAt: '2026-09-28T05:10:00.000Z' },
    });
    await renderSourcing();
    const box = await screen.findByRole('checkbox', { name: '성인용 상품 확인' });
    await waitFor(() => expect(box).toBeChecked());
    expect(box).toBeDisabled();
    expect(screen.getByText('14:10 확인함')).toBeInTheDocument();
    const comparison = within(screen.getByRole('region', { name: /같은 상품을 파는 샵 비교/ }));
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
/** 재고를 아직 읽지 않았고 같은 상품인지 가리지 못한 행(확인 필요) — 표에서 기본으로 접힌다(D-47) */
const SHOP_C = unverifiedRow(3, {
  shopName: '샵 C',
  itemCode: 'shop-c:30003',
  itemName: '【並行輸入品】アシックス ゲルカヤノ14 1201A019',
  anchorMatch: 'NEEDS_REVIEW',
  colorCode: null,
});
/** 재고를 아직 읽지 않았지만 규칙이 같은 상품이라고 한 행 — 접지 않고 '아직 확인 안 함'에 있다 */
const SHOP_UNCHECKED = unverifiedRow(4, {
  shopName: '샵 D',
  itemCode: 'shop-d:40004',
  itemName: '【並行輸入品】アシックス ゲルカヤノ14 1201A019-108',
});

/**
 * 검색·비교 버전(입력 대기)의 비교표. 여정은 아직 소싱 선택·앵커 확정 전(키워드 여정). 행은 서버 순서(검증 → 실질가 순,
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

/** 접어 둔 '같은 상품인지 확실하지 않은 N개' 묶음을 펼친다(D-47) */
async function openFold() {
  const head = await screen.findByText(/^같은 상품인지 확실하지 않은 \d+개$/);
  await userEvent.click(within(head.closest('td')!).getByRole('button', { name: /펼치기/ }));
}

/** 표의 상품 행 이름(샵 이름 — tr aria-label) 순서 */
function shopOrder(): string[] {
  const table = screen.getByRole('table', { name: '같은 상품을 파는 샵 비교' });
  return within(table)
    .getAllByRole('row')
    .map((row) => row.getAttribute('aria-label'))
    .filter((name): name is string => name !== null);
}

describe('② 소싱 비교표(SCR-03, P2-03)', () => {
  it("재고 확인한 행은 실질가 순이고 포인트 분해·'근사'가 보인다. 아직 확인 안 한 행은 고를 수 없고 '재고 확인'만 있다", async () => {
    setupTable({ rows: [SHOP_A, SHOP_B, SHOP_UNCHECKED] });
    await renderSourcing();
    await screen.findByRole('table', { name: '같은 상품을 파는 샵 비교' });
    expect(shopOrder()).toEqual(['샵 A', '샵 B', '샵 D']);
    expect(
      screen.getByText(
        '실질가 = 상품 가격 + 일본 내 배송비 − 쿠폰 − 포인트 × 0.5 · 상품 페이지를 읽어 재고를 확인한 샵만 실질가 낮은 순으로 순위를 매깁니다 · 포인트는 대략의 값',
      ),
    ).toBeInTheDocument();
    // D-47: '검증 N · 미검증 N'이라는 말 대신 '재고 확인 N · 아직 확인 안 함 N'
    expect(
      screen.getByText(
        '재고 확인 2 · 상품 페이지와 JAN·メーカー型番으로 같은 상품인지 확인 · 실질가 낮은 순',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^아직 확인 안 함 1 · 상품 페이지를 읽지 않아 고를 수 없고/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/검증/)).toBeNull();
    expect(screen.getByRole('checkbox', { name: '다른 상품도 보기' })).not.toBeChecked();

    const a = within(screen.getByRole('row', { name: '샵 A' }));
    expect(a.getByText('5/9')).toBeInTheDocument();
    expect(a.getByText('¥12,000')).toBeInTheDocument();
    expect(a.getByText('¥11,455')).toBeInTheDocument();
    expect(a.getByText('같은 상품')).toBeInTheDocument();
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

    const d = within(screen.getByRole('row', { name: '샵 D' }));
    expect(d.getByRole('radio', { name: '샵 D 고르기' })).toBeDisabled();
    expect(d.queryByText('선택')).toBeNull();
    expect(d.getByRole('button', { name: '재고 확인' })).toBeEnabled();
    expect(d.getByText('같은 상품')).toBeInTheDocument();
    expect(d.getByText('並行輸入品')).toBeInTheDocument();
  });

  it("표 머리 '같은 상품인가'와 칸 값 같은 상품·확인 필요·다른 상품, '다른 상품도 보기'가 일치·불일치를 대신한다(D-47)", async () => {
    const janDiff = comparisonRow(4, { shopName: '샵 E', janMatch: false });
    const other = unverifiedRow(5, { shopName: '샵 F', anchorMatch: 'NO_MATCH', colorCode: '100' });
    const api = setupTable({ rows: [SHOP_A, janDiff] });
    await renderSourcing();
    const table = within(await screen.findByRole('table', { name: '같은 상품을 파는 샵 비교' }));
    expect(table.getByRole('columnheader', { name: '같은 상품인가' })).toBeInTheDocument();
    expect(table.queryByRole('columnheader', { name: /기준 상품과 일치/ })).toBeNull();
    expect(within(screen.getByRole('row', { name: '샵 A' })).getByText('같은 상품')).toBeVisible();
    // JAN이 달라 '확인 필요'가 된 행은 재고를 확인한 행이라 접지 않는다
    const e = within(screen.getByRole('row', { name: '샵 E' }));
    expect(e.getByText('확인 필요')).toBeInTheDocument();
    expect(e.getByText('JAN 다름')).toBeInTheDocument();
    expect(screen.queryByText(/^같은 상품인지 확실하지 않은 \d+개$/)).toBeNull();
    // '다른 상품도 보기'를 켜면 다른 상품(rule NO_MATCH)이 '다른 상품'으로 보인다
    api.on(`GET /candidates/${CANDIDATE_ID}/sourcing-comparison`, () =>
      jsonResponse(searchComparison({ candidateId: CANDIDATE_ID, rows: [SHOP_A, janDiff, other] })),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: '다른 상품도 보기' }));
    const f = within(await screen.findByRole('row', { name: '샵 F' }));
    expect(f.getByText('다른 상품')).toBeInTheDocument();
  });

  it('재고를 확인했는데 목표 사이즈 재고가 모자란 행은 [재고 부족]과 개수·기준을 보이고 고를 수 없다', async () => {
    const short = comparisonRow(8, {
      shopName: '샵 H',
      itemCode: 'shop-h:80008',
      inStockSizeCount: 0,
      stockPass: false,
    });
    setupTable({ rows: [SHOP_A, short] });
    await renderSourcing();
    const d = within(await screen.findByRole('row', { name: '샵 H' }));
    expect(d.getByText('재고 부족')).toBeInTheDocument();
    expect(d.getByText('재고 있는 사이즈 0개 · 3개 이상 필요')).toBeInTheDocument();
    expect(d.getByRole('radio', { name: '샵 H 고르기' })).toBeDisabled();
    // 재고가 충분한 행에는 없다
    expect(
      within(screen.getByRole('row', { name: '샵 A' })).queryByText('재고 부족'),
    ).not.toBeInTheDocument();
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
    await waitFor(() => expect(shopOrder()).toEqual(['샵 B', '샵 A']));
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
    const region = within(screen.getByRole('region', { name: /같은 상품을 파는 샵 비교/ }));
    expect(await region.findByText('Supported by Rakuten Developers')).toBeInTheDocument();
    const link = await region.findByRole('link', { name: '샵 A 상품을 라쿠텐에서 보기' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('href', SHOP_A.itemUrl);
    expect(container.querySelector('a[href*="naver.com"]')).toBeNull();
    expect(container.innerHTML).not.toContain('naver.com');
  });

  it("기준 상품을 정한 뒤 그 칸은 읽기 전용이고 '이 여정에서는 바꿀 수 없습니다'와 기준 상품의 뜻이 보인다", async () => {
    setupTable();
    await renderSourcing();
    const anchor = await screen.findByLabelText('기준 상품');
    expect(
      within(anchor).getByText(
        '팔고 싶은 상품 한 개 — 이 상품과 같은 모델·색상을 파는 샵을 아래에서 비교합니다',
      ),
    ).toBeInTheDocument();
    expect(
      within(anchor).getByText('모델 번호 1201A019 · 색상 번호 108 · クリーム×ブラック(108)'),
    ).toBeInTheDocument();
    expect(
      within(anchor).getByText(
        '이 여정에서는 바꿀 수 없습니다 · 다른 모델·색상은 새 여정으로 만듭니다',
      ),
    ).toBeInTheDocument();
    expect(within(anchor).queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: '이 상품으로 정하기' })).toBeNull();
    expect(screen.queryByRole('list', { name: '라쿠텐 검색 결과' })).toBeNull();
    // 성별은 자동 판단(남성 250~290mm) + '바꾸기'
    expect(screen.getByText('성별 확인 · 자동')).toBeInTheDocument();
    expect(screen.getByText('250~290mm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '바꾸기' })).toBeEnabled();
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
    const group = await screen.findByRole('radiogroup', { name: '여정 성별' });
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

  it("아직 확인 안 한 행 '재고 확인'은 POST stock-checks, 재고 확인한 행을 고르면 PUT selection(다른 샵이면 G2 안내)", async () => {
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
    // 샵 C는 같은 상품인지 확실하지 않아 접혀 있다 — 펼치면 같은 표 행으로 보인다(D-47)
    await openFold();
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
      await screen.findByText('다른 샵으로 바꿔 ③에서 소싱 확정(G2)을 다시 눌러야 합니다.'),
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

  it("불확실한 행 '같은 상품인가': 앵커와 이 상품(상품명·型番·색상 번호·JAN)을 나란히, '같은 상품'·'다른 상품'은 PATCH ownerMatchDecision", async () => {
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
    await openFold();
    await userEvent.click(await screen.findByRole('button', { name: '샵 C' }));
    const decision = within(await screen.findByRole('group', { name: '같은 상품 판단' }));
    expect(decision.getByText('같은 상품인가')).toBeInTheDocument();
    // 앵커 = 검색에서 고른 샵 A 상품(이름 + 型番·색상), 이 상품 = 샵 C(이름 + 型番·색상 번호 없음·JAN 확인 전)
    expect(decision.getByText(SHOP_A.itemName)).toBeInTheDocument();
    expect(
      decision.getByText('모델 번호 1201A019 · 색상 번호 108 · クリーム×ブラック(108)'),
    ).toBeInTheDocument();
    expect(decision.getByText(SHOP_C.itemName)).toBeInTheDocument();
    expect(
      decision.getByText('모델 번호 1201A019 · 색상 번호 없음 · JAN 확인 전'),
    ).toBeInTheDocument();
    expect(
      decision.getByText('AI 판정 참고 · 같은 상품(확신도 80%) — 型番と色名が同じです'),
    ).toBeInTheDocument();

    await userEvent.click(decision.getByRole('button', { name: '같은 상품' }));
    const patches = requestsTo(api, 'PATCH', '/sourcing-comparison-rows/3');
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(await patches[0]!.clone().json()).toEqual({ ownerMatchDecision: 'MATCH' });
    // 내가 정한 행은 접힌 묶음에서 나와 표에 그대로 보인다
    const c = within(screen.getByRole('row', { name: '샵 C' }));
    expect(await c.findByText('내가 정함')).toBeInTheDocument();
    expect(c.getByText('같은 상품')).toBeInTheDocument();
    expect(screen.queryByText(/^같은 상품인지 확실하지 않은 \d+개$/)).toBeNull();
    // 행이 접힌 묶음에서 나와 표 안 다른 자리로 옮겨 가므로 판단 칸을 다시 찾는다
    const moved = () => within(screen.getByRole('group', { name: '같은 상품 판단' }));
    await waitFor(() =>
      expect(moved().getByRole('button', { name: '같은 상품' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );

    await userEvent.click(moved().getByRole('button', { name: '다른 상품' }));
    await waitFor(() =>
      expect(requestsTo(api, 'PATCH', '/sourcing-comparison-rows/3')).toHaveLength(2),
    );
    expect(
      await requestsTo(api, 'PATCH', '/sourcing-comparison-rows/3')[1]!.clone().json(),
    ).toEqual({ ownerMatchDecision: 'NO_MATCH' });
    expect(await c.findByText('다른 상품')).toBeInTheDocument();
    expect(c.getByText('내가 정함')).toBeInTheDocument();
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

// ── D-47 상품 고르기 목록 · 정한 뒤 머리 줄 · 접기 · 안내 띠 ─────────────────────────────

/** 기준 상품을 정하기 전(탐색 모드)의 비교표 머리 값 */
const EXPLORE = {
  exploreMode: true,
  anchorInputMethod: null,
  anchorItemCode: null,
  anchorModelCode: null,
  anchorModelCodeNorm: null,
  anchorColorCode: null,
  anchorColorLabel: null,
  detectedGender: null,
  genderBasis: null,
} as const;

/** 검색 결과 세 줄(관련도 순) — 사진·모델 번호가 있는 줄과 없는 줄 */
function searchRows() {
  return [
    unverifiedRow(1, {
      shopName: '샵 A',
      itemCode: 'shop-a:1',
      itemName: 'アシックス ゲルカヤノ14 1201A019-108 クリーム×ブラック メンズ',
      imageUrl: 'thumb.example/a.jpg',
      apiItemPriceYen: 11_800,
      modelCodeNorm: '1201A019',
      anchorMatch: null,
    }),
    unverifiedRow(2, {
      shopName: '샵 B',
      itemCode: 'shop-b:2',
      itemName: 'アシックス ゲルカヤノ14 メンズ ランニングシューズ',
      imageUrl: null,
      apiItemPriceYen: 9_800,
      modelCodeNorm: null,
      anchorMatch: null,
    }),
    unverifiedRow(3, {
      shopName: null,
      shopCode: 'shop-c',
      itemCode: 'shop-c:3',
      itemName: 'ASICS GEL-KAYANO 14 1201A019-100 WHITE',
      imageUrl: 'thumb.example/c.jpg',
      apiItemPriceYen: 12_400,
      modelCodeNorm: '1201A019',
      anchorMatch: null,
    }),
  ];
}

const ANCHOR_ACCEPTED = {
  candidateId: CANDIDATE_ID,
  sourcingComparisonId: 41,
  stepRunId: 120,
  stepStatus: 'WAITING_INPUT',
  rowId: null,
};

function setupPick({ rows = searchRows() }: { rows?: ComparisonRowFixture[] } = {}) {
  return setupTable({ rows, comparison: { ...EXPLORE } });
}

const pickButtons = () =>
  screen.queryAllByRole('button', { name: /^(이 상품으로 정하기|정하는 중…)$/ });

describe('② 상품 고르기 목록(D-47) — 쇼핑몰처럼 검색 결과에서 하나 고른다', () => {
  it('목록: 사진·상품명·가격·샵·모델 번호·[이 상품으로 정하기]. 미리 골라진 항목이 없고 옛 고르기 칸·표가 없다', async () => {
    setupPick();
    const { container } = await renderSourcing();
    expect(await screen.findByRole('heading', { level: 1, name: '상품 고르기' })).toBeVisible();
    expect(
      screen.getByText(
        '라쿠텐 검색 결과입니다. 팔고 싶은 상품 하나를 고르면 그 상품을 파는 샵을 모아 비교해 줍니다.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('관련도 순 · 3건')).toBeInTheDocument();

    const items = within(screen.getByRole('list', { name: '라쿠텐 검색 결과' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(3);
    // 서버가 준 순서(관련도 순) 그대로, 한 줄에 사진·상품명·가격·샵·(있으면) 모델 번호·버튼
    const first = within(items[0]!);
    expect(
      first.getByText('アシックス ゲルカヤノ14 1201A019-108 クリーム×ブラック メンズ'),
    ).toBeVisible();
    expect(first.getByText('¥11,800')).toBeInTheDocument();
    expect(first.getByText('샵 A')).toBeInTheDocument();
    expect(first.getByText('모델 번호 1201A019')).toBeInTheDocument();
    expect(first.getByRole('button', { name: '이 상품으로 정하기' })).toBeEnabled();
    // 사진: 꾸밈 그림(alt="")·늦게 불러오기, 없는 줄은 빈 자리('사진 없음')
    const photo = items[0]!.querySelector('img')!;
    expect(photo).toHaveAttribute('src', 'thumb.example/a.jpg');
    expect(photo).toHaveAttribute('alt', '');
    expect(photo).toHaveAttribute('loading', 'lazy');
    expect(items[1]!.querySelector('img')).toBeNull();
    expect(within(items[1]!).getByText('사진 없음')).toBeInTheDocument();
    // 모델 번호를 못 뽑은 줄에는 모델 번호가 없다. 샵 이름이 없으면 샵 코드
    expect(within(items[1]!).queryByText(/^모델 번호/)).toBeNull();
    expect(within(items[2]!).getByText('shop-c')).toBeInTheDocument();
    expect(container.querySelectorAll('img')).toHaveLength(2);

    // 맨 위 항목을 미리 고르지 않는다 — 고른 표시도, 라디오·셀렉트도 없다
    expect(pickButtons()).toHaveLength(3);
    const pick = within(screen.getByRole('region', { name: '상품 고르기' }));
    expect(pick.queryByRole('radio')).toBeNull();
    expect(pick.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: '기준 상품 정하기' })).toBeNull();
    expect(screen.queryByRole('radio', { name: /검색 결과에서 고르기/ })).toBeNull();
    // 표·표 위 캡션·'다른 상품도 보기'는 기준 상품을 정한 뒤에만(D-39), 기준 상품 머리 줄도 아직 없다
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/^실질가 = 상품 가격/)).toBeNull();
    expect(screen.queryByRole('checkbox', { name: '다른 상품도 보기' })).toBeNull();
    expect(screen.queryByLabelText('기준 상품')).toBeNull();
    expect(screen.getByText('Supported by Rakuten Developers')).toBeInTheDocument();
  });

  it("[이 상품으로 정하기]는 그 상품으로 SEARCH_PICK PUT을 보낸다 — 그 줄만 '정하는 중…', 나머지는 꺼진다", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = setupPick();
    api.on('PUT /sourcing-comparisons/41/anchor', async () => {
      await gate;
      return jsonResponse(ANCHOR_ACCEPTED, 202);
    });
    await renderSourcing();
    const items = within(
      await screen.findByRole('list', { name: '라쿠텐 검색 결과' }),
    ).getAllByRole('listitem');
    await userEvent.click(within(items[1]!).getByRole('button', { name: '이 상품으로 정하기' }));

    expect(await within(items[1]!).findByRole('button', { name: '정하는 중…' })).toBeDisabled();
    const others = screen.getAllByRole('button', { name: '이 상품으로 정하기' });
    expect(others).toHaveLength(2);
    for (const button of others) expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: '더 보기' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '찾는 상품이 없나요? 모델 번호로 직접 찾기' }),
    ).toBeEnabled();
    release();

    const puts = requestsTo(api, 'PUT', '/sourcing-comparisons/41/anchor');
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(await puts[0]!.clone().json()).toEqual({
      anchorInputMethod: 'SEARCH_PICK',
      anchorItemCode: 'shop-b:2',
    });
    // 다 끝나면 다시 누를 수 있다
    await waitFor(() => expect(pickButtons().every((b) => !b.hasAttribute('disabled'))).toBe(true));
  });

  it('정하지 못하면 오류 글을 알림으로 보인다(서버 글 그대로)', async () => {
    const api = setupPick();
    api.on('PUT /sourcing-comparisons/41/anchor', () =>
      errorResponse(409, 'STEP_RUN_NOT_WAITING_INPUT', '이 실행은 입력을 기다리고 있지 않습니다.'),
    );
    await renderSourcing();
    const items = within(
      await screen.findByRole('list', { name: '라쿠텐 검색 결과' }),
    ).getAllByRole('listitem');
    await userEvent.click(within(items[0]!).getByRole('button', { name: '이 상품으로 정하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이 실행은 입력을 기다리고 있지 않습니다.',
    );
  });

  it("[더 보기]는 search-more를 부르고, 눌린 동안 '불러오는 중…'이며, 더 없다고 받으면 사라진다. 비교 버전이 바뀌면 다시 보인다", async () => {
    let release = () => {};
    let gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const results = [
      { addedRowCount: 2, hasMore: true },
      { addedRowCount: 0, hasMore: true },
      { addedRowCount: 0, hasMore: false },
    ];
    const api = setupPick();
    api.on('POST /sourcing-comparisons/41/search-more', async () => {
      await gate;
      return jsonResponse(results.shift());
    });
    const { queryClient } = await renderSourcing();
    const more = await screen.findByRole('button', { name: '더 보기' });
    await userEvent.click(more);
    expect(await screen.findByRole('button', { name: '불러오는 중…' })).toBeDisabled();
    // 더한 뒤에는 비교표를 다시 읽는다 — 서버가 준 새 행이 목록에 보인다
    const rowsAfter = [
      ...searchRows(),
      unverifiedRow(4, { shopName: '샵 D', itemCode: 'shop-d:4', anchorMatch: null }),
    ];
    api.on(`GET /candidates/${CANDIDATE_ID}/sourcing-comparison`, () =>
      jsonResponse(searchComparison({ candidateId: CANDIDATE_ID, rows: rowsAfter, ...EXPLORE })),
    );
    release();
    const posts = requestsTo(api, 'POST', '/sourcing-comparisons/41/search-more');
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(await screen.findByText('샵 D')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '더 보기' })).toBeEnabled());
    expect(screen.getByText('관련도 순 · 4건')).toBeInTheDocument();

    // 새로 더한 것이 없으면 그렇다고 알리고 버튼은 남는다
    gate = Promise.resolve();
    await userEvent.click(screen.getByRole('button', { name: '더 보기' }));
    expect(await screen.findByText('새로 더한 상품이 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '더 보기' })).toBeEnabled();

    // hasMore:false를 받으면 이 비교 버전에서는 버튼을 숨긴다
    await userEvent.click(screen.getByRole('button', { name: '더 보기' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull());
    expect(screen.queryByText('새로 더한 상품이 없습니다.')).toBeNull();
    expect(requestsTo(api, 'POST', '/sourcing-comparisons/41/search-more')).toHaveLength(3);

    // 새 비교 버전(다시 실행해 id가 바뀜)에서는 다시 보인다
    api.on(`GET /candidates/${CANDIDATE_ID}/sourcing-comparison`, () =>
      jsonResponse(
        searchComparison({ candidateId: CANDIDATE_ID, id: 42, rows: searchRows(), ...EXPLORE }),
      ),
    );
    await queryClient.invalidateQueries();
    expect(await screen.findByRole('button', { name: '더 보기' })).toBeEnabled();
  });

  it('[더 보기] 오류는 알림 글로 보이고 버튼은 남는다', async () => {
    const api = setupPick();
    api.on('POST /sourcing-comparisons/41/search-more', () =>
      errorResponse(
        409,
        'EXTERNAL_CALL_COOLDOWN',
        '라쿠텐 호출이 쉬는 중입니다. 잠시 뒤에 다시 해 주세요.',
      ),
    );
    await renderSourcing();
    await userEvent.click(await screen.findByRole('button', { name: '더 보기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '라쿠텐 호출이 쉬는 중입니다. 잠시 뒤에 다시 해 주세요.',
    );
    expect(screen.getByRole('button', { name: '더 보기' })).toBeEnabled();
  });

  it("'찾는 상품이 없나요? 모델 번호로 직접 찾기'를 누르면 모델 번호·색상 번호 칸이 펼쳐지고 CODE_ENTRY PUT을 보낸다", async () => {
    const api = setupPick();
    api.on('PUT /sourcing-comparisons/41/anchor', () => jsonResponse(ANCHOR_ACCEPTED, 202));
    await renderSourcing();
    const toggle = await screen.findByRole('button', {
      name: '찾는 상품이 없나요? 모델 번호로 직접 찾기',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('모델 번호(型番)')).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const model = screen.getByLabelText('모델 번호(型番)');
    expect(model).toHaveAttribute('placeholder', '예: 1201A019');
    expect(screen.getByLabelText('색상 번호(선택)')).toHaveAttribute('placeholder', '예: 108');
    const submit = screen.getByRole('button', { name: '이 모델 번호로 정하기' });
    expect(submit).toBeDisabled();
    await userEvent.type(model, '1201a019');
    await userEvent.type(screen.getByLabelText('색상 번호(선택)'), '108');
    await userEvent.click(submit);
    const puts = requestsTo(api, 'PUT', '/sourcing-comparisons/41/anchor');
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(await puts[0]!.clone().json()).toEqual({
      anchorInputMethod: 'CODE_ENTRY',
      anchorModelCode: '1201a019',
      anchorColorCode: '108',
    });
    // 접었다 펴도 쓰던 글이 남는다
    await userEvent.click(toggle);
    expect(screen.queryByLabelText('모델 번호(型番)')).toBeNull();
    await userEvent.click(toggle);
    expect(screen.getByLabelText('모델 번호(型番)')).toHaveValue('1201a019');
  });

  it('검색 결과가 0건이면 목록·[더 보기] 없이 모델 번호 입력만 보인다', async () => {
    setupPick({ rows: [] });
    await renderSourcing();
    expect(await screen.findByRole('heading', { level: 1, name: '상품 고르기' })).toBeVisible();
    expect(
      screen.getByText(
        '검색 결과가 없어 고를 상품이 없습니다. 모델 번호(型番)를 직접 넣어 주세요.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '라쿠텐 검색 결과' })).toBeNull();
    expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull();
    expect(screen.queryByRole('button', { name: /모델 번호로 직접 찾기/ })).toBeNull();
    expect(screen.getByLabelText('모델 번호(型番)')).toHaveAttribute('placeholder', '예: 1201A019');
    expect(screen.getByRole('button', { name: '이 모델 번호로 정하기' })).toBeDisabled();
  });

  it('입력을 기다리는 현재 버전이 아니면 목록 대신 한 줄 요약만 보인다', async () => {
    setupTable({
      rows: searchRows(),
      comparison: { ...EXPLORE, stepStatus: 'RUNNING' },
    });
    await renderSourcing();
    expect(
      await screen.findByText(
        /^검색 결과 3건 · .*기준 상품을 정하면 같은 상품을 파는 샵을 모아 비교한 표가 여기에 나옵니다\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '라쿠텐 검색 결과' })).toBeNull();
    expect(screen.queryByRole('button', { name: '이 상품으로 정하기' })).toBeNull();
  });
});

describe('② 정한 뒤 머리 한 줄과 접기·안내 띠(D-47)', () => {
  it('기준 상품 머리 줄에 사진·이름이 더해진다. 검색 결과에 그 상품이 없으면 지금 글만 보인다', async () => {
    const withPhoto = { ...SHOP_A, imageUrl: 'thumb.example/a.jpg' };
    setupTable({
      rows: [withPhoto, SHOP_B],
      comparison: { anchorItemCode: SHOP_A.itemCode },
    });
    const first = await renderSourcing();
    const anchor = within(await screen.findByLabelText('기준 상품'));
    expect(anchor.getByText(SHOP_A.itemName)).toBeInTheDocument();
    expect(
      anchor.getByText('모델 번호 1201A019 · 색상 번호 108 · クリーム×ブラック(108)'),
    ).toBeInTheDocument();
    expect(
      anchor.getByText('이 여정에서는 바꿀 수 없습니다 · 다른 모델·색상은 새 여정으로 만듭니다'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('기준 상품').querySelector('img')).toHaveAttribute(
      'src',
      'thumb.example/a.jpg',
    );
    first.unmount();

    // 모델 번호로 직접 정한 기준 상품(anchorItemCode 없음)은 사진·이름 없이 지금 글만
    setupTable({ rows: [SHOP_A, SHOP_B], comparison: { anchorItemCode: null } });
    await renderSourcing();
    const plain = within(await screen.findByLabelText('기준 상품'));
    expect(
      plain.getByText('모델 번호 1201A019 · 색상 번호 108 · クリーム×ブラック(108)'),
    ).toBeInTheDocument();
    expect(plain.queryByText(SHOP_A.itemName)).toBeNull();
    expect(screen.getByLabelText('기준 상품').querySelector('img')).toBeNull();
  });

  it("같은 상품인지 확실하지 않은 행은 접혀 있고, [펼치기]를 누르면 같은 표 행으로 보인다(재고 확인한 '확인 필요'·내가 정한 행은 접지 않는다)", async () => {
    const janDiff = comparisonRow(5, { shopName: '샵 E', janMatch: false });
    const decided = unverifiedRow(6, {
      shopName: '샵 F',
      anchorMatch: 'NEEDS_REVIEW',
      ownerMatchDecision: 'MATCH',
    });
    setupTable({ rows: [SHOP_A, janDiff, decided, SHOP_C] });
    await renderSourcing();
    await screen.findByRole('table', { name: '같은 상품을 파는 샵 비교' });
    expect(shopOrder()).toEqual(['샵 A', '샵 E', '샵 F']);
    const head = screen.getByText('같은 상품인지 확실하지 않은 1개');
    const toggle = within(head.closest('td')!).getByRole('button', { name: '펼치기' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.getByText(/^모델 번호·색상이 같은지 앱이 가리지 못한 상품입니다\./),
    ).not.toBeVisible();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('접기');
    expect(
      screen.getByText(/^모델 번호·색상이 같은지 앱이 가리지 못한 상품입니다\./),
    ).toBeVisible();
    expect(shopOrder()).toEqual(['샵 A', '샵 E', '샵 F', '샵 C']);
    const c = within(screen.getByRole('row', { name: '샵 C' }));
    expect(c.getByText('확인 필요')).toBeInTheDocument();
    expect(c.getByText('색상 번호 없음')).toBeInTheDocument();
    expect(c.getByRole('button', { name: '재고 확인' })).toBeEnabled();
    // 행을 펼치면 AI 참고(없으면 직접 정하라는 말)와 [같은 상품]·[다른 상품]이 보인다
    await userEvent.click(screen.getByRole('button', { name: '샵 C' }));
    const decision = within(await screen.findByRole('group', { name: '같은 상품 판단' }));
    expect(
      decision.getByText('규칙으로 가리지 못했습니다. 같은 상품인지 직접 정해 주세요.'),
    ).toBeInTheDocument();
    expect(decision.getByRole('button', { name: '같은 상품' })).toBeEnabled();
    expect(decision.getByRole('button', { name: '다른 상품' })).toBeEnabled();

    await userEvent.click(toggle);
    expect(shopOrder()).toEqual(['샵 A', '샵 E', '샵 F']);
  });

  it('접힌 행만 남아도 표 머리와 묶음 머리가 있어 모양이 같다', async () => {
    setupTable({ rows: [SHOP_C] });
    await renderSourcing();
    const table = within(await screen.findByRole('table', { name: '같은 상품을 파는 샵 비교' }));
    expect(table.getAllByRole('columnheader')).toHaveLength(9);
    expect(table.getByText('같은 상품인지 확실하지 않은 1개')).toBeInTheDocument();
    expect(shopOrder()).toEqual([]);
  });

  it('모델 번호는 있는데 색상 번호를 읽지 못한 기준 상품이면 색상 번호 안내 띠가 비교표 위에 있다', async () => {
    setupTable({
      rows: [SHOP_C],
      comparison: { anchorColorCode: null, anchorColorLabel: null },
    });
    await renderSourcing();
    const banner = await screen.findByRole('note');
    expect(banner).toHaveTextContent('이 상품은 이름에서 색상 번호를 읽지 못했습니다.');
    expect(screen.queryByText(/모델 번호를 알 수 없어/)).toBeNull();
    const table = screen.getByRole('table', { name: '같은 상품을 파는 샵 비교' });
    expect(banner.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('모델 번호 없는 기준 상품을 정했으면 비교표 위에 안내 띠가 있고 다시 찾기 버튼은 없다', async () => {
    const note =
      "이 상품은 모델 번호를 알 수 없어 같은 상품을 자동으로 찾지 못했습니다. '확인 필요' 행을 펼쳐 직접 정하거나, 모델 번호가 있는 상품으로 새 여정을 만드세요.";
    setupTable({
      rows: [SHOP_C],
      comparison: {
        anchorModelCode: null,
        anchorModelCodeNorm: null,
        anchorColorCode: null,
        anchorColorLabel: null,
      },
    });
    const first = await renderSourcing();
    const banner = await screen.findByRole('note');
    expect(banner).toHaveTextContent(note);
    expect(screen.queryByRole('button', { name: /다시 찾기/ })).toBeNull();
    // 띠는 비교표 위에 있다
    const table = screen.getByRole('table', { name: '같은 상품을 파는 샵 비교' });
    expect(banner.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    first.unmount();

    // 모델 번호가 있는 기준 상품·기준 상품 전에는 띠가 없다
    setupTable();
    const second = await renderSourcing();
    await screen.findByRole('table', { name: '같은 상품을 파는 샵 비교' });
    expect(screen.queryByText(note)).toBeNull();
    second.unmount();
    setupPick();
    await renderSourcing();
    await screen.findByRole('list', { name: '라쿠텐 검색 결과' });
    expect(screen.queryByText(note)).toBeNull();
  });
});

describe('② 실제 사용에는 안내 판과 지금 여기가 없다(D-43 — 체험에서만 보인다)', () => {
  it('마친 ②: 안내 판·표시 없이 맨 아래 [다음: ③ 판정] 버튼만 있다', async () => {
    setup();
    await renderSourcing();
    await screen.findByRole('link', { name: /다음: ③ 판정/ });
    expect(screen.queryByRole('region', { name: '② 소싱 안내' })).toBeNull();
    expect(screen.queryByText('지금 여기')).toBeNull();
    expect(screen.queryByText(/지금 할 일/)).toBeNull();
  });

  it('입력을 기다리는 ②: 꺼진 [다시 실행]의 이유는 서버 글 그대로이고 표시를 가리키지 않는다', async () => {
    const WAITING = '이 단계가 입력을 기다리고 있습니다. 입력을 마치면 이어서 실행됩니다.';
    const api = setupTable();
    const edit = disabled('INVALID_STEP_CODE', '이 단계는 값을 직접 고칠 수 없습니다.');
    api.on(`GET /candidates/${CANDIDATE_ID}/steps`, () =>
      jsonResponse(
        stepRail({
          SOURCING: {
            status: 'WAITING_INPUT',
            actions: {
              run: disabled('STEP_WAITING_INPUT', WAITING),
              continuousRun: disabled('STEP_WAITING_INPUT', WAITING),
              edit,
            },
          },
        }),
      ),
    );
    await renderSourcing();
    expect(await screen.findByText(WAITING)).toBeInTheDocument();
    expect(screen.queryByText(/지금 여기/)).toBeNull();
    expect(screen.queryByRole('region', { name: '② 소싱 안내' })).toBeNull();
  });
});

describe('② 맨 위 안내(D-34): 하는 일 · 지금 할 일 · 낯선 말 풀이', () => {
  it('하는 일 한 문장과 상태에 맞는 지금 할 일이 보이고, 풀이는 접혀 있다가 펼치면 용어가 나온다', async () => {
    setupTable({
      rows: [
        unverifiedRow(1, { shopName: '샵 A', anchorMatch: null }),
        unverifiedRow(2, { shopName: '샵 B', anchorMatch: null }),
      ],
      comparison: { exploreMode: true, anchorInputMethod: null, anchorItemCode: null },
    });
    await renderSourcing({ demo: true });
    const intro = within(await screen.findByRole('region', { name: '② 소싱 안내' }));
    expect(
      intro.getByText(
        '라쿠텐에서 팔고 싶은 상품을 하나 고르고, 그 상품을 파는 샵 가운데 실제로 드는 돈(실질가)이 가장 낮은 샵을 하나 고르는 단계입니다.',
      ),
    ).toBeInTheDocument();
    // 기준 상품 전 → 기준 상품을 고르라고 말한다
    expect(intro.getByRole('status')).toHaveTextContent(
      /^지금 할 일 아래 검색 결과에서 팔고 싶은 상품 하나를 골라 \[이 상품으로 정하기\]를 누르세요\./,
    );
    const toggle = intro.getByRole('button', { name: /펼치기/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const term of [
      '기준 상품',
      '모델 번호(型番)',
      '같은 상품인가',
      '재고 확인',
      '일본 내 배송비',
      '실질가',
      '소싱 확정(G2)',
    ]) {
      expect(intro.getByText(term)).toBeVisible();
    }
    // 포인트 계수는 이 비교 버전의 값(보통 0.5)으로 채워진다
    expect(intro.getByText(/포인트 × 0\.5로 계산하며/)).toBeInTheDocument();
    expect(intro.queryByText(/\{kRank\}/)).toBeNull();
  });

  it("② 완료면 끝났다고 알리고 맨 아래 [다음: ③ 판정]에 '지금 여기'를 붙인다", async () => {
    setup();
    await renderSourcing({ demo: true });
    const intro = within(await screen.findByRole('region', { name: '② 소싱 안내' }));
    expect(intro.getByRole('status')).toHaveTextContent(
      '② 소싱을 마쳤습니다. 화면 맨 아래 [다음: ③ 판정]을 눌러 국내 기준가(네이버쇼핑에서 찾아본 판매가 + 배송비)를 넣으러 가세요.',
    );
    // 오너가 "그다음 뭐 해야 해?"(Q57)·"다음 단계 버튼은 보통 하단"(Q58)이라고 해서, 맨 위 링크 대신 맨 아래 버튼에 표시를 붙인다(D-42)
    expect(intro.queryByRole('link')).toBeNull();
    const marks = screen.getAllByText('지금 여기');
    expect(marks).toHaveLength(1);
    expect(
      within(marks[0]!.parentElement!).getByRole('link', { name: /다음: ③ 판정/ }),
    ).toHaveAttribute('href', `/candidates/${CANDIDATE_ID}/judgement`);
  });

  it("② 소싱에는 '여기부터 연속 실행'이 없고(D-40), 입력을 기다려 꺼진 [다시 실행]의 이유는 한 번만 보인다", async () => {
    const WAITING = '이 단계가 입력을 기다리고 있습니다. 입력을 마치면 이어서 실행됩니다.';
    const api = setupTable();
    const edit = disabled('INVALID_STEP_CODE', '이 단계는 값을 직접 고칠 수 없습니다.');
    api.on(`GET /candidates/${CANDIDATE_ID}/steps`, () =>
      jsonResponse(
        stepRail({
          SOURCING: {
            status: 'WAITING_INPUT',
            actions: {
              run: disabled('STEP_WAITING_INPUT', WAITING),
              continuousRun: disabled('STEP_WAITING_INPUT', WAITING),
              edit,
            },
          },
        }),
      ),
    );
    await renderSourcing({ demo: true });
    await screen.findByRole('region', { name: '② 소싱 안내' });
    expect(screen.queryByRole('button', { name: '여기부터 연속 실행' })).toBeNull();
    // 서버 글 대신 '어디서 무엇을 하면 켜지는지'를 말한다(D-36)
    const waiting = await screen.findAllByText(
      /^② 소싱이 입력을 기다리는 중이라 \[다시 실행\]은 지금 쓸 수 없습니다/,
    );
    expect(waiting).toHaveLength(1);
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(waiting[0]!.id).toBe('sourcing-run-why');
    expect(screen.getByRole('button', { name: '다시 실행' })).toHaveAttribute(
      'aria-describedby',
      'sourcing-run-why',
    );
  });

  it("'지금 여기' 표시가 지금 할 일이 있는 자리에만 붙는다(기준 상품 → 살 샵)", async () => {
    setupTable({
      rows: [
        unverifiedRow(1, { shopName: '샵 A', anchorMatch: null }),
        unverifiedRow(2, { shopName: '샵 B', anchorMatch: null }),
      ],
      comparison: { exploreMode: true, anchorInputMethod: null, anchorItemCode: null },
    });
    const first = await renderSourcing({ demo: true });
    await screen.findByRole('region', { name: '② 소싱 안내' });
    const marks = await screen.findAllByText('지금 여기');
    expect(marks).toHaveLength(1);
    // 표시는 '상품 고르기' 목록에 붙는다(위쪽 버튼이나 표가 아니다) — 옛 기준 상품 칸이 아니라 새 목록이 가리키는 자리다
    const holder = marks[0]!.parentElement!;
    expect(within(holder).getAllByRole('button', { name: '이 상품으로 정하기' })).toHaveLength(2);
    expect(within(holder).getByRole('list', { name: '라쿠텐 검색 결과' })).toBeInTheDocument();
    expect(within(holder).queryByRole('table')).toBeNull();
    first.unmount();
  });

  it('기준 상품을 정한 뒤에는 표시가 비교표로 옮겨 가고, ② 완료면 맨 아래 [다음: ③ 판정]에만 붙는다', async () => {
    setupTable();
    const first = await renderSourcing({ demo: true });
    const marks = await screen.findAllByText('지금 여기');
    expect(marks).toHaveLength(1);
    expect(
      within(marks[0]!.parentElement!).getByRole('table', { name: '같은 상품을 파는 샵 비교' }),
    ).toBeInTheDocument();
    first.unmount();

    setup();
    await renderSourcing({ demo: true });
    await screen.findByRole('region', { name: '② 소싱 안내' });
    // 입력 칸·표에는 없고, 다음 화면으로 가는 버튼에만 붙는다(D-42)
    const marks2 = await screen.findAllByText('지금 여기');
    expect(marks2).toHaveLength(1);
    expect(within(marks2[0]!.parentElement!).getByRole('link')).toHaveAccessibleName(
      /다음: ③ 판정/,
    );
  });
});
