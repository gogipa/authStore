import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { DemoContext, type DemoInfo, type DemoProgress } from '@/shared/lib/demo';
import { fakeDemoInfo } from '@/test/demoInfo';
import { DEMO_GUIDE_TEXT, DEMO_TEXT, fillText } from '../../content';
import { DemoBanner } from './DemoBanner';

function renderBanner(demo: DemoInfo | null, options: { basename?: string; path?: string } = {}) {
  const basename = options.basename;
  const router = createMemoryRouter(
    [
      { path: '/', element: <DemoBanner /> },
      { path: '/keywords', element: <DemoBanner /> },
      { path: '/candidates/:id/sourcing', element: <DemoBanner /> },
      { path: '/candidates/:id/approval', element: <DemoBanner /> },
    ],
    { basename, initialEntries: [`${basename ?? ''}${options.path ?? '/'}`] },
  );
  const view = render(
    <DemoContext value={demo}>
      <RouterProvider router={router} />
    </DemoContext>,
  );
  return { router, ...view };
}

/** 화면 이름이 든 이동 링크 이름('② 소싱 화면 열기') */
const openName = (screenKey: keyof typeof DEMO_GUIDE_TEXT.screens) =>
  fillText(DEMO_GUIDE_TEXT.open, { screen: DEMO_GUIDE_TEXT.screens[screenKey] });
/** 이동 링크가 하나도 없음을 볼 때(어느 화면이든 이름이 '화면 열기'로 끝난다) */
const ANY_OPEN = /화면 열기$/;

