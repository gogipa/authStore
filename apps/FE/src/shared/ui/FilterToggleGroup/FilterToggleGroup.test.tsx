import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterToggleGroup } from './FilterToggleGroup';
import { moduleClassNames } from '@/test/cssModules';

const ITEMS = [
  { value: 'ALL', label: '전체', count: 97 },
  { value: 'PRIORITY', label: '우선 브랜드' },
  { value: 'EXCLUDED', label: '제외됨', count: 3 },
] as const;

describe('FilterToggleGroup', () => {
  it('role="group"이고 누른 버튼만 aria-pressed="true"', async () => {
    const onValueChange = vi.fn();
    render(
      <FilterToggleGroup items={ITEMS} aria-label="목록 거르기" onValueChange={onValueChange} />,
    );
    expect(screen.getByRole('group', { name: '목록 거르기' })).toBeInTheDocument();
    const all = screen.getByRole('button', { name: '전체 97' });
    const excluded = screen.getByRole('button', { name: '제외됨 3' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(excluded).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(excluded);
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(excluded).toHaveAttribute('aria-pressed', 'true');
    expect(onValueChange).toHaveBeenLastCalledWith('EXCLUDED');
  });

  it('모양(look)은 클래스 하나가 된다', () => {
    const { container } = render(
      <FilterToggleGroup items={ITEMS} aria-label="분야" look="segmented" value="PRIORITY" />,
    );
    expect(moduleClassNames(container.firstElementChild)).toEqual(['group', 'segmented']);
    expect(screen.getByRole('button', { name: '우선 브랜드' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
