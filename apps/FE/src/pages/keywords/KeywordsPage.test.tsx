import { act, screen, waitFor, within } from '@testing-library/react';
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
  rankedKeywordPage,
  SNAPSHOT_ID,
} from '@/test/fixtures/keywords';
import { renderRoute } from '@/test/renderRoute';

type Status = ReturnType<typeof collectionStatus>;

/** 가짜 서버: 묶음 7(버튼 수집), 여성신발 10줄 + 아동 키워드 1줄. 고른 키워드는 PUT·DELETE로 바뀐다 */
function setup(status: Status = collectionStatus()) {
  const state = { status, selected: new Set<number>(), terms: [] as string[] };
  const rowsOf = (cid: string) =>
    keywordRows(cid).map((r) => ({
      ...r,
      selectedAt: state.selected.has(r.id) ? '2026-09-24T05:00:00.000Z' : null,
    }));
  const api = stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList()),
    'GET /keyword-snapshots': () => jsonResponse(keywordSnapshotPage()),
    [`GET /keyword-snapshots/${SNAPSHOT_ID}`]: () => jsonResponse(keywordSnapshotDetail()),
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
      state.selected.add(id);
      return jsonResponse(rowsOf('50000173').find((r) => r.id === id));
    });
    api.on(`DELETE /keywords/${id}/selection`, () => {
      state.selected.delete(id);
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
        '데이터랩 인기 검색어를 모아 소싱할 키워드를 고르고, 라쿠텐 검색어를 확인합니다.',
      ),
    ).toBeInTheDocument();
    const collect = screen.getByRole('region', { name: '데이터랩 수집' });
    expect(
      await within(collect).findByText('마지막 수집 13:30 · 출처 데이터랩 · 2초 간격 · 이상 없음'),
    ).toBeInTheDocument();
    expect(within(collect).getByText('500위는 요청 50회 · 약 100초')).toBeInTheDocument();
    expect(within(collect).getByRole('button', { name: '상위 100위' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(collect).getByLabelText('시작일')).toHaveAttribute('readonly');
    expect(await screen.findByRole('heading', { name: '여성신발 키워드' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '라쿠텐 검색어 확인' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '아동 단어' })).toBeInTheDocument();
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

  it("고른 키워드가 0개면 '이 검색어로 소싱'이 꺼져 있고, 하나 고르면 켜진다(G1)", async () => {
    const { api } = setup();
    await renderKeywords();
    const query = screen.getByRole('region', { name: '라쿠텐 검색어 확인' });
    const go = within(query).getByRole('button', { name: /이 검색어로 소싱/ });
    expect(go).toBeDisabled();
    expect(
      within(query).getByText('키워드 표에서 키워드를 하나 이상 고르면 켜집니다.'),
    ).toBeInTheDocument();
    expect(within(query).getByText('G1 키워드 선택 · 확인 필요')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('checkbox', { name: '아식스 젤카야노14' }));
    await waitFor(() => expect(requestsTo(api, 'PUT', '/keywords/101/selection')).toHaveLength(1));
    await waitFor(() =>
      expect(within(query).getByRole('button', { name: /이 검색어로 소싱/ })).toBeEnabled(),
    );
    expect(within(query).getByText('G1 키워드 선택 · 통과')).toBeInTheDocument();
    expect(within(query).getByLabelText('라쿠텐 검색어')).toHaveValue('아식스 젤카야노14');
    expect(within(query).getByText('위 · 여성신발', { exact: false })).toBeInTheDocument();
  });

  it("'이 검색어로 소싱' → 후보 만들기(KEYWORD) → ② 실행(SOURCING) → /candidates/:id/sourcing", async () => {
    const { api } = setup();
    api.on('POST /candidates', () => jsonResponse({ id: 12 }, 201));
    api.on('POST /candidates/12/steps/SOURCING/runs', () =>
      errorResponse(422, 'INVALID_STEP_CODE', '이 단계는 여기서 실행하거나 고칠 수 없습니다.'),
    );
    const { router } = await renderKeywords();
    const row = (await screen.findByRole('cell', { name: '아디다스 삼바' })).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: '검색어로 쓰기' }));
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
    await screen.findByRole('checkbox', { name: '뉴발란스 530' });
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
    expect(within(childCell.closest('tr')!).getByText('아동 단어')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '키즈 운동화' })).toBeNull();
    expect(screen.queryByRole('button', { name: '검색어로 쓰기' })).toBeNull();
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
    const panel = screen.getByRole('region', { name: '아동 단어' });
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
      within(panel).getByText('모름이면 후보 성별은 ② 소싱에서 라쿠텐 장르·상품명으로 정합니다.'),
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