/** 바뀌는 진행을 흉내 낸 저장소(띠가 구독해 다시 그린다) */
function liveGuide(initial: DemoProgress) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const info = {
    externalLinkNote: DEMO_TEXT.externalLink,
    resets: 0,
    guide: {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => snapshot,
      reset: () => {
        info.resets += 1;
      },
    },
  };
  return {
    info,
    set(next: DemoProgress) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

const START: DemoProgress = {
  done: 0,
  total: 19,
  next: { id: 'collect', path: '/keywords' },
  candidateId: null,
  registered: false,
  busy: false,
};

describe('체험 띠(F-GD-05, D-31·D-32)', () => {
  it('보통 앱(DemoContext 없음)이면 그리지 않는다', () => {
    renderBanner(null);
    expect(screen.queryByRole('region', { name: '체험' })).toBeNull();
  });

  it('체험이면 안내 글과 [처음부터 다시]·[체험 끝내기]를 보이고, 등록 전에는 [등록된 여정 보기]가 없다', () => {
    renderBanner(fakeDemoInfo(), { basename: '/demo' });
    const banner = screen.getByRole('region', { name: '체험' });
    expect(banner).toHaveTextContent(`체험 — ${DEMO_TEXT.text}`);
    const inside = within(banner);
    expect(inside.getByRole('button', { name: '처음부터 다시' })).toBeInTheDocument();
    // 끝내기는 basename 밖 앱 첫 화면으로 전체 이동(절대 주소 — 라우터가 바깥 링크로 본다)
    expect(inside.getByRole('link', { name: '체험 끝내기' })).toHaveAttribute(
      'href',
      `${window.location.origin}/`,
    );
    expect(inside.queryByRole('link', { name: DEMO_TEXT.candidate })).toBeNull();
  });

  it('진행 수와 다음에 할 일을 보인다(role=status, 막대는 진행률)', () => {
    renderBanner(
      fakeDemoInfo({
        done: 3,
        next: { id: 'anchor', path: '/candidates/1/sourcing' },
        candidateId: 1,
      }),
      { basename: '/demo', path: '/candidates/1/sourcing' },
    );
    const banner = screen.getByRole('region', { name: '체험' });
    expect(banner).toHaveTextContent('3/19단계');
    expect(within(banner).getByRole('progressbar', { name: '따라 하기 진행' })).toHaveAttribute(
      'aria-valuenow',
      '3',
    );
    const status = within(banner).getByRole('status');
    expect(status).toHaveTextContent(
      `${DEMO_GUIDE_TEXT.actions.anchor.step} ${DEMO_GUIDE_TEXT.actions.anchor.text}`,
    );
    // 이미 그 화면이라 이동 링크는 없다
    expect(within(banner).queryByRole('link', { name: ANY_OPEN })).toBeNull();
  });

  it('다음 일이 다른 화면에 있으면 [② 소싱 화면 열기]가 그리로 가고(체험 안 경로), 초점은 옮기지 않는다', async () => {
    const { router } = renderBanner(
      fakeDemoInfo({
        done: 3,
        next: { id: 'anchor', path: '/candidates/1/sourcing' },
        candidateId: 1,
      }),
      { basename: '/demo', path: '/keywords' },
    );
    const open = screen.getByRole('link', { name: openName('sourcing') });
    expect(open).toHaveAttribute('href', '/demo/candidates/1/sourcing');
    expect(document.activeElement).toBe(document.body);
    await userEvent.click(open);
    expect(router.state.location.pathname).toBe('/demo/candidates/1/sourcing');
  });

  it('상태가 바뀌면 글이 따라 바뀌고, 결과를 만드는 중에는 기다리라고 한다', () => {
    const live = liveGuide(START);
    renderBanner(live.info, { basename: '/demo', path: '/keywords' });
    const status = () => within(screen.getByRole('region', { name: '체험' })).getByRole('status');
    expect(status()).toHaveTextContent(DEMO_GUIDE_TEXT.actions.collect.text);

    act(() => live.set({ ...START, busy: true }));
    expect(status()).toHaveTextContent(DEMO_GUIDE_TEXT.busy);
    expect(screen.queryByRole('link', { name: ANY_OPEN })).toBeNull();

    act(() => live.set({ ...START, done: 1, next: { id: 'useKeyword', path: '/keywords' } }));
    expect(status()).toHaveTextContent(DEMO_GUIDE_TEXT.actions.useKeyword.text);
    expect(screen.getByRole('region', { name: '체험' })).toHaveTextContent('1/19단계');
  });

  it('재실행 필요 단계가 있으면 그 단계 이름과 [재실행 필요 단계 모두 실행]을 먼저 알린다', () => {
    const live = liveGuide({
      ...START,
      done: 16,
      candidateId: 1,
      next: {
        id: 'rerunStale',
        path: '/candidates/1/content',
        params: { steps: '⑥-3 고시·HTML, ⑦ 태그' },
      },
    });
    renderBanner(live.info, { basename: '/demo', path: '/candidates/1/sourcing' });
    const banner = screen.getByRole('region', { name: '체험' });
    const status = () => within(banner).getByRole('status');
    expect(status()).toHaveTextContent(DEMO_GUIDE_TEXT.rerunStaleStep);
    expect(status()).toHaveTextContent(
      '앞 단계 결과나 입력한 값이 바뀌어 다시 실행할 단계가 있습니다(⑥-3 고시·HTML, ⑦ 태그). 왼쪽 단계 목록 아래 [재실행 필요 단계 모두 실행]을 누르세요.',
    );
    // 재실행 필요 글에 채우지 못한 `{steps}`가 남지 않는다
    expect(status().textContent).not.toContain('{');
    expect(within(banner).getByRole('link', { name: openName('content') })).toHaveAttribute(
      'href',
      '/demo/candidates/1/content',
    );

    // 단계가 바뀌면 글이 따라 바뀐다(⑧)
    act(() =>
      live.set({
        ...START,
        done: 17,
        candidateId: 1,
        next: {
          id: 'rerunStale',
          path: '/candidates/1/approval',
          params: { steps: '⑧ 이미지 업로드' },
        },
      }),
    );
    expect(status()).toHaveTextContent('(⑧ 이미지 업로드)');
    // 이 문장은 ③이 들어 있을 때만 판매가가 달라져 G2가 풀린다는 안내를 잇는다
    expect(status()).not.toHaveTextContent('소싱 확정(G2)');
    act(() =>
      live.set({
        ...START,
        done: 15,
        candidateId: 1,
        next: {
          id: 'rerunStale',
          path: '/candidates/1/judgement',
          params: { steps: '③ 판정', g2: '1' },
        },
      }),
    );
    expect(status()).toHaveTextContent('(③ 판정)');
    expect(status()).toHaveTextContent(DEMO_GUIDE_TEXT.rerunStaleG2);
    // 모두 고치고 나면 다음 일로 돌아온다
    act(() =>
      live.set({
        ...START,
        done: 18,
        candidateId: 1,
        next: { id: 'approveDryRun', path: '/candidates/1/approval' },
      }),
    );
    expect(status()).toHaveTextContent(DEMO_GUIDE_TEXT.actions.approveDryRun.text);
  });

  it('재실행 필요 버튼이 지금 거절되면 그 이유(G2 풀림·앞 단계 미완료)를 먼저 알린다', () => {
    const live = liveGuide({
      ...START,
      done: 16,
      candidateId: 1,
      next: {
        id: 'rerunStaleNeedsG2',
        path: '/candidates/1/judgement',
        params: { steps: '⑧ 이미지 업로드' },
      },
    });
    renderBanner(live.info, { basename: '/demo', path: '/candidates/1/approval' });
    const status = () => within(screen.getByRole('region', { name: '체험' })).getByRole('status');
    expect(status()).toHaveTextContent(DEMO_GUIDE_TEXT.rerunStaleStep);
    expect(status()).toHaveTextContent(
      "다시 실행할 단계(⑧ 이미지 업로드)가 있지만 소싱 확정(G2)이 풀려 있어 [재실행 필요 단계 모두 실행]을 아직 쓸 수 없습니다. 먼저 ③ 판정 화면 오른쪽 '소싱 확정'에서 [소싱 확정(G2)]을 누르세요.",
    );
    expect(screen.getByRole('link', { name: openName('judgement') })).toHaveAttribute(
      'href',
      '/demo/candidates/1/judgement',
    );

    act(() =>
      live.set({
        ...START,
        done: 16,
        candidateId: 1,
        next: {
          id: 'rerunStaleNeedsStep',
          path: '/candidates/1/thumbnail',
          params: { steps: '⑧ 이미지 업로드', blocker: '⑤ 썸네일' },
        },
      }),
    );
    expect(status()).toHaveTextContent(
      '다시 실행할 단계(⑧ 이미지 업로드)가 있지만 앞 단계(⑤ 썸네일)가 아직 끝나지 않아 [재실행 필요 단계 모두 실행]을 쓸 수 없습니다. 먼저 그 단계를 마쳐 주세요.',
    );
    expect(status().textContent).not.toContain('{');
    expect(screen.getByRole('link', { name: openName('thumbnail') })).toHaveAttribute(
      'href',
      '/demo/candidates/1/thumbnail',
    );
  });

  it("등록 API 차단이 꺼진 채 첫 승인이면 '드라이런'이라고 하지 않고 바로 등록한다고 알린다", () => {
    renderBanner(
      fakeDemoInfo({
        done: 16,
        candidateId: 1,
        next: { id: 'approveBlockOff', path: '/candidates/1/approval' },
      }),
      { basename: '/demo', path: '/candidates/1/approval' },
    );
    const status = within(screen.getByRole('region', { name: '체험' })).getByRole('status');
    expect(status).toHaveTextContent(DEMO_GUIDE_TEXT.actions.approveDryRun.step);
    expect(status).toHaveTextContent(DEMO_GUIDE_TEXT.approveBlockOff);
    expect(status).toHaveTextContent("차단'이 꺼져 있어");
    expect(status).not.toHaveTextContent(DEMO_GUIDE_TEXT.actions.approveDryRun.text);
  });

  it('등록까지 가면 [등록된 여정 보기]가 체험 안의 여정으로 가고, 끝난 글을 보인다', () => {
    renderBanner(fakeDemoInfo({ done: 19, next: null, candidateId: 1, registered: true }), {
      basename: '/demo',
    });
    const banner = screen.getByRole('region', { name: '체험' });
    expect(within(banner).getByRole('link', { name: DEMO_TEXT.candidate })).toHaveAttribute(
      'href',
      '/demo/candidates/1',
    );
    expect(within(banner).getByRole('status')).toHaveTextContent(DEMO_GUIDE_TEXT.finished);
    expect(banner).toHaveTextContent('19/19단계');
  });

  it('[처음부터 다시]는 모델을 되돌리고 첫 할 일이 있는 키워드 화면으로 간다(키보드로도 누를 수 있다)', async () => {
    const demo = fakeDemoInfo({ done: 4, candidateId: 1 });
    const { router } = renderBanner(demo, { basename: '/demo', path: '/candidates/1/sourcing' });
    const restart = screen.getByRole('button', { name: '처음부터 다시' });
    restart.focus();
    await userEvent.keyboard('{Enter}');
    expect(demo.resets).toBe(1);
    expect(router.state.location.pathname).toBe('/demo/keywords');
    // 눌렀던 버튼에 초점이 그대로 있다(옮기지 않는다)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '처음부터 다시' }));
  });

  it('이동 링크 이름에 가는 화면 이름이 들어 있다("그" 같은 가리킴말이 없다). 모르는 경로면 일반 이름', () => {
    expect(openName('keywords')).toBe('① 키워드 화면 열기');
    expect(openName('approval')).toBe('최종 승인 화면 열기');
    expect(DEMO_GUIDE_TEXT.open).not.toContain('그 ');
    renderBanner(fakeDemoInfo({ done: 1, next: { id: 'collect', path: '/somewhere-else' } }), {
      basename: '/demo',
      path: '/keywords',
    });
    expect(screen.getByRole('link', { name: DEMO_GUIDE_TEXT.openFallback })).toBeInTheDocument();
  });
});
