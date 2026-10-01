import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RemovableTag } from './RemovableTag';

describe('RemovableTag(04-3 molecule)', () => {
  it('태그 글 + 삭제 아이콘 버튼(이름 "{태그} 태그 삭제"), 사전 미등록 칩', async () => {
    const onRemove = vi.fn();
    render(
      <ul>
        <RemovableTag text="가벼운운동화" dictionaryUnregistered onRemove={onRemove} />
      </ul>,
    );
    expect(screen.getByText('가벼운운동화')).toBeInTheDocument();
    expect(screen.getByText('사전 미등록')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '가벼운운동화 태그 삭제' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('꺼지면 누를 수 없다', () => {
    render(
      <ul>
        <RemovableTag text="조깅화" disabled onRemove={() => undefined} />
      </ul>,
    );
    expect(screen.getByRole('button', { name: '조깅화 태그 삭제' })).toBeDisabled();
    expect(screen.queryByText('사전 미등록')).not.toBeInTheDocument();
  });
});
