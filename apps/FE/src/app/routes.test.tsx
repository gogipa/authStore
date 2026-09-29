import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '@/test/renderRoute';

describe('경로', () => {
  it('/settings/ai-engine은 AI 엔진 화면(SCR-13)을 그린다', () => {
    renderRoute('/settings/ai-engine');
    expect(screen.getByRole('heading', { level: 1, name: 'AI 엔진' })).toBeInTheDocument();
    expect(screen.getByText('SCR-13')).toBeInTheDocument();
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: '설정' })).toHaveAttribute('href', '/settings');
  });

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
  ])('%s → %s (%s)', (path, title, screenId) => {
    renderRoute(path);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(screenId)).toBeInTheDocument();
  });

  it('/candidates/:candidateId는 현재 단계(기본 ② 소싱)로 보낸다', async () => {
    const { router } = renderRoute('/candidates/7');
    expect(
      await screen.findByRole('heading', { level: 1, name: '라쿠텐 후보 비교' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/candidates/7/sourcing');
  });

  it('단계 레일은 현재 화면을 맡는 첫 행을 현재 단계로 표시한다', () => {
    renderRoute('/candidates/7/judgement');
    const rail = within(screen.getByRole('navigation', { name: '단계' }));
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

  it('없는 경로는 없는 화면을 보여 준다', () => {
    renderRoute('/no-such-page');
    expect(screen.getByRole('heading', { level: 1, name: '없는 화면입니다' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '대시보드로' })).toHaveAttribute('href', '/');
  });
});
