import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { generationSummary, thumbnailOutput } from '@/test/fixtures/thumbnails';
import { createTestQueryClient } from '@/test/renderRoute';
import { G3Checklist, type G3ChecklistProps } from './G3Checklist';

const LABELS = [
  '신발 길이가 화면 폭의 70% 이상',
  '디테일 일치',
  '색상이 크림/블랙과 같음',
  '레퍼런스에 사람 없음',
  '실존 인물 연상 없음',
  '이미지 속 문구·가격 없음',
  '상품 1개 · 모델 1명',
];

function renderChecklist(props: Partial<G3ChecklistProps> = {}) {
  const onPass = vi.fn();
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <G3Checklist
          candidateId={1}
          output={thumbnailOutput({
            generationRuns: [generationSummary({ slotNo: 1 }), generationSummary({ slotNo: 2 })],
          })}
          selectedColor="크림/블랙"
          pick={{ representative: 901, additional: [] }}
          representativeSlotNo={1}
          running={false}
          passedSame={false}
          pending={false}
          error={null}
          onPass={onPass}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onPass };
}

const passButton = () => screen.getByRole('button', { name: '썸네일 선택(G3)' });

describe('G3Checklist(SCR-05 선택 전 확인, P3-02)', () => {
  it('7개를 모두 체크하기 전에는 버튼이 꺼져 있고 이유 글이 있다. 다 체크하면 켜지고 누르면 체크값을 넘긴다', async () => {
    const { onPass } = renderChecklist();
    expect(screen.getByText('후보 1 기준 · 7개 모두 확인')).toBeInTheDocument();
    const user = userEvent.setup();
    expect(passButton()).toBeDisabled();
    expect(screen.getByText('7개를 모두 확인해 주세요.')).toBeInTheDocument();
    for (const label of LABELS.slice(0, 6)) {
      await user.click(screen.getByRole('checkbox', { name: label }));
      expect(passButton()).toBeDisabled();
    }
    await user.click(screen.getByRole('checkbox', { name: LABELS[6]! }));
    expect(passButton()).toBeEnabled();
    await user.click(passButton());
    expect(onPass).toHaveBeenCalledWith(
      expect.objectContaining({ shoeRatioOver70: true, singleProductSingleModel: true }),
      false,
    );
  });

  it("'같은 상품·색상' 체크는 sameProductColorRequired일 때만 보이고, 아니면 보드의 설명 문장", async () => {
    renderChecklist();
    expect(screen.queryByRole('checkbox', { name: /같은 상품·색상 확인/ })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "레퍼런스가 이 후보의 라쿠텐 상품(같은 앵커 키) 이미지라서 '같은 상품·색상' 확인은 따로 받지 않습니다.",
      ),
    ).toBeInTheDocument();
  });

  it("sameProductColorRequired면 7개를 체크해도 '같은 상품·색상' 확인 전에는 꺼져 있다", async () => {
    const { onPass } = renderChecklist({
      output: thumbnailOutput({
        sameProductColorRequired: true,
        generationRuns: [generationSummary({ slotNo: 1 })],
      }),
    });
    const user = userEvent.setup();
    for (const label of LABELS) await user.click(screen.getByRole('checkbox', { name: label }));
    expect(passButton()).toBeDisabled();
    expect(screen.getByText("'같은 상품·색상'을 확인해 주세요.")).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /같은 상품·색상 확인/ }));
    await user.click(passButton());
    expect(onPass).toHaveBeenCalledWith(expect.any(Object), true);
  });

  it('통과 뒤: G3 배지·시각·다시 골라야 하는 조건·다음 버튼, 대표가 없으면 잠김', () => {
    renderChecklist({
      output: thumbnailOutput({
        stepRunStatus: 'COMPLETED',
        g3: {
          gatePassId: 3,
          passedAt: '2026-09-28T05:24:00.000Z',
          basisStepRunId: 103,
          valid: true,
          changedBasisKeys: [],
        },
      }),
      passedSame: true,
    });
    expect(screen.getByText('G3 썸네일 선택 · 통과')).toBeInTheDocument();
    expect(screen.getByText('14:24')).toBeInTheDocument();
    expect(
      screen.getByText('레퍼런스·선택본·앵커 키가 바뀌면 다시 골라야 합니다.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '다음: ⑥ 상세 콘텐츠' })).toHaveAttribute(
      'href',
      '/candidates/1/content',
    );
    expect(screen.queryByRole('button', { name: '썸네일 선택(G3)' })).not.toBeInTheDocument();
  });
});
