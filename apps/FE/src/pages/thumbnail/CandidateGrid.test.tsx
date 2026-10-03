import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { generationSummary } from '@/test/fixtures/thumbnails';
import { createTestQueryClient } from '@/test/renderRoute';
import { CandidateGrid, type CandidateGridProps } from './CandidateGrid';

function renderGrid(props: Partial<CandidateGridProps> = {}) {
  const handlers = {
    onChooseRepresentative: vi.fn(),
    onToggleAdditional: vi.fn(),
    onRegenerate: vi.fn(),
  };
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <CandidateGrid
        runs={[
          generationSummary({ slotNo: 1 }),
          generationSummary({
            slotNo: 2,
            status: 'REFUSED',
            refusalReason: '인물 생성 제한',
          }),
        ]}
        candidateCount={2}
        selectable
        pick={{ representative: null, additional: [] }}
        canRegenerate
        regenerateDisabledReason={null}
        {...handlers}
        {...props}
      />
    </QueryClientProvider>,
  );
  return handlers;
}

const cellOf = (name: string) =>
  screen.getByText(name, { selector: 'span' }).closest('li') as HTMLElement;

describe('CandidateGrid(SCR-05 썸네일 후보, P3-02)', () => {
  it("REFUSED 칸은 사유와 '얼굴 노출을 낮춰 다시 만들기 · 턱 아래 크롭'을 보이고, 누르면 낮춘 얼굴 노출로 그 번호를 다시 만든다", async () => {
    const { onRegenerate } = renderGrid();
    const refused = cellOf('후보 2');
    expect(within(refused).getByText(/인물 생성 제한/)).toBeInTheDocument();
    await userEvent.setup().click(
      within(refused).getByRole('button', {
        name: '얼굴 노출을 낮춰 다시 만들기 · 턱 아래 크롭',
      }),
    );
    expect(onRegenerate).toHaveBeenCalledWith(2, 'CHIN_CROP');
  });

  it("SUCCEEDED가 아닌 칸은 대표·추가로 고를 수 없다. 완료 칸은 '대표'를 누르면 그 이미지를 대표로", async () => {
    const { onChooseRepresentative } = renderGrid({
      runs: [
        generationSummary({ slotNo: 1 }),
        generationSummary({ slotNo: 2, status: 'RUNNING' }),
        generationSummary({ slotNo: 3, status: 'FAILED', errorMessage: '도구 오류' }),
      ],
      candidateCount: 3,
    });
    expect(screen.getByRole('radio', { name: '후보 2 대표' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '후보 3 대표' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '후보 3 추가' })).toBeDisabled();
    expect(screen.getByText('생성 중')).toBeInTheDocument();
    expect(screen.getByText(/도구 오류/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('radio', { name: '후보 1 대표' }));
    expect(onChooseRepresentative).toHaveBeenCalledWith(901);
  });

  it("요약 줄은 '14:20 생성 · 1:1 · 1K · 생성 거부 1건'이고 M2 표시(신발 비중·디테일·AI 생성)는 없다", () => {
    renderGrid();
    expect(screen.getByText('14:20 생성 · 1:1 · 1K · 생성 거부 1건')).toBeInTheDocument();
    expect(screen.queryByText(/신발 비중/)).not.toBeInTheDocument();
    expect(screen.queryByText(/디테일/)).not.toBeInTheDocument();
    expect(screen.queryByText('AI 생성')).not.toBeInTheDocument();
  });

  it("'다시 만들기'가 꺼져 있으면 이유 글, ⑤가 입력 대기가 아니면(완료) 다시 만들기·낮춰 다시 만들기를 보이지 않는다", () => {
    renderGrid({ regenerateDisabledReason: '생성 중인 후보가 끝난 뒤 고를 수 있습니다.' });
    expect(screen.getByRole('button', { name: '후보 1 다시 만들기' })).toBeDisabled();
    expect(
      screen.getAllByText('생성 중인 후보가 끝난 뒤 고를 수 있습니다.').length,
    ).toBeGreaterThan(0);
  });

  it('완료된 ⑤(다시 만들기 없음)에서도 거부 사유는 보인다', () => {
    renderGrid({ canRegenerate: false });
    expect(screen.queryByRole('button', { name: /다시 만들기/ })).not.toBeInTheDocument();
    expect(screen.getByText(/인물 생성 제한/)).toBeInTheDocument();
  });
});
