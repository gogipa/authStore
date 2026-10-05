import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETUP_WIZARD_SHOWN_KEY } from '@/features/guide';
import { errorResponse, jsonResponse, stubApi, type StubRoutes } from '@/test/apiStub';
import { aiCliCheck, aiCliCheckLatestList, aiCliCheckPage } from '@/test/fixtures/aiEngine';
import { callUsageList } from '@/test/fixtures/callUsage';
import { emptyProfile, filledProfile } from '@/test/fixtures/purchaseAgencyProfile';
import { registrationSwitch } from '@/test/fixtures/registration';
import { settingsView } from '@/test/fixtures/settings';
import { page } from '@/test/fixtures/stepEngine';
import { secretStatusList } from '@/test/fixtures/system';
import { renderRoute } from '@/test/renderRoute';

/**
 * D-30 설정 마법사를 화면을 가로질러 본다: 대시보드가 브라우저 세션(탭)마다 한 번 `/setup`을 여는 규칙(sessionStorage),
 * 예전 주소 `/welcome`, 대시보드 '시작 준비' 카드의 [설정 마법사] 입구, 보통 앱에는 체험 띠가 없는 것.
 * 마법사 화면 자체는 pages/setup, 설정·사용 안내 화면의 입구는 그 화면 테스트, 체험은 app/demo 테스트가 본다.
 */
afterEach(() => window.sessionStorage.clear());

const allDoneChecks = () =>
  aiCliCheckLatestList({
    CLAUDE: aiCliCheck(),
    AGY: aiCliCheck({ engineCode: 'AGY', cliVersion: '1.2.9', model: 'gemini-3.8-flash-high' }),
    CODEX: aiCliCheck({ engineCode: 'CODEX', installed: false, smokeStatus: 'SKIPPED' }),
  });

function stubDashboard(overrides: StubRoutes = {}) {
  return stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList()),
    'GET /settings': () => jsonResponse(settingsView()),
    'GET /candidates': () => jsonResponse(page([])),
    'GET /candidates/resume-target': () => new Response(null, { status: 204 }),
    'GET /candidate-steps': () => jsonResponse(page([])),
    'GET /secrets': () => jsonResponse(secretStatusList()),
    'GET /ai-cli-checks/latest': () => jsonResponse(allDoneChecks()),
    'GET /ai-cli-checks': () => jsonResponse(aiCliCheckPage()),
    'GET /purchase-agency-profile': () => jsonResponse(filledProfile()),
    'GET /registration-switch': () => jsonResponse(registrationSwitch(true)),
    ...overrides,
  });
}

const withTodo: StubRoutes = {
  'GET /secrets': () => jsonResponse(secretStatusList([])),
  'GET /purchase-agency-profile': () => jsonResponse(emptyProfile()),
};

const settle = () => new Promise((r) => setTimeout(r, 50));

describe('설정 마법사 자동 열기(F-GD-04, D-30 — 세션마다 한 번)', () => {
  it('이번 세션에서 처음이고 시작 준비에 할 일이 있으면 /setup으로 한 번 보낸다', async () => {
    window.sessionStorage.removeItem(SETUP_WIZARD_SHOWN_KEY);
    stubDashboard(withTodo);
    const { router } = renderRoute('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: '설정 마법사' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup');
    expect(window.sessionStorage.getItem(SETUP_WIZARD_SHOWN_KEY)).toBe('1');

    // 같은 세션에서 다시 대시보드로 와도 다시 끌려가지 않는다([건너뛰기]와 같다)
    await router.navigate('/');
    expect(await screen.findByRole('heading', { level: 1, name: '대시보드' })).toBeInTheDocument();
    await settle();
    expect(router.state.location.pathname).toBe('/');
  });

  it('새 세션(탭·앱을 다시 켬)이면 할 일이 남아 있는 동안 다시 한 번 연다', async () => {
    window.sessionStorage.removeItem(SETUP_WIZARD_SHOWN_KEY);
    stubDashboard(withTodo);
    const first = renderRoute('/');
    await screen.findByRole('heading', { level: 1, name: '설정 마법사' });
    first.unmount();

    window.sessionStorage.clear();
    const { router } = renderRoute('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: '설정 마법사' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup');
    // 예전 '이 브라우저에서 한 번'(localStorage)은 더 쓰지 않는다
    expect(window.localStorage.getItem('autostore.guide.welcomeSeen')).toBeNull();
  });

  it('시작 준비 5가지가 모두 끝났으면 열지 않고 정한 것으로만 남긴다', async () => {
    window.sessionStorage.removeItem(SETUP_WIZARD_SHOWN_KEY);
    stubDashboard();
    const { router } = renderRoute('/');
    const readiness = within(await screen.findByRole('region', { name: '시작 준비' }));
    expect(await readiness.findByText('5개 중 5개 완료')).toBeInTheDocument();
    await waitFor(() => expect(window.sessionStorage.getItem(SETUP_WIZARD_SHOWN_KEY)).toBe('1'));
    expect(router.state.location.pathname).toBe('/');
  });

  it('이번 세션에서 이미 정했으면(표시 있음) 할 일이 있어도 열지 않는다', async () => {
    stubDashboard({ 'GET /secrets': () => jsonResponse(secretStatusList([])) });
    const { router } = renderRoute('/');
    const readiness = within(await screen.findByRole('region', { name: '시작 준비' }));
    expect(await readiness.findByText('5개 중 3개 완료')).toBeInTheDocument();
    await settle();
    expect(router.state.location.pathname).toBe('/');
  });

  it('저장소를 못 쓰면 열지 않는다(대시보드를 열 때마다 끌려가지 않게)', async () => {
    window.sessionStorage.removeItem(SETUP_WIZARD_SHOWN_KEY);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('막힘', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('막힘', 'SecurityError');
    });
    stubDashboard({ 'GET /secrets': () => jsonResponse(secretStatusList([])) });
    const { router } = renderRoute('/');
    const readiness = within(await screen.findByRole('region', { name: '시작 준비' }));
    expect(await readiness.findByText('5개 중 3개 완료')).toBeInTheDocument();
    await settle();
    expect(router.state.location.pathname).toBe('/');
    // 입구는 그대로 있다
    expect(readiness.getByRole('link', { name: '설정 마법사' })).toHaveAttribute('href', '/setup');
  });

  it("할 일 없이 '확인 못함'(서버 오류)만 있으면 아직 정하지 않는다(표시를 남기지 않음)", async () => {
    window.sessionStorage.removeItem(SETUP_WIZARD_SHOWN_KEY);
    stubDashboard({
      'GET /secrets': () => errorResponse(503, 'KEYCHAIN_UNAVAILABLE', '키체인을 열 수 없습니다.'),
    });
    const { router } = renderRoute('/');
    const readiness = within(await screen.findByRole('region', { name: '시작 준비' }));
    expect(await readiness.findAllByText('키체인을 열 수 없습니다.')).toHaveLength(2);
    await settle();
    expect(router.state.location.pathname).toBe('/');
    expect(window.sessionStorage.getItem(SETUP_WIZARD_SHOWN_KEY)).toBeNull();
  });

  it('대시보드가 아닌 화면으로 바로 오면 열지 않는다', async () => {
    window.sessionStorage.removeItem(SETUP_WIZARD_SHOWN_KEY);
    stubDashboard({ 'GET /secrets': () => jsonResponse(secretStatusList([])) });
    const { router } = renderRoute('/guide');
    expect(await screen.findByRole('heading', { level: 1, name: '사용 안내' })).toBeInTheDocument();
    await settle();
    expect(router.state.location.pathname).toBe('/guide');
    expect(window.sessionStorage.getItem(SETUP_WIZARD_SHOWN_KEY)).toBeNull();
  });
});

