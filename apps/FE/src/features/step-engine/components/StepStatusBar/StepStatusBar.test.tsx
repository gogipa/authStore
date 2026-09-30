import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { disabled, ENABLED, railItem } from '@/test/fixtures/stepEngine';
import { createTestQueryClient } from '@/test/renderRoute';
import { StepStatusBar } from './StepStatusBar';

function renderBar(ui: React.ReactElement) {
  return render(<QueryClientProvider client={createTestQueryClient()}>{ui}</QueryClientProvider>);
}

describe('StepStatusBar — 여기부터 연속 실행(P1-06)', () => {
  it("candidateId를 주면 '여기부터 연속 실행'을 그리고 누르면 FROM_HERE로 POST 한 번", async () => {
    const api = stubApi();
    let body: unknown = null;
    api.on('POST /candidates/13/continuous-runs', async (req) => {
      body = await req.json();
      return jsonResponse({ stepChainId: 3, stepRunId: 9, stepCode: 'PRICING' }, 202);
    });
    renderBar(
      <StepStatusBar
        candidateId={13}
        source="② 소싱 산출물"
        item={railItem({
          stepCode: 'PRICING',
          status: 'COMPLETED',
          actions: { run: ENABLED, continuousRun: ENABLED, edit: disabled('X', 'x') },
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '여기부터 연속 실행' }));
    await waitFor(() => expect(body).toEqual({ kind: 'FROM_HERE', startStepCode: 'PRICING' }));
  });

  it("G2 전 ④ 이후는 꺼짐 + '판정(G2)을 통과해야 ④부터 …', candidateId가 없거나 ⑧이면 그리지 않는다", () => {
    stubApi();
    const { rerender } = renderBar(
      <StepStatusBar
        candidateId={13}
        source="② 소싱 산출물"
        item={railItem({
          stepCode: 'CATEGORY',
          actions: {
            run: ENABLED,
            continuousRun: disabled('CONTINUOUS_RUN_BEFORE_G2', 'x'),
            edit: disabled('X', 'x'),
          },
        })}
      />,
    );
    const button = screen.getByRole('button', { name: '여기부터 연속 실행' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      '판정(G2)을 통과해야 ④부터 연속 실행할 수 있습니다. 그 전에는 단계를 하나씩 실행합니다.',
    );
    rerender(
      <QueryClientProvider client={createTestQueryClient()}>
        <StepStatusBar source="x" item={railItem({ stepCode: 'CATEGORY' })} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: '여기부터 연속 실행' })).toBeNull();
    rerender(
      <QueryClientProvider client={createTestQueryClient()}>
        <StepStatusBar candidateId={13} source="x" item={railItem({ stepCode: 'UPLOAD' })} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: '여기부터 연속 실행' })).toBeNull();
  });
});
