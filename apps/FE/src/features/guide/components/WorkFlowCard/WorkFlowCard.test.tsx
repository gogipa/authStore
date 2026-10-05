import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoContext } from '@/shared/lib/demo';
import { fakeDemoInfo } from '@/test/demoInfo';
import { WORK_FLOW_HIDDEN_KEY } from '../../model/useWorkFlowHidden';
import { WorkFlowCard, type WorkFlowCardProps } from './WorkFlowCard';

function renderCard(variant: WorkFlowCardProps['variant'], options: { demo?: boolean } = {}) {
  const router = createMemoryRouter([{ path: '/', element: <WorkFlowCard variant={variant} /> }]);
  return render(
    <DemoContext value={options.demo ? fakeDemoInfo() : null}>
      <RouterProvider router={router} />
    </DemoContext>,
  );
}

const card = () => within(screen.getByRole('region', { name: '작업 흐름' }));

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("'작업 흐름' 카드(F-DB-11·F-GD-01, D-29)", () => {
  it('① 키워드부터 ⑨ 등록까지 10칸 탭이고, 처음에는 ① 키워드 설명이 보인다', () => {
    renderCard('dashboard');
    const tabs = card().getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      '① 키워드',
      '② 소싱',
      '③ 판정',
      '④ 카테고리',
      '⑤ 썸네일',
      '⑥ 콘텐츠',
      '⑦ 태그',
      '⑧ 이미지 업로드',
      '승인',
      '⑨ 등록',
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    const panel = within(card().getByRole('tabpanel'));
    expect(panel.getByRole('heading', { name: '① 키워드' })).toBeInTheDocument();
    expect(panel.getByText('G1 키워드 선택')).toBeInTheDocument();
    expect(panel.getByText('하는 일')).toBeInTheDocument();
    expect(panel.getByText('앱이 하는 것')).toBeInTheDocument();
    expect(panel.getByText('사람이 확인할 것')).toBeInTheDocument();
    expect(panel.getByRole('link', { name: '키워드 열기' })).toHaveAttribute('href', '/keywords');
  });

  it('단계를 누르면 그 단계의 하는 일·자동·확인을 보인다', async () => {
    renderCard('dashboard');
    await userEvent.click(card().getByRole('tab', { name: '승인' }));
    const panel = within(card().getByRole('tabpanel', { name: '승인' }));
    expect(panel.getByText('G4 최종 승인')).toBeInTheDocument();
    expect(panel.getByText(/이 승인은 건너뛸 수 없습니다/)).toBeInTheDocument();
    expect(panel.getByRole('link', { name: '여정 열기' })).toHaveAttribute('href', '/candidates');
  });

  it('←→·Home·End로 단계를 옮기면 바로 고르고 초점이 따라간다(roving tabindex)', async () => {
    renderCard('dashboard');
    const first = card().getByRole('tab', { name: '① 키워드' });
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    const second = card().getByRole('tab', { name: '② 소싱' });
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(second).toHaveFocus();
    expect(first).toHaveAttribute('tabindex', '-1');
    await userEvent.keyboard('{End}');
    expect(card().getByRole('tab', { name: '⑨ 등록' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(card().getByRole('tab', { name: '① 키워드' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(card().getByRole('tab', { name: '⑨ 등록' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(card().getByRole('tab', { name: '① 키워드' })).toHaveFocus();
  });

  it("'다시 보지 않기'를 누르면 숨기고 안내 띠를 보이며, 이 브라우저에 기억한다", async () => {
    const view = renderCard('dashboard');
    await userEvent.click(card().getByRole('button', { name: '다시 보지 않기' }));
    expect(screen.queryByRole('region', { name: '작업 흐름' })).toBeNull();
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent("왼쪽 메뉴 '사용 안내'에서 언제든 다시 볼 수 있습니다.");
    expect(within(note).getByRole('link', { name: '사용 안내' })).toHaveAttribute('href', '/guide');
    expect(window.localStorage.getItem(WORK_FLOW_HIDDEN_KEY)).toBe('1');
    // 누른 버튼이 사라져도 초점을 잃지 않는다: 그 자리에 보이는 안내 띠로 옮긴다
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toContainElement(note);
    expect(document.activeElement).toHaveAttribute('tabindex', '-1');

    // 다시 열면(새로 고침) 카드도 안내 띠도 없다
    view.unmount();
    renderCard('dashboard');
    expect(screen.queryByRole('region', { name: '작업 흐름' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it("사용 안내 화면에서는 숨겨도 보이고, '대시보드에 다시 보이기'로 되돌린다", async () => {
    window.localStorage.setItem(WORK_FLOW_HIDDEN_KEY, '1');
    renderCard('guide');
    expect(card().queryByRole('button', { name: '다시 보지 않기' })).toBeNull();
    expect(card().getByText('대시보드에서는 숨겨 두었습니다.')).toBeInTheDocument();
    await userEvent.click(card().getByRole('button', { name: '대시보드에 다시 보이기' }));
    expect(window.localStorage.getItem(WORK_FLOW_HIDDEN_KEY)).toBeNull();
    expect(card().getByRole('status')).toHaveTextContent('대시보드에 다시 보입니다.');
    // 누른 버튼이 사라지므로 초점은 그 자리의 안내 글로 간다
    expect(card().getByRole('status')).toHaveFocus();
    expect(card().queryByText('대시보드에서는 숨겨 두었습니다.')).toBeNull();
  });

  it('저장소를 못 쓰면(예외) 카드는 그대로 보이고, 숨기기는 이번 화면에서만 된다', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('막힘', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('막힘', 'SecurityError');
    });
    renderCard('dashboard');
    expect(screen.getByRole('region', { name: '작업 흐름' })).toBeInTheDocument();
    await userEvent.click(card().getByRole('button', { name: '다시 보지 않기' }));
    expect(screen.queryByRole('region', { name: '작업 흐름' })).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('대시보드 카드 머리에 [체험해 보기](/demo 새 탭, D-31). 사용 안내 카드와 체험 안에는 없다', () => {
    const { unmount } = renderCard('dashboard');
    const entry = card().getByRole('link', { name: '체험해 보기 (새 탭에서 열림)' });
    expect(entry).toHaveAttribute('href', '/demo/keywords');
    expect(entry).toHaveAttribute('target', '_blank');
    expect(entry).toHaveAttribute('rel', 'noopener noreferrer');
    unmount();

    const guide = renderCard('guide');
    expect(card().queryByRole('link', { name: /체험해 보기/ })).toBeNull();
    guide.unmount();

    renderCard('dashboard', { demo: true });
    expect(card().queryByRole('link', { name: /체험해 보기/ })).toBeNull();
    expect(card().queryByText(/지금 체험 중입니다/)).toBeNull();
    expect(card().getByRole('button', { name: '다시 보지 않기' })).toBeInTheDocument();
  });
});
