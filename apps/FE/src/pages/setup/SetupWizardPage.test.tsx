import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { SETUP_WIZARD_SHOWN_KEY, SETUP_WIZARD_STEPS, SETUP_WIZARD_TEXT } from '@/features/guide';
import { jsonResponse, stubApi, type StubRoutes } from '@/test/apiStub';
import {
  aiCliCheck,
  aiCliCheckLatestList,
  aiCliCheckPage,
  boardChecks,
} from '@/test/fixtures/aiEngine';
import { callUsageList } from '@/test/fixtures/callUsage';
import { emptyProfile } from '@/test/fixtures/purchaseAgencyProfile';
import { registrationSwitch } from '@/test/fixtures/registration';
import { secretStatusList } from '@/test/fixtures/system';
import { renderRoute } from '@/test/renderRoute';

afterEach(() => window.sessionStorage.clear());

function stub(overrides: StubRoutes = {}) {
  return stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList()),
    'GET /registration-switch': () => jsonResponse(registrationSwitch(true)),
    // 커머스 키만 있음(라쿠텐 없음), CLAUDE 통과·AGY 감지만, 프로필 빈칸
    'GET /secrets': () =>
      jsonResponse(secretStatusList(['COMMERCE_CLIENT_ID', 'COMMERCE_CLIENT_SECRET'])),
    'GET /ai-cli-checks/latest': () => jsonResponse(aiCliCheckLatestList(boardChecks())),
    'GET /ai-cli-checks': () => jsonResponse(aiCliCheckPage()),
    'GET /purchase-agency-profile': () => jsonResponse(emptyProfile()),
    ...overrides,
  });
}

const stepNav = () =>
  within(screen.getByRole('navigation', { name: SETUP_WIZARD_TEXT.stepsLabel }));
const stepHeading = () => screen.getByRole('heading', { level: 2, name: /./, hidden: false });
const statusRow = (key: string) =>
  within(screen.getByRole('list', { name: SETUP_WIZARD_TEXT.statusTitle }))
    .getAllByRole('listitem')
    .find((li) => li.getAttribute('data-item') === key)!;

