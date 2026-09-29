import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommandBox } from './CommandBox';

describe('CommandBox', () => {
  it('명령마다 복사 버튼(aria-label)이 있고 누르면 명령을 복사한다', async () => {
    const copy = vi.fn(async () => {});
    render(
      <CommandBox
        label="설치·로그인 방법"
        copy={copy}
        lines={[
          { command: 'npm install -g @openai/codex', copyLabel: '설치 명령 복사' },
          { command: 'codex login', note: '구독 로그인 · API 키는 안 씀' },
        ]}
      />,
    );
    expect(screen.getByText('codex login').tagName).toBe('CODE');
    await userEvent.click(screen.getByRole('button', { name: '설치 명령 복사' }));
    expect(copy).toHaveBeenCalledWith('npm install -g @openai/codex');
    await userEvent.click(screen.getByRole('button', { name: '명령 codex login 복사' }));
    expect(copy).toHaveBeenLastCalledWith('codex login');
    expect(screen.getByRole('status')).toHaveTextContent('복사했습니다: codex login');
  });

  it('복사에 실패하면 알린다', async () => {
    const copy = vi.fn(async () => {
      throw new Error('denied');
    });
    render(<CommandBox copy={copy} lines={[{ command: 'claude', note: '실행 후 /login' }]} />);
    await userEvent.click(screen.getByRole('button', { name: '명령 claude 복사' }));
    expect(screen.getByRole('status')).toHaveTextContent('복사하지 못했습니다');
  });
});
