import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { FakeEventSource } from '@/test/fakeEventSource';
import {
  aiCliCheck,
  aiCliCheckLatestList,
  aiCliCheckPage,
  aiEngineSettings,
  boardChecks,
} from '@/test/fixtures/aiEngine';
import { callUsageList } from '@/test/fixtures/callUsage';
import { storageUsage } from '@/test/fixtures/storageUsage';
import { renderRoute } from '@/test/renderRoute';

const AGY_TEXT = 'gemini-3.8-flash-medium';

const accepted = (body: { engineCodes?: string[]; smokeTest: boolean; trigger: string }) =>
  jsonResponse(
    {
      engineCodes: body.engineCodes ?? ['CLAUDE', 'AGY', 'CODEX'],
      smokeTest: body.smokeTest,
      trigger: body.trigger,
      status: 'RUNNING',
      acceptedAt: new Date().toISOString(),
    },
    202,
  );

/** 가짜 서버 상태: 최신 점검은 테스트가 바꾼다 */
function setup(latest = aiCliCheckLatestList()) {
  const state = { latest };
  const api = stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList()),
    'GET /settings/ai-engine': () => jsonResponse(aiEngineSettings()),
    'GET /ai-cli-checks/latest': () => jsonResponse(state.latest),
    'GET /ai-cli-checks': () => jsonResponse(aiCliCheckPage()),
    'GET /storage-usage': () => jsonResponse(storageUsage()),
    'POST /ai-cli-checks': async (req) =>
      accepted((await req.clone().json()) as { smokeTest: boolean; trigger: string }),
  });
  return { api, state };
}

async function renderPage(path = '/settings/ai-engine') {
  const view = renderRoute(path, { EventSourceImpl: FakeEventSource });
  await screen.findByRole('heading', { level: 1, name: 'AI 엔진' });
  await screen.findByRole('radiogroup', { name: 'AI 엔진 고르기' });
  return view;
}

const checkPosts = (api: ReturnType<typeof stubApi>) =>
  api.requests.filter(
    (r) => r.method === 'POST' && new URL(r.url).pathname === '/api/v1/ai-cli-checks',
  );
const bodies = async (requests: Request[]) =>
  Promise.all(requests.map(async (r) => (await r.clone().json()) as Record<string, unknown>));
const card = (engine: string) =>
  screen.getByRole('radiogroup').querySelector<HTMLElement>(`[data-engine="${engine}"]`)!;
const saveBar = () => screen.getByRole('region', { name: '저장' });