describe('설정 마법사(SCR-15 /setup, F-GD-04, D-30)', () => {
  it('머리·7단계 목록·1단계(환영 — 안전장치·지금 상태)를 보이고, 화면 도움말 ?는 없다', async () => {
    window.sessionStorage.removeItem(SETUP_WIZARD_SHOWN_KEY);
    stub();
    renderRoute('/setup');
    expect(
      await screen.findByRole('heading', { level: 1, name: '설정 마법사' }),
    ).toBeInTheDocument();
    expect(document.title).toBe('설정 마법사 · 스마트스토어 정복');
    expect(screen.queryByRole('button', { name: '이 화면 도움말' })).toBeNull();
    // 이 화면을 열면 이번 세션 자동 열기를 끝낸 것으로 남긴다(대시보드가 다시 끌어오지 않게)
    await waitFor(() => expect(window.sessionStorage.getItem(SETUP_WIZARD_SHOWN_KEY)).toBe('1'));

    const steps = stepNav().getAllByRole('button');
    expect(steps.map((b) => b.textContent)).toEqual(
      SETUP_WIZARD_STEPS.map((s, i) => `${i + 1}${s.title}`),
    );
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('7단계 중 1단계')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '환영합니다' })).toBeInTheDocument();
    expect(screen.getByText(/등록 API 차단 스위치는 처음에 켜져 있습니다/)).toBeInTheDocument();
    expect(await screen.findByText(/켜짐 · 승인해도 실제로 등록하지 않고/)).toBeInTheDocument();
    expect(await screen.findByText('5개 중 2개 완료')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '안전장치 자세히' })).toHaveAttribute(
      'href',
      '/guide#safety',
    );
    expect(screen.queryByRole('button', { name: SETUP_WIZARD_TEXT.prev })).toBeNull();
  });

  it('[다음]·[이전]으로 단계를 옮기면 주소(?step)가 바뀌고 초점이 단계 제목으로 간다', async () => {
    stub();
    const { router } = renderRoute('/setup');
    await screen.findByRole('heading', { level: 2, name: '환영합니다' });
    await userEvent.click(screen.getByRole('button', { name: SETUP_WIZARD_TEXT.next }));
    const heading = await screen.findByRole('heading', { level: 2, name: 'AI 엔진 연결' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(router.state.location.search).toBe('?step=2');
    expect(stepNav().getByRole('button', { name: /AI 엔진 연결/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
    // 지금 상태: 시작 준비 모델 그대로(AI 엔진 완료, agy는 연결 테스트 안 함)
    expect(await screen.findByText(/Claude Code \(sonnet\) 연결 테스트 통과/)).toBeInTheDocument();
    expect(statusRow('IMAGE_TOOL')).toHaveAttribute('data-state', 'todo');
    expect(screen.getByRole('link', { name: 'AI 엔진 열기' })).toHaveAttribute(
      'href',
      '/settings/ai-engine?from=first-run',
    );

    await userEvent.click(screen.getByRole('button', { name: SETUP_WIZARD_TEXT.prev }));
    const first = await screen.findByRole('heading', { level: 2, name: '환영합니다' });
    await waitFor(() => expect(first).toHaveFocus());
    expect(router.state.location.search).toBe('');
  });

  it('3단계 키 넣기: 커머스API·라쿠텐 키 4개만 넣는 칸, 값은 보이지 않는다', async () => {
    stub();
    renderRoute('/setup?step=3');
    expect(await screen.findByRole('heading', { level: 2, name: '키 넣기' })).toBeInTheDocument();
    const keys = within(screen.getByRole('region', { name: '키 입력' }));
    await keys.findAllByText('키체인에 저장됨');
    const rows = keys.getAllByRole('listitem').map((li) => li.getAttribute('data-secret-key'));
    expect(rows).toEqual([
      'COMMERCE_CLIENT_ID',
      'COMMERCE_CLIENT_SECRET',
      'RAKUTEN_APPLICATION_ID',
      'RAKUTEN_ACCESS_KEY',
    ]);
    expect(statusRow('COMMERCE_KEYS')).toHaveAttribute('data-state', 'done');
    expect(statusRow('RAKUTEN_KEYS')).toHaveAttribute('data-state', 'todo');
    // 넣기를 누르면 password 칸이 열린다(값을 다시 보여 주지 않는다)
    await userEvent.click(keys.getByRole('button', { name: '라쿠텐 applicationId 넣기' }));
    expect(keys.getByLabelText('라쿠텐 applicationId 새 값')).toHaveAttribute('type', 'password');
  });

  it('4단계 프로필: 빈칸 수와 이름, 5단계 학습 끄기: 세 곳과 앱이 확인할 수 없다는 글', async () => {
    stub();
    renderRoute('/setup?step=4');
    expect(
      await screen.findByRole('heading', { level: 2, name: '구매대행 프로필' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/빈칸 10개: /)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: SETUP_WIZARD_TEXT.next }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'AI 계정 학습 끄기' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Help improve Claude/)).toBeInTheDocument();
    expect(screen.getByText(/Enable Telemetry/)).toBeInTheDocument();
    expect(screen.getByText(/Improve the model for everyone/)).toBeInTheDocument();
    expect(screen.getByText(SETUP_WIZARD_TEXT.noCheck)).toBeInTheDocument();
  });

  it('6단계 체험해 보기: [체험해 보기]가 /demo를 새 탭으로 연다(지금 상태 칸 없음)', async () => {
    stub();
    renderRoute('/setup?step=6');
    expect(
      await screen.findByRole('heading', { level: 2, name: '체험해 보기' }),
    ).toBeInTheDocument();
    const entry = screen.getByRole('link', { name: '체험해 보기 (새 탭에서 열림)' });
    expect(entry).toHaveAttribute('href', '/demo/keywords');
    expect(entry).toHaveAttribute('target', '_blank');
    expect(entry).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      screen.queryByRole('heading', { level: 3, name: SETUP_WIZARD_TEXT.statusTitle }),
    ).toBeNull();
    expect(screen.queryByText('pnpm demo')).toBeNull();
  });

  it('7단계: 다섯 항목 상태, [대시보드로 가기]', async () => {
    stub({
      'GET /ai-cli-checks/latest': () =>
        jsonResponse(aiCliCheckLatestList({ CLAUDE: aiCliCheck() })),
    });
    const { router } = renderRoute('/setup?step=7');
    expect(await screen.findByRole('heading', { level: 2, name: '준비 끝' })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: SETUP_WIZARD_TEXT.statusTitle })).getAllByRole(
          'listitem',
        ),
      ).toHaveLength(5),
    );
    expect(screen.queryByRole('button', { name: SETUP_WIZARD_TEXT.next })).toBeNull();
    // 마지막 단계에서도 체험으로 이어 간다(새 탭)
    expect(screen.getByRole('link', { name: '체험해 보기 (새 탭에서 열림)' })).toHaveAttribute(
      'href',
      '/demo/keywords',
    );
    await userEvent.click(screen.getByRole('button', { name: SETUP_WIZARD_TEXT.finish }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('[건너뛰기]는 어느 단계에서나 대시보드로 간다', async () => {
    window.sessionStorage.removeItem(SETUP_WIZARD_SHOWN_KEY);
    stub();
    const { router } = renderRoute('/setup?step=3');
    await screen.findByRole('heading', { level: 2, name: '키 넣기' });
    await userEvent.click(screen.getByRole('button', { name: SETUP_WIZARD_TEXT.skip }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(window.sessionStorage.getItem(SETUP_WIZARD_SHOWN_KEY)).toBe('1');
  });

  it('키보드만으로 단계 목록에서 고른다(Tab·Enter)', async () => {
    stub();
    renderRoute('/setup');
    await screen.findByRole('heading', { level: 2, name: '환영합니다' });
    const target = stepNav().getByRole('button', { name: /구매대행 프로필/ });
    target.focus();
    await userEvent.keyboard('{Enter}');
    const heading = await screen.findByRole('heading', { level: 2, name: '구매대행 프로필' });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it.each([
    ['?step=99', '준비 끝'],
    ['?step=0', '환영합니다'],
    ['?step=abc', '환영합니다'],
  ])('주소 %s는 있는 단계로 맞춘다(%s)', async (search, title) => {
    stub();
    renderRoute(`/setup${search}`);
    expect(await screen.findByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    expect(stepHeading()).toBeInTheDocument();
  });
});
