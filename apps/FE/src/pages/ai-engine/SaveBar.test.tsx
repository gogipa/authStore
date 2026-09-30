import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { FakeEventSource } from '@/test/fakeEventSource';
import {
  aiCliCheck,
  aiCliCheckLatestList,
  aiCliCheckPage,
  aiEngineSettings,
  boardChecks,
} from '@/test/fixtures/aiEngine';
import { callUsageList } from '@/test/fixtures/callUsage';
import { moduleClassNames } from '@/test/cssModules';
import { renderRoute } from '@/test/renderRoute';
import { SAVE_BAR_HELP, SaveBar, type SaveBarProps } from './SaveBar';

function renderBar(props: Partial<SaveBarProps> = {}) {
  const handlers = { onRevert: vi.fn(), onSave: vi.fn() };
  render(
    <SaveBar
      state="unchanged"
      savedEngine="CLAUDE"
      savedTextModel="sonnet"
      savedVisionModel="sonnet"
      pickedEngine="CLAUDE"
      {...handlers}
      {...props}
    />,
  );
  return { bar: screen.getByRole('region', { name: '저장' }), ...handlers };
}

describe('SaveBar(04-3 organism, SCR-13 하단 고정 저장 바)', () => {
  it('unchanged: 보드 문구 + 두 버튼 꺼짐', () => {
    const { bar } = renderBar();
    expect(bar).toHaveTextContent(
      '바뀐 것이 없습니다 · 사용 중 Claude Code 텍스트 sonnet · 비전 sonnet',
    );
    expect(within(bar).getByText(SAVE_BAR_HELP)).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: '되돌리기' })).toBeDisabled();
    expect(within(bar).getByRole('button', { name: '저장' })).toBeDisabled();
  });

  it('needsTest: 변경 문구(waiting) + 버튼 켜짐, tested: 연결 테스트 통과(done)', async () => {
    const { bar, onSave, onRevert } = renderBar({ state: 'needsTest', pickedEngine: 'AGY' });
    expect(within(bar).getByRole('status')).toHaveTextContent(
      '변경: Claude Code → Antigravity CLI · 연결 테스트 필요',
    );
    expect(moduleClassNames(within(bar).getByText('연결 테스트 필요'))).toEqual(['needsTest']);
    await userEvent.click(within(bar).getByRole('button', { name: '저장' }));
    await userEvent.click(within(bar).getByRole('button', { name: '되돌리기' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onRevert).toHaveBeenCalledTimes(1);
  });

  it('tested: 연결 테스트 통과, changed(저장 흐름 중): 두 버튼 꺼짐', () => {
    renderBar({ state: 'tested', pickedEngine: 'AGY' });
    expect(screen.getByRole('status')).toHaveTextContent(
      '변경: Claude Code → Antigravity CLI · 연결 테스트 통과',
    );
    expect(moduleClassNames(screen.getByText('연결 테스트 통과'))).toEqual(['tested']);
  });

  it('저장 흐름 중이면 두 버튼이 꺼지고 단계 글자를 보인다', () => {
    const { bar } = renderBar({ state: 'changed', phase: 'testing', pickedEngine: 'AGY' });
    expect(within(bar).getByText('연결 테스트 중…')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: '저장' })).toBeDisabled();
    expect(within(bar).getByRole('button', { name: '되돌리기' })).toBeDisabled();
  });

  it('화면에서: AGY를 고르면 연결 테스트 필요 → ai-cli-check.completed 뒤 PASSED면 연결 테스트 통과', async () => {
    const state = { latest: aiCliCheckLatestList() };
    stubApi({
      'GET /call-usage': () => jsonResponse(callUsageList()),
      'GET /settings/ai-engine': () => jsonResponse(aiEngineSettings()),
      'GET /ai-cli-checks/latest': () => jsonResponse(state.latest),
      'GET /ai-cli-checks': () => jsonResponse(aiCliCheckPage()),
      'POST /ai-cli-checks': () =>
        jsonResponse(
          {
            engineCodes: ['AGY'],
            smokeTest: true,
            trigger: 'MANUAL',
            status: 'RUNNING',
            acceptedAt: new Date().toISOString(),
          },
          202,
        ),
    });
    renderRoute('/settings/ai-engine', { EventSourceImpl: FakeEventSource });
    const group = await screen.findByRole('radiogroup', { name: 'AI 엔진 고르기' });
    const es = FakeEventSource.latest();
    act(() => es.open());
    const bar = screen.getByRole('region', { name: '저장' });
    expect(bar).toHaveTextContent('바뀐 것이 없습니다');
    const agyCard = group.querySelector<HTMLElement>('[data-engine="AGY"]')!;
    await userEvent.click(within(agyCard).getByRole('radio'));
    expect(within(bar).getByRole('status')).toHaveTextContent(
      '변경: Claude Code → Antigravity CLI · 연결 테스트 필요',
    );
    await userEvent.click(within(agyCard).getByRole('button', { name: '연결 테스트' }));
    state.latest = aiCliCheckLatestList({
      ...boardChecks(),
      AGY: aiCliCheck({
        engineCode: 'AGY',
        trigger: 'MANUAL',
        model: 'gemini-3.8-flash-medium',
        authStatus: 'UNKNOWN',
        checkedAt: new Date().toISOString(),
      }),
    });
    act(() =>
      es.emit('ai-cli-check.completed', {
        engineCode: 'AGY',
        installed: true,
        cliVersion: '1.2.9',
        authStatus: 'UNKNOWN',
        smokeStatus: 'PASSED',
        latencyMs: 9800,
        errorCode: null,
      }),
    );
    await waitFor(() =>
      expect(within(bar).getByRole('status')).toHaveTextContent(
        '변경: Claude Code → Antigravity CLI · 연결 테스트 통과',
      ),
    );
    expect(within(bar).getByRole('button', { name: '저장' })).toBeEnabled();
  });
});
