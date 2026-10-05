import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DEMO_TEXT, SETUP_WIZARD_SHOWN_KEY, WORK_FLOW_HIDDEN_KEY } from '@/features/guide';
import { API_BASE_URL } from '@/shared/api/client';
import { jsonResponse } from '@/test/apiStub';
import { secretStatusList } from '@/test/fixtures/system';
import { renderDemoRoute } from '@/test/renderDemoRoute';
import type { DemoApi } from './demoApi';
import {
  reachPricingDone,
  reachRegistered,
  reachSourcingDone,
  startDemoKit,
} from './world/testkit';

/**
 * 체험(`/demo`, F-GD-05, D-31·D-32)을 화면을 가로질러 본다: 주요 화면이 모두 그려지고, 네트워크를 쓰지 않는다(전역 fetch·
 * EventSource를 부르지 않고, 표에 없는 요청도 모델 오류도 없다). 모든 화면 맨 위에 체험 띠, 탭 제목 끝 '(체험)'.
 * 빈 상태(처음)와 등록까지 걸어 둔 상태(끝)에서 모두 훑는다. 버튼을 눌러 따라 가는 걷기는 demo.walk.test.tsx가 본다.
 */
const ID = 1;

let fetchSpy: MockInstance<typeof fetch>;
let eventSourceSpy: ReturnType<typeof vi.fn>;
let serviceWorkerRegister: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  eventSourceSpy = vi.fn();
  vi.stubGlobal('EventSource', eventSourceSpy);
  serviceWorkerRegister = vi.fn();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: serviceWorkerRegister },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

/** 화면이 부른 조회·요청(열 때 스스로 보내는 POST 포함)이 모두 끝날 때까지(뒤따라 붙는 것까지) 기다린다 */
async function settle(queryClient: { isFetching: () => number; isMutating: () => number }) {
  for (let i = 0; i < 3; i += 1) {
    await waitFor(() => expect(queryClient.isFetching() + queryClient.isMutating()).toBe(0));
    await new Promise((r) => setTimeout(r, 30));
  }
}

/** 걸어 둔 상태의 체험 API(지연 없음)로 그린다 */
async function renderAfter(
  path: string,
  prepare: (demo: DemoApi) => Promise<void>,
  options: Parameters<typeof renderDemoRoute>[1] = {},
) {
  const { demo, off } = startDemoKit();
  await prepare(demo);
  off();
  return renderDemoRoute(path, { ...options, demoApi: demo });
}

/** 한 화면을 그린 뒤 네트워크 없음·띠·제목·예시 없음/실행 없음을 확인한다 */
async function expectCleanScreen(
  rendered: ReturnType<typeof renderDemoRoute>,
  title: string,
): Promise<void> {
  const { queryClient, demoApi } = rendered;
  expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  await settle(queryClient);

  // 체험 띠: 본문 맨 위(화면 머리보다 앞)
  const banner = screen.getByRole('region', { name: DEMO_TEXT.label });
  expect(screen.getByRole('main').firstElementChild).toBe(banner);
  expect(banner).toHaveTextContent(`체험 — ${DEMO_TEXT.text}`);
  expect(document.title).toBe(`${title} · 스마트스토어 정복 (체험)`);

  // 네트워크 없음: 전역 fetch·EventSource·서비스 워커를 부르지 않고, 표에 없는 요청도 모델 오류도 없다
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(eventSourceSpy).not.toHaveBeenCalled();
  expect(serviceWorkerRegister).not.toHaveBeenCalled();
  expect(demoApi.unknownRequests).toEqual([]);
  expect(demoApi.serverErrors).toEqual([]);
  expect(screen.queryByText(DEMO_TEXT.notAvailable)).toBeNull();
  expect(screen.queryByText(/앱 서버에 연결하지 못했습니다/)).toBeNull();
  // 아무것도 누르지 않았으니 '실행하지 않습니다' 답도, 그 글도 없다(화면이 열 때 스스로 보내는 POST까지)
  expect(demoApi.readOnlyRequests).toEqual([]);
  expect(screen.queryByText(DEMO_TEXT.readOnly)).toBeNull();
}

