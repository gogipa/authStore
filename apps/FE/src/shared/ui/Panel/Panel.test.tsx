import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Panel } from './Panel';

describe('Panel', () => {
  it('제목이 section의 이름이 되고 actions 슬롯을 그린다', () => {
    render(
      <Panel
        title="남성신발 키워드"
        caption="97개 · 순위순"
        actions={<button type="button">전체 이력</button>}
      >
        표
      </Panel>,
    );
    const panel = screen.getByRole('region', { name: '남성신발 키워드' });
    expect(
      within(panel).getByRole('heading', { level: 2, name: '남성신발 키워드' }),
    ).toBeInTheDocument();
    expect(within(panel).getByText('97개 · 순위순')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '전체 이력' })).toBeInTheDocument();
  });
});
