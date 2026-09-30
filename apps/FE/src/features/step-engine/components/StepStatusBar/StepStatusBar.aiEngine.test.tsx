import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/shared/api/errors';
import { railItem } from '@/test/fixtures/stepEngine';
import { createTestQueryClient } from '@/test/renderRoute';
import { StepStatusBar } from './StepStatusBar';

function renderInRouter(ui: ReactElement) {
  const router = createMemoryRouter([{ path: '/', element: ui }], { initialEntries: ['/'] });
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const failedItem = (errorCode: string, errorMessage: string) =>
  railItem(
    { stepCode: 'COPY', status: 'FAILED' },
    {
      status: 'FAILED',
      failureKind: 'AI',
      errorCode,
      errorMessage,
      aiEngine: 'CLAUDE',
      aiModel: 'sonnet',
    },
  );

describe('StepStatusBar — AI 엔진(P1-10, F-BS-75·76)', () => {
  it("실행 기록 errorCode가 AI_ENGINE_UNAVAILABLE이면 오류 문구 옆 'AI 엔진 설정으로' 링크(href /settings/ai-engine)", async () => {
    renderInRouter(
      <StepStatusBar
        source="⑤ 썸네일"
        item={failedItem(
          'AI_ENGINE_UNAVAILABLE',
          "선택한 AI 엔진(Claude Code)을 지금 쓸 수 없습니다(설치되지 않음). 'AI 엔진' 설정에서 확인해 주세요.",
        )}
      />,
    );
    expect(await screen.findByText(/지금 쓸 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AI 엔진 설정으로' })).toHaveAttribute(
      'href',
      '/settings/ai-engine',
    );
  });

  it('다른 오류 코드에는 링크가 없다', async () => {
    renderInRouter(
      <StepStatusBar
        source="x"
        item={failedItem('AI_OUTPUT_INVALID', 'AI 결과가 정해진 형식과 달라 쓰지 않았습니다.')}
      />,
    );
    expect(await screen.findByText(/형식과 달라/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'AI 엔진 설정으로' })).toBeNull();
  });

  it("시작 409(error prop)의 code가 AI_ENGINE_UNAVAILABLE이면 문구 + 링크, 현재 실행이 AI를 썼으면 'AI 생성 · Claude Code' 칩", async () => {
    const error = new ApiRequestError({
      code: 'AI_ENGINE_UNAVAILABLE',
      message:
        "선택한 AI 엔진(Codex)을 지금 쓸 수 없습니다(로그인 풀림). 'AI 엔진' 설정에서 확인해 주세요.",
      status: 409,
      timestamp: '2026-09-28T09:00:00+09:00',
      path: '/api/v1/candidates/13/steps/COPY/runs',
    });
    renderInRouter(
      <StepStatusBar
        source="x"
        error={error}
        item={railItem(
          { stepCode: 'COPY', status: 'COMPLETED' },
          { aiEngine: 'CLAUDE', aiModel: 'sonnet' },
        )}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/로그인 풀림/);
    expect(screen.getByRole('link', { name: 'AI 엔진 설정으로' })).toHaveAttribute(
      'href',
      '/settings/ai-engine',
    );
    expect(screen.getByText('AI 생성 · Claude Code')).toBeInTheDocument();
  });

  it('AI를 쓰지 않은 실행에는 AI 생성 칩이 없다', async () => {
    renderInRouter(
      <StepStatusBar source="x" item={railItem({ stepCode: 'PRICING', status: 'COMPLETED' })} />,
    );
    expect(await screen.findByText(/입력 출처/)).toBeInTheDocument();
    expect(screen.queryByText(/AI 생성/)).toBeNull();
  });
});