/** 빈 상태에서도 그릴 수 있는 화면: [basename 안 경로, 화면 제목(h1)] */
const START_SCREENS: readonly (readonly [string, string])[] = [
  ['/', '대시보드'],
  ['/keywords', '키워드'],
  ['/candidates', '여정'],
  ['/products', '등록 상품'],
  ['/settings', '설정'],
  ['/settings/ai-engine', 'AI 엔진'],
  ['/system', '시스템 상태'],
  ['/guide', '사용 안내'],
  ['/setup', '설정 마법사'],
];

/** 등록까지 걸어 둔 뒤 그릴 여정 화면 */
const FINISHED_SCREENS: readonly (readonly [string, string])[] = [
  ['/', '대시보드'],
  ['/candidates', '여정'],
  [`/candidates?candidateId=${ID}`, '여정'],
  [`/candidates/${ID}/sourcing`, '같은 상품을 파는 샵 비교'],
  [`/candidates/${ID}/judgement`, '판정 · 소싱 확정 · 카테고리'],
  [`/candidates/${ID}/thumbnail`, '썸네일 스튜디오'],
  [`/candidates/${ID}/content`, '상세 콘텐츠'],
  [`/candidates/${ID}/tags`, '태그'],
  [`/candidates/${ID}/approval`, '최종 승인'],
];

describe('체험 — 빈 상태에서 시작한다(D-32)', () => {
  it.each(START_SCREENS)('%s(%s)는 네트워크 없이 그려진다', async (path, title) => {
    await expectCleanScreen(renderDemoRoute(path), title);
  });

  it('대시보드: 시작 준비는 5개 모두 완료이고 진행 중인 여정은 비어 있고 작업 흐름은 보인다', async () => {
    const rendered = renderDemoRoute('/');
    await expectCleanScreen(rendered, '대시보드');
    const readiness = within(screen.getByRole('region', { name: '시작 준비' }));
    expect(await readiness.findByText('5개 중 5개 완료')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '작업 흐름' })).toBeInTheDocument();
    // 진행 중 여정 없음(빈 상태 안내), 이어서 할 곳 없음
    expect(screen.queryByText(/이어서 할 곳/)).toBeNull();
    // 설정 마법사는 저절로 열리지 않는다
    expect(rendered.router.state.location.pathname).toBe('/demo');
  });

  it('키워드: 수집 전이라 목록이 비어 있고 [수집]이 켜져 있다', async () => {
    const rendered = renderDemoRoute('/keywords');
    await expectCleanScreen(rendered, '키워드');
    expect(screen.getByText('아직 키워드가 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '수집' })).toBeEnabled();
    expect(screen.getByText(/아직 수집하지 않았습니다/)).toBeInTheDocument();
  });

  it('여정이 아직 없으면 여정 화면은 실제 앱처럼 여정을 찾지 못했다고 한다', async () => {
    const rendered = renderDemoRoute(`/candidates/${ID}/sourcing`);
    expect(
      await screen.findByRole('heading', { level: 1, name: '여정을 찾을 수 없습니다' }),
    ).toBeInTheDocument();
    await settle(rendered.queryClient);
    expect(rendered.demoApi.unknownRequests).toEqual([]);
    expect(rendered.demoApi.serverErrors).toEqual([]);
  });

  it('띠: 처음에는 [수집]을 안내하고 [등록된 여정 보기]는 없으며, [체험 끝내기]는 basename 밖이다', async () => {
    renderDemoRoute('/');
    await screen.findByRole('heading', { level: 1, name: '대시보드' });
    const banner = within(screen.getByRole('region', { name: DEMO_TEXT.label }));
    expect(banner.getByRole('status')).toHaveTextContent('① 키워드 [수집]을 누르세요.');
    expect(banner.getByText('0/19단계')).toBeInTheDocument();
    expect(banner.queryByRole('link', { name: DEMO_TEXT.candidate })).toBeNull();
    expect(banner.getByRole('link', { name: DEMO_TEXT.exit })).toHaveAttribute(
      'href',
      `${window.location.origin}/`,
    );
    // 다음 일이 있는 화면(키워드)으로 가는 링크
    expect(banner.getByRole('link', { name: '① 키워드 화면 열기' })).toHaveAttribute(
      'href',
      '/demo/keywords',
    );
  });
});

