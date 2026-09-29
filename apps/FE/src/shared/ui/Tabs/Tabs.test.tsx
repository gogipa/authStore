import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TabPanel, Tabs } from './Tabs';

const ITEMS = [
  { value: 'profile', label: '구매대행 프로필', caption: '수입자 입력 필요' },
  { value: 'cost', label: '비용·요금표', caption: '요금표 v2026-09' },
  { value: 'fx', label: '환율' },
] as const;

function selected() {
  return screen.getAllByRole('tab').filter((tab) => tab.getAttribute('aria-selected') === 'true');
}

describe('Tabs', () => {
  it('role="tablist"·"tab"이고 누른 탭만 aria-selected="true"', async () => {
    const onValueChange = vi.fn();
    render(
      <Tabs
        items={ITEMS}
        aria-label="설정 항목"
        idPrefix="settings"
        onValueChange={onValueChange}
      />,
    );
    const list = screen.getByRole('tablist', { name: '설정 항목' });
    expect(list).toHaveAttribute('aria-orientation', 'vertical');
    expect(within(list).getAllByRole('tab')).toHaveLength(3);
    expect(selected().map((t) => t.id)).toEqual(['settings-tab-profile']);

    await userEvent.click(screen.getByRole('tab', { name: /환율/ }));
    expect(selected().map((t) => t.id)).toEqual(['settings-tab-fx']);
    expect(onValueChange).toHaveBeenLastCalledWith('fx');
  });

  it('고른 탭만 tabIndex 0(roving)이고 방향키로 옮기면 바로 고른다', async () => {
    const user = userEvent.setup();
    render(<Tabs items={ITEMS} aria-label="설정 항목" idPrefix="s" defaultValue="cost" />);
    const cost = screen.getByRole('tab', { name: /비용/ });
    expect(cost).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: /환율/ })).toHaveAttribute('tabindex', '-1');

    cost.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: /환율/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /환율/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: /프로필/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: /환율/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('탭과 패널이 aria-controls·aria-labelledby로 이어진다', () => {
    render(
      <>
        <Tabs items={ITEMS} aria-label="설정 항목" idPrefix="s" value="cost" />
        <TabPanel idPrefix="s" value="cost">
          요금표
        </TabPanel>
      </>,
    );
    const tab = screen.getByRole('tab', { name: /비용/ });
    const panel = screen.getByRole('tabpanel', { name: /비용/ });
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveTextContent('요금표');
  });
});
