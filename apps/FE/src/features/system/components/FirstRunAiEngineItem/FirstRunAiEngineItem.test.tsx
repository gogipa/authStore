import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { aiCliCheck, aiCliCheckLatestList, detectedOnly } from '@/test/fixtures/aiEngine';
import { engineCheckViews } from '../../model/aiEngineStatus';
import { FirstRunAiEngineItem } from './FirstRunAiEngineItem';

function renderItem(views: Parameters<typeof FirstRunAiEngineItem>[0]['views']) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <ul>
          <FirstRunAiEngineItem views={views} />
        </ul>
      ),
    },
  ]);
  return render(<RouterProvider router={router} />);
}

describe("첫 실행 'AI 엔진 고르기'(F-SY-23, P1-11 규칙 14)", () => {
  it('선택 엔진이 연결 테스트를 통과하지 않았으면 할 일 + 추천(CLAUDE → CODEX → AGY)', () => {
    renderItem(
      engineCheckViews(
        aiCliCheckLatestList({
          CLAUDE: detectedOnly('CLAUDE', { installed: false }),
          AGY: aiCliCheck({ engineCode: 'AGY' }),
          CODEX: aiCliCheck({ engineCode: 'CODEX' }),
        }),
      ),
    );
    expect(screen.getByText('할 일')).toBeInTheDocument();
    expect(
      screen.getByText(
        '추천 Codex · 연결 테스트를 통과한 엔진입니다. AI 엔진에서 골라 저장해 주세요.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AI 엔진' })).toHaveAttribute(
      'href',
      '/settings/ai-engine?from=first-run',
    );
  });

  it('통과한 엔진이 없으면 감지·연결 테스트를 하라고 안내한다', () => {
    renderItem(engineCheckViews(aiCliCheckLatestList({ CLAUDE: detectedOnly('CLAUDE') })));
    expect(
      screen.getByText(
        '연결 테스트를 통과한 엔진이 아직 없습니다. AI 엔진에서 감지·연결 테스트를 해 주세요.',
      ),
    ).toBeInTheDocument();
  });
});