describe('체험 — 등록까지 걸어 둔 상태에서 주요 화면이 그려진다', () => {
  it.each(FINISHED_SCREENS)('%s(%s)', async (path, title) => {
    const rendered = await renderAfter(path, reachRegistered);
    await expectCleanScreen(rendered, title);
  });

  it('등록된 여정은 M1 목록에 보이지 않고, 띠 [등록된 여정 보기]가 최종 승인으로 연다', async () => {
    const rendered = await renderAfter('/', reachRegistered);
    await screen.findByRole('heading', { level: 1, name: '대시보드' });
    await settle(rendered.queryClient);
    const banner = within(screen.getByRole('region', { name: DEMO_TEXT.label }));
    const link = banner.getByRole('link', { name: DEMO_TEXT.candidate });
    expect(link).toHaveAttribute('href', `/demo/candidates/${ID}`);
    await userEvent.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: '최종 승인' })).toBeInTheDocument();
    expect(rendered.router.state.location.pathname).toBe(`/demo/candidates/${ID}/approval`);
    expect(await screen.findByText(/상품 번호/)).toBeInTheDocument();
    await settle(rendered.queryClient);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('체험 — 동작', () => {
  it('AI 엔진 화면은 열 때 감지를 보내도 오류가 없고, [연결 테스트]를 누를 때만 체험 글을 보인다', async () => {
    const { queryClient, demoApi } = renderDemoRoute('/settings/ai-engine');
    await screen.findByRole('heading', { level: 1, name: 'AI 엔진' });
    await settle(queryClient);
    const saveBar = within(screen.getByRole('region', { name: '저장' }));
    expect(saveBar.queryByRole('alert')).toBeNull();
    expect(saveBar.getByText(/바뀐 것이 없습니다/)).toBeInTheDocument();
    expect(demoApi.readOnlyRequests).toEqual([]);

    // [다시 감지](감지만 — 호출 비용 없음)도 접수로 답한다
    await userEvent.click(screen.getByRole('button', { name: '다시 감지' }));
    await settle(queryClient);
    expect(saveBar.queryByRole('alert')).toBeNull();

    // 연결 테스트는 실행이다 — 체험 글
    const claude = within(screen.getByRole('region', { name: /Claude Code/ }));
    await userEvent.click(claude.getByRole('button', { name: '연결 테스트' }));
    expect(await saveBar.findByRole('alert')).toHaveTextContent(DEMO_TEXT.readOnly);
    expect(demoApi.readOnlyRequests).toEqual(['POST /ai-cli-checks']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('② 비교표의 라쿠텐 링크는 열지 않는 꺼진 링크(체험 안 없는 화면으로 가지 않는다)', async () => {
    const { router, queryClient, container } = await renderAfter(
      `/candidates/${ID}/sourcing`,
      reachSourcingDone,
    );
    await screen.findByRole('heading', { level: 1, name: '같은 상품을 파는 샵 비교' });
    await settle(queryClient);
    // 비교표 6줄(일치 없음 1줄은 기본으로 숨김) — 새 탭으로 여는 링크가 하나도 없다
    const links = screen.getAllByRole('link', { name: /상품을 라쿠텐에서 보기$/ });
    expect(links).toHaveLength(6);
    expect(container.querySelectorAll('a[target="_blank"]')).toHaveLength(0);
    for (const link of links) {
      expect(link).not.toHaveAttribute('href');
      expect(link).not.toHaveAttribute('target');
      expect(link).toHaveAttribute('aria-disabled', 'true');
      expect(link).toHaveAttribute('title', DEMO_TEXT.externalLink);
    }
    await userEvent.click(links[0]!);
    expect(router.state.location.pathname).toBe(`/demo/candidates/${ID}/sourcing`);
    expect(screen.queryByText(DEMO_TEXT.notAvailable)).toBeNull();
  });

  it('③ 국내 기준가의 네이버쇼핑 링크도 열지 않는다', async () => {
    const { queryClient, container } = await renderAfter(
      `/candidates/${ID}/judgement`,
      reachPricingDone,
    );
    await screen.findByRole('heading', { level: 1, name: '판정 · 소싱 확정 · 카테고리' });
    await settle(queryClient);
    const domestic = within(screen.getByRole('region', { name: '국내 기준가' }));
    const links = domestic.getAllByRole('link', { name: /찾아보기/ });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).not.toHaveAttribute('href');
      expect(link).toHaveAttribute('aria-disabled', 'true');
      expect(link).toHaveAttribute('title', DEMO_TEXT.externalLink);
    }
    expect(container.querySelectorAll('a[target="_blank"]')).toHaveLength(0);
  });

  it('체험에서 한 일은 보통 앱의 브라우저 저장소에 남지 않는다(설정 마법사 표시·작업 흐름 숨김)', async () => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    const { router, queryClient } = renderDemoRoute('/setup');
    await screen.findByRole('heading', { level: 1, name: '설정 마법사' });
    await userEvent.click(screen.getByRole('button', { name: '건너뛰기' }));
    await screen.findByRole('heading', { level: 1, name: '대시보드' });
    expect(router.state.location.pathname).toBe('/demo');
    await settle(queryClient);
    const flow = within(screen.getByRole('region', { name: '작업 흐름' }));
    await userEvent.click(flow.getByRole('button', { name: '다시 보지 않기' }));
    expect(screen.queryByRole('region', { name: '작업 흐름' })).toBeNull();

    // 보통 앱이 보는 키(같은 출처의 진짜 저장소)는 비어 있다 — [체험 끝내기] 뒤 같은 탭에서도 마법사 자동 열기·작업 흐름이 그대로다
    expect(window.sessionStorage.getItem(SETUP_WIZARD_SHOWN_KEY)).toBeNull();
    expect(window.localStorage.getItem(WORK_FLOW_HIDDEN_KEY)).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
    expect(window.localStorage.length).toBe(0);
  });

  it('따라 하기 밖 동작은 실행하지 않고 체험 글을 보인다(시스템 상태 [지금 동기화])', async () => {
    const { queryClient } = renderDemoRoute('/system');
    await screen.findByRole('heading', { level: 1, name: '시스템 상태' });
    await settle(queryClient);
    const panel = within(screen.getByRole('region', { name: '메타데이터 동기화' }));
    await userEvent.click(panel.getByRole('button', { name: '지금 동기화' }));
    expect(await panel.findByRole('alert')).toHaveTextContent(DEMO_TEXT.readOnly);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('내비 링크는 /demo 안에 머문다', async () => {
    renderDemoRoute('/');
    await screen.findByRole('heading', { level: 1, name: '대시보드' });
    const nav = within(screen.getByRole('navigation', { name: '주 메뉴' }));
    expect(nav.getByRole('link', { name: '대시보드' })).toHaveAttribute('href', '/demo');
    expect(nav.getByRole('link', { name: '키워드' })).toHaveAttribute('href', '/demo/keywords');
    expect(nav.getByRole('link', { name: 'AI 엔진' })).toHaveAttribute(
      'href',
      '/demo/settings/ai-engine',
    );
  });

  it('설정 마법사는 체험에서 저절로 열리지 않고(시작 준비에 할 일이 있어도), 체험 입구 대신 지금 체험 중이라고 말한다', async () => {
    window.sessionStorage.clear();
    // 예시는 시작 준비 5개가 모두 완료라 자동 열기가 할 일이 없다 — 키 6개를 비워 할 일을 만든다(보통 앱이면 /setup으로 간다)
    const { router, queryClient } = renderDemoRoute('/', {
      override: (request) =>
        new URL(request.url).pathname === `${API_BASE_URL}/secrets`
          ? jsonResponse(secretStatusList([]))
          : undefined,
    });
    await screen.findByRole('heading', { level: 1, name: '대시보드' });
    const readiness = within(screen.getByRole('region', { name: '시작 준비' }));
    expect(await readiness.findByText('5개 중 3개 완료')).toBeInTheDocument();
    await settle(queryClient);
    await new Promise((r) => setTimeout(r, 50));
    expect(router.state.location.pathname).toBe('/demo');
    // 작업 흐름 카드에는 [체험해 보기]가 없다
    const flow = within(screen.getByRole('region', { name: '작업 흐름' }));
    expect(flow.queryByRole('link', { name: /체험해 보기/ })).toBeNull();

    await router.navigate('/setup?step=6');
    expect(
      await screen.findByRole('heading', { level: 2, name: '체험해 보기' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/지금 체험 중입니다/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /체험해 보기/ })).toBeNull();
  });
});
