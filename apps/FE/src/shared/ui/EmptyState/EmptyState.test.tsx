import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ButtonLink } from '../Button/Button';
import { EmptyState } from './EmptyState';

describe('EmptyState(빈 상태 안내, D-29)', () => {
  it('제목·설명·다음 행동 버튼을 보인다', () => {
    render(
      <MemoryRouter>
        <EmptyState
          title="진행 중인 여정이 없습니다."
          actions={<ButtonLink to="/keywords">키워드 열기</ButtonLink>}
        >
          키워드에서 고르세요.
        </EmptyState>
      </MemoryRouter>,
    );
    expect(screen.getByText('진행 중인 여정이 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('키워드에서 고르세요.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '키워드 열기' })).toHaveAttribute('href', '/keywords');
  });

  it('설명·버튼은 없으면 그리지 않는다', () => {
    const { container } = render(<EmptyState title="없습니다." />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
