import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '@/test/renderRoute';

const NAV_LABELS = [
  '대시보드',
  '키워드',
  '후보 작업',
  '등록 상품',
  '설정',
  'AI 엔진',
  '시스템 상태',
];

function mainNav() {
  return screen.getByRole('navigation', { name: '주 메뉴' });
}

describe('왼쪽 내비', () => {
  it('시안 순서대로 항목을 보여 준다', () => {
    renderRoute('/');
    const links = within(mainNav()).getAllByRole('link');
    expect(links.map((a) => a.textContent?.trim())).toEqual(NAV_LABELS);
  });

  it('AI 엔진 하위 항목은 /settings/ai-engine으로 간다', () => {
    renderRoute('/');
    const link = within(mainNav()).getByRole('link', { name: 'AI 엔진' });
    expect(link).toHaveAttribute('href', '/settings/ai-engine');
  });

  it('AI 엔진 화면에서는 AI 엔진만 현재 항목이고 설정은 아니다', () => {
    renderRoute('/settings/ai-engine');
    const nav = within(mainNav());
    expect(nav.getByRole('link', { name: 'AI 엔진' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: '설정' })).not.toHaveAttribute('aria-current');
  });

  it('단계 화면에서는 후보 작업이 현재 항목이다', () => {
    renderRoute('/candidates/7/judgement');
    const nav = within(mainNav());
    expect(nav.getByRole('link', { name: '후보 작업' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: '대시보드' })).not.toHaveAttribute('aria-current');
  });
});
