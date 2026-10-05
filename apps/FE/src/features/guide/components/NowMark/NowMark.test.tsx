import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepGuideVisibleContext } from '../../model/stepGuideVisible';
import { NowMark } from './NowMark';

describe('NowMark(D-36 지금 여기 표시)', () => {
  it('켜면 이름표가 붙고, 꺼도 안의 칸은 그대로 있다(다시 만들어지지 않는다)', () => {
    const { rerender } = render(
      <NowMark active={false} label="지금 여기">
        <input aria-label="값" />
      </NowMark>,
    );
    const input = screen.getByLabelText('값');
    expect(screen.queryByText('지금 여기')).toBeNull();

    rerender(
      <NowMark active label="지금 여기">
        <input aria-label="값" />
      </NowMark>,
    );
    expect(screen.getByText('지금 여기')).toBeInTheDocument();
    // 같은 칸이 그대로다 — 입력 중인 값을 잃지 않는다
    expect(screen.getByLabelText('값')).toBe(input);
  });

  it('체험이 아니면(안내를 감추면) 켜도 이름표가 없고 안의 칸은 그대로 있다(D-43)', () => {
    render(
      <StepGuideVisibleContext value={false}>
        <NowMark active label="지금 여기">
          <button type="button">누르기</button>
        </NowMark>
      </StepGuideVisibleContext>,
    );
    expect(screen.queryByText('지금 여기')).toBeNull();
    expect(screen.getByRole('button', { name: '누르기' })).toBeInTheDocument();
  });

  it('이름표는 눈으로만 본다(화면 읽기 프로그램에 읽히지 않는다)', () => {
    render(
      <NowMark active label="지금 여기">
        <button type="button">누르기</button>
      </NowMark>,
    );
    expect(screen.getByText('지금 여기')).toHaveAttribute('aria-hidden', 'true');
  });
});
