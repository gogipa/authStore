import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routes } from './routes';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { candidateDetail } from '@/test/fixtures/stepEngine';
import { renderRoute } from '@/test/renderRoute';

describe('경로', () => {
  it('/settings/ai-engine은 AI 엔진 화면(SCR-13)을 그린다', async () => {
    renderRoute('/settings/ai-engine');
    expect(await screen.findByRole('heading', { level: 1, name: 'AI 엔진' })).toBeInTheDocument();
    expect(screen.getByText('SCR-13')).toBeInTheDocument();
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: '설정' })).toHaveAttribute('href', '/settings');
  });

  // lazy로 나눈 뒤에도 13개 화면 경로가 모두 그려진다(SCR-13은 위 테스트).
  it.each([
    ['/', '대시보드', 'SCR-01'],
    ['/keywords', '키워드', 'SCR-02'],
    ['/candidates', '후보 작업', 'SCR-12'],
    ['/candidates/7/sourcing', '라쿠텐 후보 비교', 'SCR-03'],
    ['/candidates/7/judgement', '판정 · 소싱 확정 · 카테고리', 'SCR-04'],
    ['/candidates/7/thumbnail', '썸네일 스튜디오', 'SCR-05'],
    ['/candidates/7/content', '상세 콘텐츠', 'SCR-06'],
    ['/candidates/7/tags', '태그', 'SCR-07'],
    ['/candidates/7/approval', '최종 승인', 'SCR-08'],
    ['/products', '등록 상품', 'SCR-09'],
    ['/settings', '설정', 'SCR-10'],
    ['/system', '시스템 상태', 'SCR-11'],
  ])('%s → %s (%s)', async (path, title, screenId) => {
    renderRoute(path);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(screenId)).toBeInTheDocument();
  });

  it('/candidates/:candidateId는 이어 할 단계 화면으로 보낸다(resumeStepCode, P1-04)', async () => {
    stubApi({
      'GET /candidates/7': () =>
        jsonResponse(candidateDetail({ id: 7, resumeStepCode: 'SOURCING' })),
    });
    const { router } = renderRoute('/candidates/7');
    expect(
      await screen.findByRole('heading', { level: 1, name: '라쿠텐 후보 비교' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/candidates/7/sourcing');
  });

  it('단계 레일은 현재 화면을 맡는 첫 행을 현재 단계로 표시한다', async () => {
    renderRoute('/candidates/7/judgement');
    const rail = within(await screen.findByRole('navigation', { name: '단계' }));
    const current = rail
      .getAllByRole('link')
      .filter((a) => a.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('판정');
    expect(rail.getByRole('link', { name: /카테고리/ })).toHaveAttribute(
      'href',
      '/candidates/7/judgement#category',
    );
  });

  it('단계 화면끼리 오가도 후보 작업 틀(후보 머리·레일)은 그대로 남는다(eager)', async () => {
    const { router } = renderRoute('/candidates/7/sourcing');
    await screen.findByRole('heading', { level: 1, name: '라쿠텐 후보 비교' });
    const rail = screen.getByRole('navigation', { name: '단계' });
    const header = screen.getByRole('region', { name: '후보 정보' });

    await router.navigate('/candidates/7/tags');
    expect(await screen.findByRole('heading', { level: 1, name: '태그' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '단계' })).toBe(rail);
    expect(screen.getByRole('region', { name: '후보 정보' })).toBe(header);
    expect(within(header).getByRole('link', { name: '후보 목록' })).toHaveAttribute(
      'href',
      '/candidates',
    );
  });

  it('없는 경로는 없는 화면(대시보드 링크)을 앱 틀 안에 보여 준다', async () => {
    renderRoute('/no-such-page');
    expect(
      await screen.findByRole('heading', { level: 1, name: '없는 화면입니다' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '대시보드로' })).toHaveAttribute('href', '/');
    const nav = within(screen.getByRole('navigation', { name: '주 메뉴' }));
    expect(nav.queryAllByRole('link').filter((a) => a.hasAttribute('aria-current'))).toHaveLength(
      0,
    );
  });

  it('화면은 lazy, 틀·없는 화면은 eager이고 오류 경계는 경로 없는 layout route에 있다', () => {
    const root = routes[0];
    expect(root?.path).toBe('/');
    const boundary = root?.children?.[0];
    expect(boundary?.path).toBeUndefined();
    expect(boundary?.ErrorBoundary).toBeDefined();

    const children = boundary?.children ?? [];
    const byPath = new Map(children.map((r) => [r.index ? '(index)' : r.path, r]));
    for (const key of [
      '(index)',
      'keywords',
      'candidates',
      'products',
      'settings',
      'settings/ai-engine',
      'system',
    ]) {
      expect(typeof byPath.get(key)?.lazy, key).toBe('function');
    }
    const candidate = byPath.get('candidates/:candidateId');
    expect(candidate?.lazy).toBeUndefined();
    expect(candidate?.element).toBeDefined();
    for (const step of candidate?.children ?? []) {
      if (step.index) expect(step.lazy).toBeUndefined();
      else expect(typeof step.lazy, step.path).toBe('function');
    }
    expect(byPath.get('*')?.lazy).toBeUndefined();
    expect(byPath.get('*')?.element).toBeDefined();
  });
});