describe('AI 엔진 화면(SCR-13, P1-11 규칙 11)', () => {
  it('카드 3개가 순서대로, radiogroup 안에 라디오 3개(name=ai-engine)', async () => {
    setup();
    await renderPage();
    expect(screen.queryByText('SCR-13')).not.toBeInTheDocument(); // 화면 ID 칩 없음(D-27)
    const group = screen.getByRole('radiogroup', { name: 'AI 엔진 고르기' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['CLAUDE', 'AGY', 'CODEX']);
    for (const r of radios) expect(r).toHaveAttribute('name', 'ai-engine');
    const names = within(group)
      .getAllByRole('region')
      .map((section) => section.getAttribute('data-engine'));
    expect(names).toEqual(['CLAUDE', 'AGY', 'CODEX']);
    expect(within(card('CLAUDE')).getByRole('radio')).toBeChecked();
    // 보드 문구: 안내 띠 2개, 약관 한 줄, 이력 표
    expect(
      screen.getByText(
        '바꾸면 새로 시작하는 AI 단계부터 적용됩니다. 진행 중인 실행과 이미 만든 결과는 그대로입니다.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "선택한 엔진을 쓸 수 없으면 다른 엔진으로 넘어가지 않고 멈춥니다. 멈춘 단계에는 'AI 엔진 설정으로' 링크가 붙습니다.",
      ),
    ).toBeInTheDocument();
    expect(
      within(card('AGY')).getByText(
        '실험적(결과 품질 기준 미달). 본인 Google 계정 한도를 쓰며, Google 약관과 계정 책임은 본인에게 있습니다. 사용자 MCP·규칙·플러그인도 함께 켜집니다(끌 수 없음).',
      ),
    ).toBeInTheDocument();
    // M0 S7: AGY는 기준 미달이라 '실험적'(CODEX는 미측정), CLAUDE는 아니다
    expect(within(card('AGY')).getByText('실험적')).toBeInTheDocument();
    expect(within(card('CLAUDE')).queryByText('실험적')).toBeNull();
    expect(screen.getByRole('table', { name: '최근 점검 이력' })).toBeInTheDocument();
  });

  it("미설치 Codex: 라디오·[연결 테스트]·모델 칸이 꺼지고 '설치되지 않아 고를 수 없습니다'. 카드는 숨기지 않는다", async () => {
    setup();
    await renderPage();
    const codex = within(card('CODEX'));
    expect(codex.getByRole('radio')).toBeDisabled();
    const test = codex.getByRole('button', { name: '연결 테스트' });
    expect(test).toBeDisabled();
    expect(test).toHaveAccessibleDescription('설치되지 않아 고를 수 없습니다');
    expect(codex.getByLabelText('텍스트 모델')).toBeDisabled();
    expect(codex.getByText('설치 안 됨')).toBeInTheDocument();
    expect(codex.getByText('실험적')).toBeInTheDocument();
    expect(codex.getByText('npm install -g @openai/codex')).toBeInTheDocument();
  });

  it("저장된 Claude Code에 '사용 중', Antigravity CLI를 고르면 '저장 전'", async () => {
    setup();
    await renderPage();
    expect(within(card('CLAUDE')).getByText('사용 중')).toBeInTheDocument();
    expect(within(card('AGY')).queryByText('저장 전')).toBeNull();
    await userEvent.click(within(card('AGY')).getByRole('radio'));
    expect(within(card('AGY')).getByText('저장 전')).toBeInTheDocument();
    expect(within(card('CLAUDE')).getByText('사용 중')).toBeInTheDocument();
  });

  it("처음 그릴 때 감지 POST는 { smokeTest: false, trigger: 'MANUAL' } 하나, 연결 테스트(smokeTest: true)는 0건", async () => {
    const { api } = setup();
    await renderPage();
    await waitFor(() => expect(checkPosts(api)).toHaveLength(1));
    expect(await bodies(checkPosts(api))).toEqual([{ smokeTest: false, trigger: 'MANUAL' }]);
    // 모델을 바꿔도 스스로 연결 테스트를 보내지 않는다(R7)
    await userEvent.selectOptions(within(card('CLAUDE')).getByLabelText('텍스트 모델'), 'opus');
    expect((await bodies(checkPosts(api))).filter((b) => b.smokeTest === true)).toHaveLength(0);
  });

  it('Antigravity CLI [연결 테스트] 본문: 그 엔진만·고른 텍스트 모델·MANUAL', async () => {
    const { api } = setup();
    await renderPage();
    await userEvent.click(within(card('AGY')).getByRole('button', { name: '연결 테스트' }));
    await waitFor(() => expect(checkPosts(api)).toHaveLength(2));
    expect((await bodies(checkPosts(api)))[1]).toEqual({
      engineCodes: ['AGY'],
      smokeTest: true,
      models: { AGY: AGY_TEXT },
      trigger: 'MANUAL',
    });
  });

  it("[연결 테스트]를 누르면 결과(SSE)가 올 때까지 그 카드 버튼이 '연결 테스트 중…'으로 돌고, 다른 점검 버튼은 잠긴다", async () => {
    const { api, state } = setup();
    await renderPage();
    const es = FakeEventSource.latest();
    act(() => es.open());
    await waitFor(() => expect(checkPosts(api)).toHaveLength(1));
    await userEvent.click(within(card('AGY')).getByRole('button', { name: '연결 테스트' }));
    await waitFor(() => expect(checkPosts(api)).toHaveLength(2));

    // 요청(202)이 끝나도 결과가 올 때까지 계속 '테스트 중'이다
    const testing = await within(card('AGY')).findByRole('button', { name: '연결 테스트 중…' });
    expect(testing).toBeDisabled();
    expect(testing).toHaveAttribute('aria-busy', 'true');
    expect(within(card('AGY')).getByText(/^테스트 중입니다/)).toBeInTheDocument();
    expect(within(card('CLAUDE')).getByRole('button', { name: '연결 테스트' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '다시 감지' })).toBeDisabled();

    // 서버: AGY 연결 테스트 행이 생기고 SSE가 온다
    state.latest = aiCliCheckLatestList({
      ...boardChecks(),
      AGY: aiCliCheck({
        id: 950,
        engineCode: 'AGY',
        trigger: 'MANUAL',
        model: AGY_TEXT,
        authStatus: 'UNKNOWN',
        checkedAt: new Date().toISOString(),
      }),
    });
    act(() =>
      es.emit('ai-cli-check.completed', {
        engineCode: 'AGY',
        installed: true,
        cliVersion: '1.2.9',
        authStatus: 'UNKNOWN',
        smokeStatus: 'PASSED',
        latencyMs: 9800,
        errorCode: null,
      }),
    );
    expect(await within(card('AGY')).findByRole('button', { name: '연결 테스트' })).toBeEnabled();
    expect(within(card('AGY')).queryByRole('button', { name: '연결 테스트 중…' })).toBeNull();
    expect(screen.getByRole('button', { name: '다시 감지' })).toBeEnabled();
  });

  it('[연결 테스트] 요청이 거절되면(409 등) 테스트 중 표시를 끄고 message를 보인다', async () => {
    const { api } = setup();
    await renderPage();
    await waitFor(() => expect(checkPosts(api)).toHaveLength(1));
    api.on('POST /ai-cli-checks', () =>
      errorResponse(409, 'ALREADY_IN_PROGRESS', '이미 점검이 진행 중입니다.'),
    );
    await userEvent.click(within(card('AGY')).getByRole('button', { name: '연결 테스트' }));
    expect(await within(saveBar()).findByRole('alert')).toHaveTextContent(
      '이미 점검이 진행 중입니다.',
    );
    expect(within(card('AGY')).getByRole('button', { name: '연결 테스트' })).toBeEnabled();
    expect(within(card('AGY')).queryByText(/^테스트 중입니다/)).toBeNull();
  });

  it('첫 실행 점검에서 오면(?from=first-run) 감지·연결 테스트 계기가 FIRST_RUN', async () => {
    const { api } = setup();
    await renderPage('/settings/ai-engine?from=first-run');
    await userEvent.click(within(card('CLAUDE')).getByRole('button', { name: '연결 테스트' }));
    await waitFor(() => expect(checkPosts(api)).toHaveLength(2));
    const sent = await bodies(checkPosts(api));
    expect(sent.map((b) => b.trigger)).toEqual(['FIRST_RUN', 'FIRST_RUN']);
  });

  it('카드 상태 문구: 설치·버전·지원 범위, 실행 파일, 로그인(확인 명령), 연결 테스트(칩·시간·시각·모델)', async () => {
    setup();
    await renderPage();
    const claude = within(card('CLAUDE'));
    expect(claude.getByText('설치됨')).toBeInTheDocument();
    expect(claude.getByText('2.1.269')).toBeInTheDocument();
    expect(claude.getByText('지원 범위 안')).toBeInTheDocument();
    expect(claude.getByText('~/.local/bin/claude')).toBeInTheDocument();
    expect(claude.getByText('로그인됨')).toBeInTheDocument();
    expect(claude.getByText('claude auth status')).toBeInTheDocument();
    expect(claude.getByText('통과')).toBeInTheDocument();
    expect(claude.getByText('12.7초')).toBeInTheDocument();
    const agy = within(card('AGY'));
    expect(agy.getByText('연결 테스트로 확인')).toBeInTheDocument();
    expect(agy.getByText('확인 명령이 없습니다')).toBeInTheDocument();
    expect(agy.getByText('테스트 안 함')).toBeInTheDocument();
    expect(agy.getByLabelText('텍스트 모델')).toHaveValue(AGY_TEXT);
    expect(agy.getByLabelText('비전 모델')).toHaveValue('gemini-3.8-flash-high');
  });

  it("맨 아래 '저장 공간'(D-25): 이력 다음 패널, 행 3개, 화면을 열 때 refresh 없이 한 번 읽는다", async () => {
    const { api } = setup();
    await renderPage();
    const storage = await screen.findByRole('region', { name: '저장 공간' });
    const history = screen.getByRole('region', { name: '최근 점검 이력' });
    expect(
      history.compareDocumentPosition(storage) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const table = await within(storage).findByRole('table', { name: '저장 공간' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('~/.gemini/antigravity-cli')).toBeInTheDocument();
    expect(
      within(table).getByText('앱은 지우지 않습니다. 필요하면 직접 정리하세요.'),
    ).toBeInTheDocument();
    const reads = api.requests.filter((r) => new URL(r.url).pathname === '/api/v1/storage-usage');
    expect(reads.map((r) => [r.method, new URL(r.url).search])).toEqual([['GET', '']]);
  });
});

describe('저장 흐름(규칙 11: BEFORE_SAVE 점검 → SSE → PUT)', () => {
  it('10분 안 통과 기록이 없으면 POST(BEFORE_SAVE) → SSE → PUT 순서', async () => {
    const { api, state } = setup();
    api.on('PUT /settings/ai-engine', () =>
      jsonResponse(aiEngineSettings({ selectedEngine: 'AGY' })),
    );
    await renderPage();
    const es = FakeEventSource.latest();
    act(() => es.open());
    await waitFor(() => expect(checkPosts(api)).toHaveLength(1));
    await userEvent.click(within(card('AGY')).getByRole('radio'));
    await userEvent.click(within(saveBar()).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(checkPosts(api)).toHaveLength(2));
    expect((await bodies(checkPosts(api)))[1]).toEqual({
      engineCodes: ['AGY'],
      smokeTest: true,
      models: { AGY: AGY_TEXT },
      trigger: 'BEFORE_SAVE',
    });
    expect(within(saveBar()).getByText('연결 테스트 중…')).toBeInTheDocument();
    // 저장 흐름 중에는 카드를 잠근다(테스트한 값과 저장할 값이 어긋나지 않게)
    expect(within(card('AGY')).getByLabelText('텍스트 모델')).toBeDisabled();
    expect(within(card('CLAUDE')).getByRole('radio')).toBeDisabled();
    expect(within(card('CLAUDE')).getByRole('button', { name: '연결 테스트' })).toBeDisabled();
    const puts = () => api.requests.filter((r) => r.method === 'PUT');
    expect(puts()).toHaveLength(0);

    // 서버: AGY 연결 테스트 통과 행이 생기고 SSE가 온다
    state.latest = aiCliCheckLatestList({
      ...boardChecks(),
      AGY: aiCliCheck({
        id: 900,
        engineCode: 'AGY',
        trigger: 'BEFORE_SAVE',
        model: AGY_TEXT,
        authStatus: 'UNKNOWN',
        checkedAt: new Date().toISOString(),
      }),
    });
    act(() =>
      es.emit('ai-cli-check.completed', {
        engineCode: 'AGY',
        installed: true,
        cliVersion: '1.2.9',
        authStatus: 'UNKNOWN',
        smokeStatus: 'PASSED',
        latencyMs: 9800,
        errorCode: null,
      }),
    );
    await waitFor(() => expect(puts()).toHaveLength(1));
    const order = api.requests
      .filter((r) => r.method !== 'GET')
      .map((r) => `${r.method} ${new URL(r.url).pathname}`);
    expect(order).toEqual([
      'POST /api/v1/ai-cli-checks',
      'POST /api/v1/ai-cli-checks',
      'PUT /api/v1/settings/ai-engine',
    ]);
    expect(await puts()[0]!.clone().json()).toEqual({
      selectedEngine: 'AGY',
      models: {
        CLAUDE: { text: 'sonnet', vision: 'sonnet' },
        AGY: { text: AGY_TEXT, vision: 'gemini-3.8-flash-high' },
        CODEX: { text: null, vision: null },
      },
    });
  });

  it('10분 안에 통과했으면 바로 PUT. 409 AI_ENGINE_NOT_VERIFIED면 message를 그대로 보인다', async () => {
    const message =
      'Antigravity CLI(gemini-3.8-flash-medium)으로 연결 테스트를 먼저 통과해 주세요. 통과한 지 10분이 지났으면 다시 해 주세요.';
    const { api } = setup(
      aiCliCheckLatestList({
        ...boardChecks(),
        AGY: aiCliCheck({
          engineCode: 'AGY',
          model: AGY_TEXT,
          authStatus: 'UNKNOWN',
          checkedAt: new Date().toISOString(),
        }),
      }),
    );
    api.on('PUT /settings/ai-engine', () =>
      errorResponse(409, 'AI_ENGINE_NOT_VERIFIED', message, {
        details: { engineCode: 'AGY', model: AGY_TEXT },
      }),
    );
    await renderPage();
    await waitFor(() => expect(checkPosts(api)).toHaveLength(1));
    await userEvent.click(within(card('AGY')).getByRole('radio'));
    expect(within(saveBar()).getByText('연결 테스트 통과')).toBeInTheDocument();
    await userEvent.click(within(saveBar()).getByRole('button', { name: '저장' }));
    expect(await within(saveBar()).findByRole('alert')).toHaveTextContent(message);
    expect(checkPosts(api)).toHaveLength(1);
  });

  it('저장 전 연결 테스트가 실패하면 PUT하지 않고 그 행의 안내를 보인다', async () => {
    const { api, state } = setup();
    await renderPage();
    const es = FakeEventSource.latest();
    act(() => es.open());
    await waitFor(() => expect(checkPosts(api)).toHaveLength(1));
    await userEvent.selectOptions(within(card('CLAUDE')).getByLabelText('텍스트 모델'), 'opus');
    await userEvent.click(within(saveBar()).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(checkPosts(api)).toHaveLength(2));
    state.latest = aiCliCheckLatestList({
      ...boardChecks(),
      CLAUDE: aiCliCheck({
        id: 901,
        trigger: 'BEFORE_SAVE',
        model: 'opus',
        smokeStatus: 'FAILED',
        errorCode: 'CONTRACT_FAILED',
        errorMessage: "답이 'OK'가 아닙니다.",
        checkedAt: new Date().toISOString(),
      }),
    });
    act(() =>
      es.emit('ai-cli-check.completed', {
        engineCode: 'CLAUDE',
        installed: true,
        cliVersion: '2.1.269',
        authStatus: 'OK',
        smokeStatus: 'FAILED',
        latencyMs: 1000,
        errorCode: 'CONTRACT_FAILED',
      }),
    );
    expect(await within(saveBar()).findByRole('alert')).toHaveTextContent("답이 'OK'가 아닙니다.");
    expect(api.requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
  });
});
