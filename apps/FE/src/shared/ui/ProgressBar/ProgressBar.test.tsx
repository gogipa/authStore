import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressBar } from './ProgressBar';
import { moduleClassNames } from '@/test/cssModules';

describe('ProgressBar', () => {
  it('role="progressbar"와 값 속성을 단다', () => {
    render(
      <ProgressBar aria-label="수집 진행률" value={4} max={10} valueText="10페이지 중 4페이지" />,
    );
    const bar = screen.getByRole('progressbar', { name: '수집 진행률' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
    expect(bar).toHaveAttribute('aria-valuenow', '4');
    expect(bar).toHaveAttribute('aria-valuetext', '10페이지 중 4페이지');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('40%');
    expect(moduleClassNames(bar.firstElementChild)).toEqual(['fill']);
  });

  it('다 차면 done 색(.complete)이고 범위 밖 값은 자른다', () => {
    render(<ProgressBar aria-label="수집 진행률" value={12} max={10} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '10');
    expect(moduleClassNames(bar.firstElementChild)).toEqual(['fill', 'complete']);
  });
});
