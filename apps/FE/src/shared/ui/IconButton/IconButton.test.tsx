import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('aria-label이 버튼 이름이고 아이콘은 장식(aria-hidden)이다', async () => {
    const onClick = vi.fn();
    render(<IconButton icon="copy" aria-label="명령 claude 복사" onClick={onClick} />);
    const button = screen.getByRole('button', { name: '명령 claude 복사' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('aria-label이 없으면 타입 오류다(pnpm typecheck가 이 줄을 검사한다)', () => {
    // @ts-expect-error aria-label은 필수다(화면시안_명세 §1: 아이콘만 있는 버튼은 aria-label)
    const element = <IconButton icon="close" />;
    expect(element).toBeTruthy();
  });
});
