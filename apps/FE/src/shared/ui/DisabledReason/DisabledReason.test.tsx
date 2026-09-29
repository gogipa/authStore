import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DisabledReason } from './DisabledReason';
import { Button } from '../Button/Button';
import { moduleClassNames } from '@/test/cssModules';

describe('DisabledReason', () => {
  it('꺼진 버튼 옆에 꺼진 이유를 보이는 글로 쓰고, 버튼 설명으로 잇는다', () => {
    render(
      <>
        <Button disabled aria-describedby="codex-why">
          연결 테스트
        </Button>
        <DisabledReason id="codex-why">설치되지 않아 고를 수 없습니다</DisabledReason>
      </>,
    );
    const button = screen.getByRole('button', { name: '연결 테스트' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('설치되지 않아 고를 수 없습니다');
    expect(screen.getByText('설치되지 않아 고를 수 없습니다')).toBeVisible();
    expect(moduleClassNames(screen.getByText('설치되지 않아 고를 수 없습니다'))).toEqual([
      'reason',
      'waiting',
    ]);
  });

  it('tone="muted"', () => {
    render(<DisabledReason tone="muted">재실행 필요 단계가 없습니다</DisabledReason>);
    expect(moduleClassNames(screen.getByText('재실행 필요 단계가 없습니다'))).toEqual([
      'reason',
      'muted',
    ]);
  });
});
