import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { FakeEventSource } from '@/test/fakeEventSource';
import { callUsageList } from '@/test/fixtures/callUsage';
import {
  childRows,
  childTermList,
  collectionStatus,
  keywordRows,
  keywordSnapshotDetail,
  keywordSnapshotPage,
  rankedKeyword,
  rankedKeywordPage,
  SNAPSHOT_ID,
} from '@/test/fixtures/keywords';
import { renderRoute } from '@/test/renderRoute';
import { AUTO_CONVERT_CAPTION, KEYWORD_HANGUL_HINT, QUERY_PLACEHOLDER } from './RakutenQueryPanel';

type Status = ReturnType<typeof collectionStatus>;

/**
 * 가짜 서버: 묶음 7(버튼 수집), 여성신발 10줄 + 아동 키워드 1줄. 고르기는 실제 BE처럼 움직인다(D-33): `PUT`은 그 키워드를
 * '지금 고른 키워드'로 하고(selectedAt을 가장 늦게), 이미 지금 고른 키워드면 그대로 둔다. 앞서 고른 키워드의 selectedAt은 남는다.
 * 묶음 조회는 selectedAt이 가장 늦은 키워드를 `selectedKeyword`로 준다.
 */
function setup(status: Status = collectionStatus()) {
  const state = {
    status,
    /** 고른 키워드 id → selectedAt(ms) */
    picks: new Map<number, number>(),
    clock: Date.parse('2026-09-24T05:00:00.000Z'),
    terms: [] as string[],
  };
  const rowsOf = (cid: string) =>
    keywordRows(cid).map((r) => {
      const at = state.picks.get(r.id);
      return { ...r, selectedAt: at === undefined ? null : new Date(at).toISOString() };
    });
  const currentId = (): number | null => {
    let best: number | null = null;
    for (const [id, at] of state.picks) {
      const bestAt = best === null ? -Infinity : state.picks.get(best)!;
      if (at > bestAt || (at === bestAt && best !== null && id > best)) best = id;
    }
    return best;
  };
  const rowById = (id: number) => rowsOf('50000173').find((r) => r.id === id) ?? null;
  const api = stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList()),
    'GET /keyword-snapshots': () => jsonResponse(keywordSnapshotPage()),
    [`GET /keyword-snapshots/${SNAPSHOT_ID}`]: () => {
      const id = currentId();
      return jsonResponse(
        keywordSnapshotDetail({ selectedKeyword: id === null ? null : rowById(id) }),
      );
    },
    [`GET /keyword-snapshots/${SNAPSHOT_ID}/keywords`]: (req) => {
      const q = new URL(req.url).searchParams;
      const cid = q.get('cid') ?? '50000173';
      const size = Number(q.get('size') ?? '20');
      if (q.get('excluded') === 'true')
        return jsonResponse(rankedKeywordPage(childRows(cid), 1, size));
      return jsonResponse(rankedKeywordPage(rowsOf(cid).slice(0, size), 97, size));
    },
    'GET /keyword-collection-status': () => jsonResponse(state.status),
    'GET /child-keyword-terms': () => jsonResponse(childTermList(state.terms)),
  });
  for (let id = 100; id < 110; id += 1) {
    api.on(`PUT /keywords/${id}/selection`, () => {
      if (currentId() !== id) {
        // 실제 BE처럼: 이 묶음의 가장 늦은 selectedAt보다 늦게
        state.clock = Math.max(state.clock, ...state.picks.values()) + 1000;
        state.picks.set(id, state.clock);
      }
      return jsonResponse(rowById(id));
    });
    api.on(`DELETE /keywords/${id}/selection`, () => {
      state.picks.delete(id);
      return new Response(null, { status: 204 });
    });
  }
  return { api, state };
}

async function renderKeywords(options: Parameters<typeof renderRoute>[1] = {}) {
  const view = renderRoute('/keywords', options);
  await screen.findByRole('heading', { level: 1, name: '키워드' });
  return view;
}

const requestsTo = (api: ReturnType<typeof stubApi>, method: string, path: string) =>
  api.requests.filter((r) => r.method === method && new URL(r.url).pathname === `/api/v1${path}`);

