import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Select } from './Select';

describe('Select', () => {
  it('라벨로 찾고 값을 고른다', async () => {
    render(
      <Select label="텍스트 모델" mono defaultValue="sonnet">
        <option value="sonnet">sonnet</option>
        <option value="opus">opus</option>
      </Select>,
    );
    const select = screen.getByLabelText('텍스트 모델');
    expect(select).toHaveValue('sonnet');
    await userEvent.selectOptions(select, 'opus');
    expect(select).toHaveValue('opus');
  });

  it('라벨을 칸 밖에 둘 때는 id로 잇는다', () => {
    render(
      <>
        <label htmlFor="cc-vision-model">비전 모델</label>
        <Select id="cc-vision-model" error="고를 수 없는 모델입니다.">
          <option>sonnet</option>
        </Select>
      </>,
    );
    const select = screen.getByLabelText('비전 모델');
    expect(select).toHaveAttribute('aria-invalid', 'true');
  });
});
