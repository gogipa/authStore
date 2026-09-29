import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Banner, type BannerTone } from './Banner';
import { moduleClassNames } from '@/test/cssModules';

describe('Banner', () => {
  it.each([
    ['info', 'note', 'info'],
    ['warning', 'status', 'alert'],
    ['blocked', 'status', 'alert'],
  ] as Array<[BannerTone, string, string]>)(
    'tone %s → .%s 클래스, 역할 %s, 아이콘 %s',
    (tone, role, icon) => {
      render(<Banner tone={tone}>안내 글</Banner>);
      const banner = screen.getByRole(role);
      expect(moduleClassNames(banner)).toEqual(['banner', tone]);
      expect(banner).toHaveTextContent('안내 글');
      expect(banner.querySelector('svg')?.getAttribute('data-icon')).toBe(icon);
    },
  );

  it('role을 바꿀 수 있다', () => {
    render(
      <Banner tone="blocked" role="alert">
        차단
      </Banner>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('차단');
  });
});
