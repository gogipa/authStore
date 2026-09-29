import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Disclosure } from './Disclosure';

describe('Disclosure', () => {
  it('누르면 aria-expanded가 바뀌고 내용이 보였다 숨는다', async () => {
    render(
      <Disclosure title="비용 분해" meta="판매가 167,300원 기준 · 모드 A">
        물품가 105,120원
      </Disclosure>,
    );
    const button = screen.getByRole('button', { name: '펼치기' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const region = document.getElementById(button.getAttribute('aria-controls') ?? '');
    expect(region).not.toBeVisible();

    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAccessibleName('접기');
    expect(region).toBeVisible();
    expect(region).toHaveTextContent('물품가 105,120원');

    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('defaultOpen이면 펼친 채로 시작한다', () => {
    render(
      <Disclosure title="상세 페이지" defaultOpen look="link">
        내용
      </Disclosure>,
    );
    expect(screen.getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true');
  });
});
