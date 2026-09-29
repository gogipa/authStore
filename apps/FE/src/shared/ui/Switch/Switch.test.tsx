import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

describe('Switch', () => {
  it('role="switch"이고 누르면 aria-checked가 바뀐다', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="과세 사이즈 판매" onCheckedChange={onCheckedChange} />);
    const control = screen.getByRole('switch', { name: '과세 사이즈 판매' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('꺼짐')).toBeInTheDocument();

    await userEvent.click(control);
    expect(control).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('켜짐')).toBeInTheDocument();
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
  });

  it('Space로도 바뀐다', async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="새 버전 자동 확인" defaultChecked />);
    const control = screen.getByRole('switch', { name: '새 버전 자동 확인' });
    expect(control).toHaveAttribute('aria-checked', 'true');

    control.focus();
    await user.keyboard(' ');
    expect(control).toHaveAttribute('aria-checked', 'false');
    await user.keyboard(' ');
    expect(control).toHaveAttribute('aria-checked', 'true');
  });

  it('제어형: 부모 값이 바뀌어야 바뀐다', async () => {
    function Controlled() {
      const [on, setOn] = useState(false);
      return <Switch aria-labelledby="lbl" checked={on} onCheckedChange={setOn} />;
    }
    render(
      <>
        <span id="lbl">등록 API 차단</span>
        <Controlled />
      </>,
    );
    const control = screen.getByRole('switch', { name: '등록 API 차단' });
    await userEvent.click(control);
    expect(control).toHaveAttribute('aria-checked', 'true');
  });

  it('꺼진 스위치는 바뀌지 않는다', async () => {
    render(<Switch aria-label="x" disabled />);
    const control = screen.getByRole('switch', { name: 'x' });
    await userEvent.click(control);
    expect(control).toHaveAttribute('aria-checked', 'false');
  });

  it('이름이 없으면 타입 오류다', () => {
    // @ts-expect-error label·aria-label·aria-labelledby 중 하나는 필수다
    const element = <Switch />;
    expect(element).toBeTruthy();
  });
});