describe('키워드 화면(SCR-02, P2-01)', () => {
  it('머리(화면 ID 칩 없음, D-27)·패널 배치·보드 문구, 기간은 읽기 전용, M2 부분은 그리지 않는다', async () => {
    setup();
    await renderKeywords();
    expect(screen.queryByText('SCR-02')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        '데이터랩 인기 검색어를 모아 소싱할 키워드를 하나 고르고, 라쿠텐 검색어를 확인합니다.',
      ),
    ).toBeInTheDocument();
    const collect = screen.getByRole('region', { name: '데이터랩 수집' });
    expect(
      await within(collect).findByText(
        /^마지막 수집 (09-24 )?13:30 · 출처 데이터랩 · 2초 간격 · 이상 없음$/,
      ),
    ).toBeInTheDocument();
    // 수집 범위는 상위 100위 하나다(500위 옵션은 뺐다) — 몇 번 요청하는지 알린다
    expect(within(collect).getByText('상위 100위')).toBeInTheDocument();
    expect(
      within(collect).getByText('한 번에 20개씩 받아 분야마다 5번, 모두 10번 요청 · 약 20초'),
    ).toBeInTheDocument();
    expect(within(collect).queryByRole('button', { name: '상위 500위' })).toBeNull();
    expect(within(collect).getByLabelText('시작일')).toHaveAttribute('readonly');
    expect(await screen.findByRole('heading', { name: '여성신발 키워드' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '라쿠텐 검색어 확인' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '아동용 단어' })).toBeInTheDocument();
    expect(await screen.findByText('더할 수만 있고 뺄 수 없습니다')).toBeInTheDocument();
    expect(await screen.findByText('1–10 / 97')).toBeInTheDocument();
    // M2(세부 분류·기기·성별·연령 필터, 분류 열, 우선 브랜드, 우선·제외 목록 패널)는 없다
    for (const label of ['세부 분류', '기기', '성별', '연령']) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    expect(screen.queryByRole('columnheader', { name: '분류' })).toBeNull();
    expect(screen.queryByRole('button', { name: '우선 브랜드' })).toBeNull();
    expect(screen.queryByRole('region', { name: '우선·제외 목록' })).toBeNull();
    // 붙여넣기 패널은 처음엔 닫혀 있다
    expect(screen.queryByRole('region', { name: '순위 붙여넣기' })).toBeNull();
  });

  it('수집을 누르기 전 표는 지난번에 받아 둔 순위라고 알린다(방금 받은 것과 구분)', async () => {
    const { api } = setup();
    await renderKeywords();
    const table = (await screen.findByRole('heading', { name: '여성신발 키워드' })).closest(
      'section',
    )!;
    expect(await within(table).findByText('지난번에 받아 둔 순위')).toBeInTheDocument();
    expect(
      within(table).getByText(
        /^(오늘 |09-24 )13:30에 데이터랩에서 받음 · 새 순위가 필요하면 위 \[수집\]을 누르세요$/,
      ),
    ).toBeInTheDocument();
    expect(within(table).queryByText('방금 새로 받은 순위')).toBeNull();
    expect(requestsTo(api, 'POST', '/keyword-snapshots')).toHaveLength(0);
  });

  it('순위를 붙여넣어 새 묶음을 만들면 그 표는 방금 붙여넣은 순위라고 알린다', async () => {
    const { api } = setup();
    api.on('POST /keyword-snapshots', () =>
      jsonResponse(
        keywordSnapshotDetail({
          id: 8,
          method: 'PASTE',
          requestedCids: [],
          collectedAt: new Date().toISOString(),
        }),
        201,
      ),
    );
    api.on('GET /keyword-snapshots/8', () =>
      jsonResponse(
        keywordSnapshotDetail({
          id: 8,
          method: 'PASTE',
          requestedCids: [],
          collectedAt: new Date().toISOString(),
        }),
      ),
    );
    api.on('GET /keyword-snapshots/8/keywords', () => jsonResponse(rankedKeywordPage([], 0)));
    await renderKeywords();
    expect(await screen.findByText('지난번에 받아 둔 순위')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '순위 붙여넣기' }));
    const panel = await screen.findByRole('region', { name: '순위 붙여넣기' });
    await userEvent.type(
      within(panel).getByLabelText('데이터랩 화면에서 복사한 순위와 키워드'),
      '1 뉴발란스 530',
    );
    await userEvent.click(within(panel).getByRole('button', { name: '목록 만들기' }));
    expect(await screen.findByText('방금 붙여넣은 순위')).toBeInTheDocument();
    expect(screen.queryByText('지난번에 받아 둔 순위')).toBeNull();
  });

  it("고른 키워드가 없으면 '이 검색어로 소싱'이 꺼져 있고, 하나 고르면 켜진다(G1)", async () => {
    const { api } = setup();
    await renderKeywords();
    const query = screen.getByRole('region', { name: '라쿠텐 검색어 확인' });
    const go = within(query).getByRole('button', { name: /이 검색어로 소싱/ });
    expect(go).toBeDisabled();
    expect(
      within(query).getByText('키워드 표에서 키워드를 하나 고르면 켜집니다.'),
    ).toBeInTheDocument();
    expect(within(query).getByText('표에서 소싱할 키워드를 하나 고르세요.')).toBeInTheDocument();
    expect(within(query).getByText('G1 키워드 선택 · 확인 필요')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('radio', { name: '아식스 젤카야노14 고르기' }));
    await waitFor(() => expect(requestsTo(api, 'PUT', '/keywords/101/selection')).toHaveLength(1));
    await waitFor(() =>
      expect(within(query).getByRole('button', { name: /이 검색어로 소싱/ })).toBeEnabled(),
    );
    expect(within(query).getByText('G1 키워드 선택 · 통과')).toBeInTheDocument();
    // 한국어 원문은 칸 위에 늘 보이고, 일본어 검색어 칸은 비어 있다(소싱을 누를 때 AI가 채운다)
    expect(within(query).getByText('한국어 원문')).toBeInTheDocument();
    expect(within(query).getByText('아식스 젤카야노14')).toBeInTheDocument();
    const input = within(query).getByLabelText('라쿠텐 검색어');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', QUERY_PLACEHOLDER);
    expect(within(query).getByText(AUTO_CONVERT_CAPTION)).toBeInTheDocument();
    expect(within(query).queryByRole('button', { name: '일본어로 바꾸기' })).toBeNull();
    // 한글을 적으면 '여기 쓴 한글은 쓰지 않는다'는 안내, 일본어·영문이면 안내 없음
    await userEvent.type(input, '아식스');
    expect(within(query).getByText(KEYWORD_HANGUL_HINT)).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'asics GEL-KAYANO 14');
    expect(within(query).queryByText(KEYWORD_HANGUL_HINT)).toBeNull();
    expect(within(query).getByText('위 · 여성신발', { exact: false })).toBeInTheDocument();
  });

  it("'이 검색어로 소싱': 칸이 비어 있으면 먼저 AI가 일본어로 바꾸고(원문 그대로 보이는 채 '일본어로 바꾸는 중…'), 바꾼 검색어로 여정을 만들어 ②로 간다", async () => {
    const { api } = setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.on('POST /keywords/102/rakuten-query-conversions', async () => {
      await gate;
      return jsonResponse({
        keywordId: 102,
        keyword: '아디다스 삼바',
        rakutenQuery: 'アディダス サンバ',
        engineCode: 'CLAUDE',
        model: 'sonnet',
      });
    });
    api.on('POST /candidates', () => jsonResponse({ id: 12 }, 201));
    api.on('POST /candidates/12/steps/SOURCING/runs', () =>
      errorResponse(422, 'INVALID_STEP_CODE', '이 단계는 여기서 실행하거나 고칠 수 없습니다.'),
    );
    const { router } = await renderKeywords();
    await userEvent.click(await screen.findByRole('radio', { name: '아디다스 삼바 고르기' }));
    const query = screen.getByRole('region', { name: '라쿠텐 검색어 확인' });
    const go = await within(query).findByRole('button', { name: /이 검색어로 소싱/ });
    await waitFor(() => expect(go).toBeEnabled());
    // 눌러야 돈다 — 키워드를 고른 것만으로는 AI를 부르지 않는다
    expect(requestsTo(api, 'POST', '/keywords/102/rakuten-query-conversions')).toHaveLength(0);

    await userEvent.click(go);
    const busy = await within(query).findByRole('button', { name: /일본어로 바꾸는 중/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(
      within(query).getByText(/^AI가 '아디다스 삼바'를 일본어 검색어로 바꾸는 중입니다/),
    ).toBeInTheDocument();
    expect(within(query).getByText('아디다스 삼바')).toBeInTheDocument();
    expect(requestsTo(api, 'POST', '/candidates')).toHaveLength(0);

    release();
    await waitFor(() => expect(router.state.location.pathname).toBe('/candidates/12/sourcing'));
    expect(requestsTo(api, 'POST', '/keywords/102/rakuten-query-conversions')).toHaveLength(1);
    expect(await requestsTo(api, 'POST', '/candidates')[0]!.clone().json()).toEqual({
      creationPath: 'KEYWORD',
      sourceKeywordId: 102,
      rakutenQuery: 'アディダス サンバ',
    });
    expect(requestsTo(api, 'POST', '/candidates/12/steps/SOURCING/runs')).toHaveLength(1);
  });

  it('일본어·영문을 직접 적었으면 AI를 부르지 않고 그대로 쓴다. 한글이면 적은 한글은 버리고 AI가 고른 키워드를 바꾼다', async () => {
    const { api } = setup();
    api.on('POST /candidates', () => jsonResponse({ id: 13 }, 201));
    api.on('POST /candidates/13/steps/SOURCING/runs', () =>
      errorResponse(422, 'INVALID_STEP_CODE', '이 단계는 여기서 실행하거나 고칠 수 없습니다.'),
    );
    api.on('POST /keywords/102/rakuten-query-conversions', () =>
      jsonResponse({
        keywordId: 102,
        keyword: '아디다스 삼바',
        rakutenQuery: 'アディダス サンバ',
        engineCode: 'CLAUDE',
        model: 'sonnet',
      }),
    );
    const { router } = await renderKeywords();
    await userEvent.click(await screen.findByRole('radio', { name: '아디다스 삼바 고르기' }));
    const query = screen.getByRole('region', { name: '라쿠텐 검색어 확인' });
    const input = within(query).getByLabelText('라쿠텐 검색어');
    await waitFor(() =>
      expect(within(query).getByRole('button', { name: /이 검색어로 소싱/ })).toBeEnabled(),
    );
    await userEvent.type(input, 'adidas Samba OG');
    await userEvent.click(within(query).getByRole('button', { name: /이 검색어로 소싱/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/candidates/13/sourcing'));
    expect(requestsTo(api, 'POST', '/keywords/102/rakuten-query-conversions')).toHaveLength(0);
    expect(await requestsTo(api, 'POST', '/candidates')[0]!.clone().json()).toMatchObject({
      rakutenQuery: 'adidas Samba OG',
    });
  });

  it('AI가 일본어로 바꾸지 못하면(502) 서버 문구를 보이고 여정을 만들지 않는다. 다시 누를 수 있다', async () => {
    const { api } = setup();
    api.on('POST /keywords/102/rakuten-query-conversions', () =>
      errorResponse(502, 'AI_CALL_FAILED', 'AI가 검색어를 만들지 못했습니다. 다시 눌러 주세요.'),
    );
    await renderKeywords();
    await userEvent.click(await screen.findByRole('radio', { name: '아디다스 삼바 고르기' }));
    const query = screen.getByRole('region', { name: '라쿠텐 검색어 확인' });
    await waitFor(() =>
      expect(within(query).getByRole('button', { name: /이 검색어로 소싱/ })).toBeEnabled(),
    );
    await userEvent.click(within(query).getByRole('button', { name: /이 검색어로 소싱/ }));
    expect(await within(query).findByRole('alert')).toHaveTextContent(
      'AI가 검색어를 만들지 못했습니다. 다시 눌러 주세요.',
    );
    expect(requestsTo(api, 'POST', '/candidates')).toHaveLength(0);
    expect(within(query).getByRole('button', { name: /이 검색어로 소싱/ })).toBeEnabled();
    // 다시 누르면 다시 부른다
    await userEvent.click(within(query).getByRole('button', { name: /이 검색어로 소싱/ }));
    await waitFor(() =>
      expect(requestsTo(api, 'POST', '/keywords/102/rakuten-query-conversions')).toHaveLength(2),
    );
  });

  it('키워드는 하나만 골라진다: 다른 줄을 고르면 고른 줄이 바뀌고(취소 요청 없음), 같은 줄을 다시 눌러도 요청이 없다', async () => {
    const { api } = setup();
    await renderKeywords();
    const query = screen.getByRole('region', { name: '라쿠텐 검색어 확인' });
    const radios = async () =>
      (await screen.findAllByRole('radio', { name: /^.+ 고르기$/ })).filter(
        (r) => r.getAttribute('name') === 'keyword-pick',
      );
    expect(await radios()).toHaveLength(10);
    expect((await radios()).filter((r) => (r as HTMLInputElement).checked)).toHaveLength(0);
    // 글자 열에 '동작' 열·'검색어로 쓰기' 버튼은 없다(고르기와 합쳤다, D-33)
    expect(screen.queryByRole('columnheader', { name: '동작' })).toBeNull();
    expect(screen.queryByRole('button', { name: '검색어로 쓰기' })).toBeNull();

    const first = screen.getByRole('radio', { name: '뉴발란스 530 고르기' });
    const second = screen.getByRole('radio', { name: '아디다스 삼바 고르기' });
    await userEvent.click(first);
    await waitFor(() => expect(first).toBeChecked());
    await waitFor(() => expect(within(query).getByText('뉴발란스 530')).toBeInTheDocument());
    expect((await radios()).filter((r) => (r as HTMLInputElement).checked)).toEqual([first]);
    expect(screen.getAllByText('고름')).toHaveLength(1);

    await userEvent.click(second);
    await waitFor(() => expect(second).toBeChecked());
    await waitFor(() => expect(within(query).getByText('아디다스 삼바')).toBeInTheDocument());
    expect(first).not.toBeChecked();
    expect((await radios()).filter((r) => (r as HTMLInputElement).checked)).toEqual([second]);
    // 앞서 고른 줄은 서버에 고른 시각이 남아 있어도(승인 이력) 고른 줄로 보이지 않는다
    expect(screen.getAllByText('고름')).toHaveLength(1);
    expect(
      screen.getByRole('radio', { name: '아디다스 삼바 고르기' }).closest('tr'),
    ).toHaveTextContent('고름');
    expect(
      screen.getByRole('radio', { name: '뉴발란스 530 고르기' }).closest('tr'),
    ).not.toHaveTextContent('고름');

    // 같은 줄을 다시 눌러도 요청이 없다
    await userEvent.click(second);
    expect(requestsTo(api, 'PUT', '/keywords/102/selection')).toHaveLength(1);
    // 되돌아가면 앞서 고른 줄이 다시 고른 줄이 된다
    await userEvent.click(first);
    await waitFor(() => expect(first).toBeChecked());
    expect(second).not.toBeChecked();
    expect(requestsTo(api, 'PUT', '/keywords/100/selection')).toHaveLength(2);
    // 취소(DELETE)는 부르지 않는다
    expect(api.requests.filter((r) => r.method === 'DELETE')).toHaveLength(0);
  });

  it('새로고침해도 같은 줄이 고른 줄이다(묶음 조회의 selectedKeyword — 가장 늦게 고른 하나)', async () => {
    const { state } = setup();
    // 예전에 여러 개를 골라 둔 묶음: 가장 늦게 고른 아디다스 삼바가 고른 줄이다
    state.picks.set(100, Date.parse('2026-09-24T05:00:00.000Z'));
    state.picks.set(102, Date.parse('2026-09-24T06:00:00.000Z'));
    state.picks.set(101, Date.parse('2026-09-24T05:30:00.000Z'));
    const first = await renderKeywords();
    expect(await screen.findByRole('radio', { name: '아디다스 삼바 고르기' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '뉴발란스 530 고르기' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: '아식스 젤카야노14 고르기' })).not.toBeChecked();
    const query = screen.getByRole('region', { name: '라쿠텐 검색어 확인' });
    await waitFor(() => expect(within(query).getByText('아디다스 삼바')).toBeInTheDocument());
    expect(screen.getAllByText('고름')).toHaveLength(1);

    // 다른 줄을 고르고 화면을 닫았다 다시 열면(새로고침) 그 줄이 고른 줄이다
    await userEvent.click(screen.getByRole('radio', { name: '뉴발란스 530 고르기' }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: '뉴발란스 530 고르기' })).toBeChecked(),
    );
    first.unmount();
    await renderKeywords();
    expect(await screen.findByRole('radio', { name: '뉴발란스 530 고르기' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '아디다스 삼바 고르기' })).not.toBeChecked();
    expect(screen.getAllByText('고름')).toHaveLength(1);
  });

  it('고른 키워드가 이 쪽·이 분야에 없어도 검색어 확인에는 보이고, 표에는 고른 줄이 없다', async () => {
    const { api } = setup();
    const elsewhere = rankedKeyword({
      id: 300,
      cid: '50000174',
      rank: 57,
      keyword: '살로몬 스피드크로스',
      selectedAt: '2026-09-24T06:00:00.000Z',
    });
    api.on(`GET /keyword-snapshots/${SNAPSHOT_ID}`, () =>
      jsonResponse(keywordSnapshotDetail({ selectedKeyword: elsewhere })),
    );
    await renderKeywords();
    const query = screen.getByRole('region', { name: '라쿠텐 검색어 확인' });
    await waitFor(() => expect(within(query).getByText('살로몬 스피드크로스')).toBeInTheDocument());
    expect(within(query).getByText('위 · 남성신발', { exact: false })).toBeInTheDocument();
    expect(within(query).getByRole('button', { name: /이 검색어로 소싱/ })).toBeEnabled();
    await screen.findByRole('radio', { name: '뉴발란스 530 고르기' });
    expect(
      screen
        .getAllByRole('radio', { name: /^.+ 고르기$/ })
        .filter((r) => (r as HTMLInputElement).checked),
    ).toHaveLength(0);
  });

  it('줄마다 이름이 있는 라디오 묶음이고, 방향키는 초점만 옮기며 스페이스·엔터로 고른다(방향키만으로는 고르지 않는다)', async () => {
    const { api } = setup();
    await renderKeywords();
    const radios = (await screen.findAllByRole('radio', {
      name: /^.+ 고르기$/,
    })) as HTMLInputElement[];
    expect(radios.map((r) => r.name)).toEqual(Array(10).fill('keyword-pick'));
    expect(radios[0]).toHaveAccessibleName('뉴발란스 530 고르기');

    radios[0]!.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(radios[1]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{ArrowUp}{ArrowUp}');
    expect(radios[0]).toHaveFocus();
    // 맨 앞에서 위로 가면 맨 끝으로 돌아간다
    await userEvent.keyboard('{ArrowUp}');
    expect(radios[9]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(radios[0]).toHaveFocus();
    // 줄을 지나쳐도 고르지 않는다 — G1 기록이 줄마다 생기지 않는다
    expect(radios.every((r) => !r.checked)).toBe(true);
    expect(requestsTo(api, 'PUT', '/keywords/100/selection')).toHaveLength(0);
    expect(api.requests.filter((r) => r.method === 'PUT')).toHaveLength(0);

    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(radios[2]).toHaveFocus();
    await userEvent.keyboard(' ');
    await waitFor(() => expect(radios[2]).toBeChecked());
    expect(requestsTo(api, 'PUT', '/keywords/102/selection')).toHaveLength(1);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(radios[3]).toBeChecked());
    expect(radios[2]).not.toBeChecked();
    expect(api.requests.filter((r) => r.method === 'PUT')).toHaveLength(2);
  });

  it('응답을 기다리는 동안에도 누른 줄이 바로 고른 줄로 보이고, 검색어 확인은 응답이 온 뒤에 바뀐다', async () => {
    const { api } = setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const put = api.requests;
    api.on('PUT /keywords/100/selection', async () => {
      await gate;
      return jsonResponse(rankedKeyword({ id: 100, selectedAt: '2026-09-24T05:00:01.000Z' }));
    });
    api.on(`GET /keyword-snapshots/${SNAPSHOT_ID}`, () =>
      jsonResponse(
        keywordSnapshotDetail({
          selectedKeyword: released
            ? rankedKeyword({ id: 100, selectedAt: '2026-09-24T05:00:01.000Z' })
            : null,
        }),
      ),
    );
    let released = false;
    await renderKeywords();
    const radio = await screen.findByRole('radio', { name: '뉴발란스 530 고르기' });
    await userEvent.click(radio);
    expect(radio).toBeChecked();
    const query = screen.getByRole('region', { name: '라쿠텐 검색어 확인' });
    expect(within(query).getByText('G1 키워드 선택 · 확인 필요')).toBeInTheDocument();
    expect(put.filter((r) => r.method === 'PUT')).toHaveLength(1);
    released = true;
    release();
    await waitFor(() =>
      expect(within(query).getByText('G1 키워드 선택 · 통과')).toBeInTheDocument(),
    );
    expect(radio).toBeChecked();
  });

  it('고르기가 실패하면(409) 오류를 보이고 앞서 고른 줄이 그대로 고른 줄이다', async () => {
    const { api } = setup();
    api.on('PUT /keywords/103/selection', () =>
      errorResponse(409, 'KEYWORD_EXCLUDED', '아동화로 빠진 키워드는 고를 수 없습니다.'),
    );
    await renderKeywords();
    await userEvent.click(await screen.findByRole('radio', { name: '뉴발란스 530 고르기' }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: '뉴발란스 530 고르기' })).toBeChecked(),
    );
    await userEvent.click(screen.getByRole('radio', { name: '오니츠카타이거 멕시코66 고르기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '아동화로 빠진 키워드는 고를 수 없습니다.',
    );
    expect(screen.getByRole('radio', { name: '오니츠카타이거 멕시코66 고르기' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: '뉴발란스 530 고르기' })).toBeChecked();
  });

  it("'이 검색어로 소싱' → 여정 만들기(KEYWORD) → ② 실행(SOURCING) → /candidates/:id/sourcing", async () => {
    const { api } = setup();
    api.on('POST /candidates', () => jsonResponse({ id: 12 }, 201));
    api.on('POST /candidates/12/steps/SOURCING/runs', () =>
      errorResponse(422, 'INVALID_STEP_CODE', '이 단계는 여기서 실행하거나 고칠 수 없습니다.'),
    );
    const { router } = await renderKeywords();
    await userEvent.click(await screen.findByRole('radio', { name: '아디다스 삼바 고르기' }));
    const query = screen.getByRole('region', { name: '라쿠텐 검색어 확인' });
    await waitFor(() =>
      expect(within(query).getByRole('button', { name: /이 검색어로 소싱/ })).toBeEnabled(),
    );
    const input = within(query).getByLabelText('라쿠텐 검색어');
    await userEvent.clear(input);
    await userEvent.type(input, 'アディダス サンバ');
    await userEvent.click(within(query).getByRole('button', { name: /이 검색어로 소싱/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/candidates/12/sourcing'));
    const created = requestsTo(api, 'POST', '/candidates');
    expect(await created[0]!.clone().json()).toEqual({
      creationPath: 'KEYWORD',
      sourceKeywordId: 102,
      rakutenQuery: 'アディダス サンバ',
    });
    expect(requestsTo(api, 'POST', '/candidates/12/steps/SOURCING/runs')).toHaveLength(1);
  });

  it("'이 검색어로 소싱'을 화면이 다시 그려지기 전에 두 번 눌러도 여정은 1건만 만들고 ②로 간다", async () => {
    const { api } = setup();
    let created = 0;
    api.on('POST /candidates', () => {
      created += 1;
      return jsonResponse({ id: 10 + created }, 201);
    });
    api.on('POST /candidates/11/steps/SOURCING/runs', () =>
      errorResponse(422, 'INVALID_STEP_CODE', '이 단계는 여기서 실행하거나 고칠 수 없습니다.'),
    );
    api.on('POST /keywords/102/rakuten-query-conversions', () =>
      jsonResponse({
        keywordId: 102,
        keyword: '아디다스 삼바',
        rakutenQuery: 'アディダス サンバ',
        engineCode: 'CLAUDE',
        model: 'sonnet',
      }),
    );
    const { router } = await renderKeywords();
    await userEvent.click(await screen.findByRole('radio', { name: '아디다스 삼바 고르기' }));
    const query = screen.getByRole('region', { name: '라쿠텐 검색어 확인' });
    await waitFor(() =>
      expect(within(query).getByRole('button', { name: /이 검색어로 소싱/ })).toBeEnabled(),
    );
    const go = within(query).getByRole('button', { name: /이 검색어로 소싱/ });
    // 더블클릭: 요청 상태가 화면에 닿기 전(버튼이 아직 켜져 있을 때)에 클릭이 연달아 온다
    fireEvent.click(go);
    fireEvent.click(go);
    await waitFor(() => expect(router.state.location.pathname).toBe('/candidates/11/sourcing'));
    expect(requestsTo(api, 'POST', '/keywords/102/rakuten-query-conversions')).toHaveLength(1);
    expect(requestsTo(api, 'POST', '/candidates')).toHaveLength(1);
    expect(requestsTo(api, 'POST', '/candidates/11/steps/SOURCING/runs')).toHaveLength(1);
  });

  it("disabledReasonCode가 EXTERNAL_CALL_COOLDOWN이면 '수집'이 꺼지고 쉼이 끝나는 시각이 보인다(붙여넣기는 열린다)", async () => {
    setup(
      collectionStatus({
        blockedUntil: '2026-09-25T00:30:00.000Z',
        disabledReasonCode: 'EXTERNAL_CALL_COOLDOWN',
        lastStatus: 'ABORTED',
        lastAbortReason: 'HTTP_429',
      }),
    );
    await renderKeywords();
    const collect = screen.getByRole('region', { name: '데이터랩 수집' });
    const button = await within(collect).findByRole('button', { name: '수집' });
    await waitFor(() => expect(button).toBeDisabled());
    expect(
      within(collect).getByText(
        '데이터랩이 요청을 막아 09-25 09:30까지 쉽니다. 그동안은 순위 붙여넣기를 써 주세요.',
      ),
    ).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-describedby');
    expect(await screen.findByRole('region', { name: '순위 붙여넣기' })).toBeInTheDocument();
  });

  it("'수집' → 202, 진행 알림으로 ProgressBar가 '3/10 페이지'가 되고, 구조 변경 의심 중단이면 경고와 붙여넣기가 열린다", async () => {
    const { api } = setup();
    api.on('POST /keyword-snapshots', () =>
      jsonResponse(
        {
          keywordSnapshotId: SNAPSHOT_ID,
          status: 'RUNNING',
          rankLimit: 100,
          requestedCids: ['50000173', '50000174'],
        },
        202,
      ),
    );
    await renderKeywords({ EventSourceImpl: FakeEventSource });
    const collect = screen.getByRole('region', { name: '데이터랩 수집' });
    await userEvent.click(await within(collect).findByRole('button', { name: '수집' }));
    await waitFor(() => expect(requestsTo(api, 'POST', '/keyword-snapshots')).toHaveLength(1));
    expect(await requestsTo(api, 'POST', '/keyword-snapshots')[0]!.clone().json()).toEqual({
      method: 'BUTTON',
      rankLimit: 100,
    });
    expect(await within(collect).findByText('0/10 페이지')).toBeInTheDocument();

    const es = FakeEventSource.latest();
    act(() => {
      es.open();
      es.emit('keyword-collection.progress', {
        keywordSnapshotId: SNAPSHOT_ID,
        cid: '50000173',
        page: 3,
        pagesPerCid: 5,
        requestsDone: 3,
        requestsTotal: 10,
      });
    });
    expect(await within(collect).findByText('3/10 페이지')).toBeInTheDocument();
    // 보드 '10/10 페이지 · 20 초': 예상 소요(요청 10 × 간격 2초)
    expect(within(collect).getByText('· 20초', { exact: false })).toBeInTheDocument();
    expect(within(collect).getByText('여성신발 3/5 · 남성신발 0/5')).toBeInTheDocument();
    expect(within(collect).getByRole('progressbar', { name: '수집 진행률' })).toHaveAttribute(
      'aria-valuenow',
      '3',
    );
    expect(screen.queryByRole('region', { name: '순위 붙여넣기' })).toBeNull();

    act(() => {
      es.emit('keyword-collection.aborted', {
        keywordSnapshotId: SNAPSHOT_ID,
        abortReason: 'NO_RANKS_KEY',
        httpStatus: null,
        structureChangeSuspected: true,
        blockedUntil: null,
      });
    });
    const alert = await within(collect).findByRole('alert');
    expect(alert).toHaveTextContent('데이터랩 구조 변경 의심');
    expect(within(collect).getByText('중단')).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: '순위 붙여넣기' })).toBeInTheDocument();
  });

  it("'제외됨' 필터를 누르면 excluded=true로 다시 부르고 아동 키워드만 보인다(고를 수 없다)", async () => {
    const { api } = setup();
    await renderKeywords();
    await screen.findByRole('radio', { name: '뉴발란스 530 고르기' });
    const filters = screen.getByRole('group', { name: '목록 거르기' });
    expect(within(filters).getByRole('button', { name: '전체 97' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(filters).getByRole('button', { name: '제외됨 1' }));
    await waitFor(() =>
      expect(
        requestsTo(api, 'GET', `/keyword-snapshots/${SNAPSHOT_ID}/keywords`).some((r) => {
          const q = new URL(r.url).searchParams;
          return q.get('excluded') === 'true' && q.get('size') === '10';
        }),
      ).toBe(true),
    );
    const childCell = await screen.findByRole('cell', { name: /키즈 운동화/ });
    expect(within(childCell.closest('tr')!).getByText('아동용이라 제외')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '키즈 운동화 고르기' })).toBeNull();
    expect(screen.queryByRole('radio', { name: /^.+ 고르기$/ })).toBeNull();
  });

  it("'단어 더하기' 성공 뒤 아동 단어 목록을 다시 읽는다. 같은 단어면 오류를 보인다", async () => {
    const { api, state } = setup();
    api.on('POST /child-keyword-terms', async (req) => {
      const { term } = (await req.clone().json()) as { term: string };
      if (term === '키즈') {
        return errorResponse(409, 'CHILD_TERM_ALREADY_EXISTS', '이미 있는 아동 단어입니다.');
      }
      state.terms.push(term);
      return jsonResponse({ term, builtIn: false, settingsSnapshotId: 9 }, 201);
    });
    await renderKeywords();
    const panel = screen.getByRole('region', { name: '아동용 단어' });
    await within(panel).findByText('ベビー');
    const listGets = () => requestsTo(api, 'GET', '/child-keyword-terms').length;
    const before = listGets();

    await userEvent.click(within(panel).getByRole('button', { name: '단어 더하기' }));
    await userEvent.type(within(panel).getByLabelText('더할 단어'), '키즈');
    await userEvent.click(within(panel).getByRole('button', { name: '더하기' }));
    expect(await within(panel).findByText('이미 있는 아동 단어입니다.')).toBeInTheDocument();

    await userEvent.clear(within(panel).getByLabelText('더할 단어'));
    await userEvent.type(within(panel).getByLabelText('더할 단어'), '유아');
    await userEvent.click(within(panel).getByRole('button', { name: '더하기' }));
    expect(await within(panel).findByText('유아')).toBeInTheDocument();
    expect(listGets()).toBeGreaterThan(before);
    expect(
      within(panel).getByText("'유아' 단어를 더했습니다. 다음 수집·붙여넣기부터 뺍니다."),
    ).toBeInTheDocument();
  });

  it("순위 붙여넣기: 분야 기본 '모름'으로 보내고, 줄 오류(422 IMPORT_PARSE_FAILED)는 줄별로 보인다", async () => {
    const { api } = setup();
    let calls = 0;
    api.on('POST /keyword-snapshots', () => {
      calls += 1;
      if (calls === 1) {
        return errorResponse(
          422,
          'IMPORT_PARSE_FAILED',
          '파일(또는 붙여 넣은 글)에서 필요한 열이나 형식을 찾지 못했습니다.',
          {
            fieldErrors: [
              { field: 'text[2]', message: '2번째 줄: 1번째 줄과 같은 순위(1)입니다.' },
            ],
          },
        );
      }
      return jsonResponse(
        keywordSnapshotDetail({ id: 8, method: 'PASTE', requestedCids: [] }),
        201,
      );
    });
    api.on('GET /keyword-snapshots/8', () =>
      jsonResponse(keywordSnapshotDetail({ id: 8, method: 'PASTE', requestedCids: [] })),
    );
    api.on('GET /keyword-snapshots/8/keywords', () => jsonResponse(rankedKeywordPage([], 0)));
    await renderKeywords();
    await userEvent.click(screen.getByRole('button', { name: '순위 붙여넣기' }));
    const panel = await screen.findByRole('region', { name: '순위 붙여넣기' });
    expect(within(panel).getByRole('radio', { name: '모름' })).toBeChecked();
    expect(
      within(panel).getByText('모름이면 여정 성별은 ② 소싱에서 라쿠텐 장르·상품명으로 정합니다.'),
    ).toBeInTheDocument();
    const make = within(panel).getByRole('button', { name: '목록 만들기' });
    expect(make).toBeDisabled();
    await userEvent.type(
      within(panel).getByLabelText('데이터랩 화면에서 복사한 순위와 키워드'),
      '1 뉴발란스 530{enter}1 아식스',
    );
    await userEvent.click(make);
    expect(
      await within(panel).findByText('2번째 줄: 1번째 줄과 같은 순위(1)입니다.'),
    ).toBeInTheDocument();
    const sent = requestsTo(api, 'POST', '/keyword-snapshots');
    expect(await sent[0]!.clone().json()).toEqual({
      method: 'PASTE',
      text: '1 뉴발란스 530\n1 아식스',
      cid: null,
    });
    await userEvent.click(within(panel).getByRole('button', { name: '목록 만들기' }));
    expect(await screen.findByRole('heading', { name: '분야 모름 키워드' })).toBeInTheDocument();
  });
});