describe('예전 주소 /welcome(D-29 5번 첫 실행 안내)', () => {
  it.each([
    ['/welcome', '', '환영합니다'],
    ['/welcome?step=3', '?step=3', '키 넣기'],
  ])(
    '%s → /setup%s(단계 그대로, 뒤로 가기가 /welcome에 머물지 않게 replace)',
    async (path, search, step) => {
      stubDashboard(withTodo);
      const { router } = renderRoute(path);
      expect(
        await screen.findByRole('heading', { level: 1, name: '설정 마법사' }),
      ).toBeInTheDocument();
      expect(await screen.findByRole('heading', { level: 2, name: step })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/setup');
      expect(router.state.location.search).toBe(search);
      expect(router.state.historyAction).toBe('REPLACE');
    },
  );
});

describe("대시보드 '시작 준비' 카드의 [설정 마법사] 입구(D-30)", () => {
  it('할 일이 남아 있으면 카드 머리에 [설정 마법사](→ /setup)를 둔다', async () => {
    stubDashboard({ 'GET /secrets': () => jsonResponse(secretStatusList([])) });
    const { router } = renderRoute('/');
    const readiness = within(await screen.findByRole('region', { name: '시작 준비' }));
    const entry = await readiness.findByRole('link', { name: '설정 마법사' });
    expect(entry).toHaveAttribute('href', '/setup');
    entry.click();
    await waitFor(() => expect(router.state.location.pathname).toBe('/setup'));
  });

  it("'확인 못함'만 남아도 둔다", async () => {
    stubDashboard({
      'GET /secrets': () => errorResponse(503, 'KEYCHAIN_UNAVAILABLE', '키체인을 열 수 없습니다.'),
    });
    renderRoute('/');
    const readiness = within(await screen.findByRole('region', { name: '시작 준비' }));
    await readiness.findAllByText('키체인을 열 수 없습니다.');
    expect(readiness.getByRole('link', { name: '설정 마법사' })).toBeInTheDocument();
  });

  it('모두 완료면 두지 않는다', async () => {
    stubDashboard();
    renderRoute('/');
    const readiness = within(await screen.findByRole('region', { name: '시작 준비' }));
    expect(await readiness.findByText('5개 중 5개 완료')).toBeInTheDocument();
    expect(readiness.queryByRole('link', { name: '설정 마법사' })).toBeNull();
  });
});

describe('보통 앱(체험이 아님)', () => {
  it.each([
    ['/', '대시보드'],
    ['/guide', '사용 안내'],
    ['/setup', '설정 마법사'],
  ])('%s(%s): 체험 띠가 없고 탭 제목에 (체험)이 없다', async (path, title) => {
    stubDashboard();
    renderRoute(path);
    await screen.findByRole('heading', { level: 1, name: title });
    await settle();
    expect(screen.queryByRole('region', { name: '체험' })).toBeNull();
    expect(document.title).toBe(`${title} · 스마트스토어 정복`);
  });

  it("대시보드 '작업 흐름' 카드에 [체험해 보기](→ /demo 새 탭)", async () => {
    stubDashboard();
    renderRoute('/');
    const flow = within(await screen.findByRole('region', { name: '작업 흐름' }));
    const entry = flow.getByRole('link', { name: '체험해 보기 (새 탭에서 열림)' });
    expect(entry).toHaveAttribute('href', '/demo/keywords');
    expect(entry).toHaveAttribute('target', '_blank');
    expect(entry).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
