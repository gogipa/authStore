import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('글(<label for>)을 눌러도 체크된다', async () => {
    render(<Checkbox label="아식스 젤카야노 14" description="② 소싱 완료" />);
    const box = screen.getByRole('checkbox', { name: '아식스 젤카야노 14' });
    expect(box).toHaveAccessibleDescription('② 소싱 완료');
    await userEvent.click(screen.getByText('아식스 젤카야노 14'));
    expect(box).toBeChecked();
  });
});
