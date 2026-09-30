import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import {
  queryValidation,
  RAKUTEN_ITEM_ID,
  rakutenItemFetchResult,
  rakutenItemSnapshot,
  sourcingComparison,
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
    expect(url.getByRole('radio', { name: '바로 후보 만들기' })).toBeChecked();
    expect(url.getByText('비교표에 넣기는 아직 준비 중입니다')).toBeInTheDocument();
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
