import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Radio } from './Radio';

describe('Radio', () => {
  it('같은 name끼리 하나만 골라진다', async () => {
    render(
      <div role="radiogroup" aria-label="분야">
        <Radio name="field" value="F" label="여성신발" />
        <Radio name="field" value="M" label="남성신발" defaultChecked />
      </div>,
    );
    expect(screen.getByRole('radio', { name: '남성신발' })).toBeChecked();
    await userEvent.click(screen.getByText('여성신발'));
    expect(screen.getByRole('radio', { name: '여성신발' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '남성신발' })).not.toBeChecked();
  });
});
