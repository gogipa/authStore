import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon';
import { ICON_NAMES } from './icons';

describe('Icon', () => {
  it('인라인 SVG: 24 격자, 선 1.5px, currentColor, 장식(aria-hidden)', () => {
    const { container } = render(<Icon name="copy" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('stroke-width', '1.5');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('fill', 'none');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '16');
  });

  it('04-3·P1-02가 부른 아이콘이 모두 있다(내비·칩 6개·복사·삭제·펼치기·정보·경고)', () => {
    expect(ICON_NAMES).toEqual(
      expect.arrayContaining([
        'grid',
        'search',
        'list',
        'package',
        'sliders',
        'activity',
        'check',
        'progress',
        'pause',
        'undo',
        'alert',
        'circle',
        'copy',
        'close',
        'chevron-down',
        'info',
      ]),
    );
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector('svg')?.childElementCount, name).toBeGreaterThan(0);
      unmount();
    }
  });
});
