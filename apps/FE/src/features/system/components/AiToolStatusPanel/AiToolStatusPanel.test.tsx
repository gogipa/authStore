import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import {
  aiCliCheck,
  aiCliCheckLatestList,
  aiCliCheckPage,
  boardChecks,
} from '@/test/fixtures/aiEngine';
import { createTestQueryClient } from '@/test/renderRoute';
import { AiToolStatusPanel } from './AiToolStatusPanel';

function renderPanel() {
  const router = createMemoryRouter([{ path: '/', element: <AiToolStatusPanel /> }]);
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("SCR-11 'AI 도구 상태'(P1-11 규칙 13)", () => {
  it("선택 엔진에 '선택됨'과 둘째 줄, 머리에 'AI 엔진 설정으로'(/settings/ai-engine)", async () => {
    stubApi({
      'GET /ai-cli-checks/latest': () => jsonResponse(aiCliCheckLatestList()),
      'GET /ai-cli-checks': () => jsonResponse(aiCliCheckPage()),
    });
    renderPanel();
    const panel = await screen.findByRole('region', { name: 'AI 도구 상태' });
    const list = await within(panel).findByRole('list', { name: '텍스트·비전 AI 엔진' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-engine'))).toEqual(['CLAUDE', 'AGY', 'CODEX']);
    expect(within(rows[0]!).getByText('선택됨')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('정상')).toBeInTheDocument();
    expect(
      within(rows[0]!).getByText('2.1.269 · 로그인됨 · 연결 테스트 통과 12.7초'),
    ).toBeInTheDocument();
    expect(within(rows[1]!).queryByText('선택됨')).toBeNull();
    expect(within(rows[1]!).getByText('테스트 안 함')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('설치 안 됨')).toBeInTheDocument();
    const link = within(panel).getByRole('link', { name: 'AI 엔진 설정으로' });
    expect(link).toHaveAttribute('href', '/settings/ai-engine');
    // 이미지 생성 CLI 줄은 M1에 조회 API가 없어 그리지 않는다(Proposed)
    expect(within(panel).queryByText(/이미지 생성/)).toBeNull();
  });

  it('versionSupported=false면 경고 문구와 AI 엔진 설정 링크가 보인다', async () => {
    stubApi({
      'GET /ai-cli-checks/latest': () =>
        jsonResponse(
          aiCliCheckLatestList({
            ...boardChecks(),
            CLAUDE: aiCliCheck({ cliVersion: '1.0.0', versionSupported: false }),
          }),
        ),
      'GET /ai-cli-checks': () => jsonResponse(aiCliCheckPage()),
    });
    renderPanel();
    const warning = await screen.findByText(/Claude Code 1\.0\.0은 지원 범위 밖 버전입니다/);
    const banner = warning.closest('[role="status"]') as HTMLElement;
    expect(within(banner).getByRole('link', { name: 'AI 엔진 설정으로' })).toHaveAttribute(
      'href',
      '/settings/ai-engine',
    );
  });

  it('선택 엔진이 감지만 됐어도(최신 SKIPPED) 이력의 마지막 연결 테스트를 보인다', async () => {
    const passed = aiCliCheck({ id: 1, checkedAt: '2026-09-27T04:00:00.000Z', latencyMs: 9800 });
    const latestList = aiCliCheckLatestList({
      ...boardChecks(),
      CLAUDE: aiCliCheck({ id: 2, smokeStatus: 'SKIPPED', model: null, latencyMs: null }),
    });
    stubApi({
      'GET /ai-cli-checks/latest': () => jsonResponse(latestList),
      'GET /ai-cli-checks': () => jsonResponse(aiCliCheckPage([passed])),
    });
    renderPanel();
    expect(
      await screen.findByText('2.1.269 · 로그인됨 · 연결 테스트 통과 9.8초'),
    ).toBeInTheDocument();
  });
});
