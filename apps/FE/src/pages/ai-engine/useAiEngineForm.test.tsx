import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import {
  aiCliCheck,
  aiCliCheckLatestList,
  aiEngineSettings,
  boardChecks,
} from '@/test/fixtures/aiEngine';
import { createTestQueryClient } from '@/test/renderRoute';
import {
  BEFORE_SAVE_TIMEOUT_MESSAGE,
  BEFORE_SAVE_TIMEOUT_MS,
  SMOKE_TEST_TIMEOUT_MESSAGE,
  type UseAiEngineFormInput,
  useAiEngineForm,
} from './useAiEngineForm';

const AGY_TEXT = 'gemini-3.8-flash-medium';

function wrapper() {
  const queryClient = createTestQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

function setup(beforeSaveTimeoutMs?: number) {
  const api = stubApi({
    'POST /ai-cli-checks': () =>
      jsonResponse(
        {
          engineCodes: ['AGY'],
          smokeTest: true,
          trigger: 'BEFORE_SAVE',
          status: 'RUNNING',
          acceptedAt: new Date().toISOString(),
        },
        202,
      ),
    'PUT /settings/ai-engine': () => jsonResponse(aiEngineSettings({ selectedEngine: 'AGY' })),
  });
  const initialProps: UseAiEngineFormInput = {
    settings: aiEngineSettings(),
    latest: aiCliCheckLatestList(),
    history: [],
    trigger: 'MANUAL',
    ...(beforeSaveTimeoutMs === undefined ? {} : { beforeSaveTimeoutMs }),
  };
  const view = renderHook((props: UseAiEngineFormInput) => useAiEngineForm(props), {
    initialProps,
    wrapper: wrapper(),
  });
  const puts = () => api.requests.filter((r) => r.method === 'PUT');
  return { api, view, initialProps, puts };
}

describe('useAiEngineForm 저장 흐름(P1-11 규칙 11, Proposed 보강)', () => {
  it('기다리는 최대 시간은 180초(BE 연결 테스트 120초 + 감지 여유)', () => {
    expect(BEFORE_SAVE_TIMEOUT_MS).toBe(180_000);
  });

  it('저장 전 연결 테스트 결과(SSE)가 제한 시간 안에 오지 않으면 기다림을 멈추고 안내한다. PUT하지 않는다', async () => {
    const { view, puts } = setup(30);
    act(() => view.result.current.pickEngine('AGY'));
    act(() => view.result.current.save());
    expect(view.result.current.phase).toBe('testing');
    expect(view.result.current.busy).toBe(true);
    await waitFor(() => expect(view.result.current.phase).toBe('idle'));
    expect(view.result.current.message).toBe(BEFORE_SAVE_TIMEOUT_MESSAGE);
    expect(view.result.current.busy).toBe(false);
    expect(view.result.current.state).toBe('needsTest');
    expect(puts()).toHaveLength(0);
  });

  it('연결 테스트 중에는 엔진·모델·되돌리기를 받지 않고, 통과하면 [저장]을 누른 때의 값으로 PUT한다', async () => {
    const { view, initialProps, puts } = setup();
    act(() => view.result.current.pickEngine('AGY'));
    act(() => view.result.current.save());
    expect(view.result.current.phase).toBe('testing');

    act(() => view.result.current.setModel('AGY', 'text', 'gemini-3.1-pro-high'));
    act(() => view.result.current.pickEngine('CLAUDE'));
    act(() => view.result.current.revert());
    expect(view.result.current.values?.engine).toBe('AGY');
    expect(view.result.current.values?.models.AGY.text).toBe(AGY_TEXT);

    // SSE → 최신 점검 다시 읽기로 AGY 통과 행이 온다
    view.rerender({
      ...initialProps,
      latest: aiCliCheckLatestList({
        ...boardChecks(),
        AGY: aiCliCheck({
          id: 9_000,
          engineCode: 'AGY',
          trigger: 'BEFORE_SAVE',
          model: AGY_TEXT,
          authStatus: 'UNKNOWN',
          checkedAt: new Date().toISOString(),
        }),
      }),
    });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(await puts()[0]!.clone().json()).toEqual({
      selectedEngine: 'AGY',
      models: {
        CLAUDE: { text: 'sonnet', vision: 'sonnet' },
        AGY: { text: AGY_TEXT, vision: 'gemini-3.8-flash-high' },
        CODEX: { text: null, vision: null },
      },
    });
  });
});

describe('useAiEngineForm 카드 [연결 테스트](Proposed)', () => {
  it('보내면 결과 행이 올 때까지 testingEngine이 켜져 있고, 그 사이 다른 [연결 테스트]는 보내지 않는다', async () => {
    const { api, view, initialProps } = setup();
    const posts = () => api.requests.filter((r) => r.method === 'POST');
    act(() => view.result.current.testEngine('AGY'));
    expect(view.result.current.testingEngine).toBe('AGY');
    await waitFor(() => expect(posts()).toHaveLength(1));
    // 요청(202)이 끝나도 결과가 오기 전까지는 계속 테스트 중
    await waitFor(() => expect(view.result.current.requesting).toBe(false));
    expect(view.result.current.testingEngine).toBe('AGY');
    act(() => view.result.current.testEngine('CLAUDE'));
    expect(posts()).toHaveLength(1);

    view.rerender({
      ...initialProps,
      latest: aiCliCheckLatestList({
        ...boardChecks(),
        AGY: aiCliCheck({
          id: 9_100,
          engineCode: 'AGY',
          trigger: 'MANUAL',
          model: AGY_TEXT,
          authStatus: 'UNKNOWN',
          checkedAt: new Date().toISOString(),
        }),
      }),
    });
    await waitFor(() => expect(view.result.current.testingEngine).toBeNull());
    expect(view.result.current.message).toBeNull();
  });

  it('결과(SSE)가 제한 시간 안에 오지 않으면 testingEngine을 끄고 안내한다', async () => {
    const { view } = setup(30);
    act(() => view.result.current.testEngine('AGY'));
    expect(view.result.current.testingEngine).toBe('AGY');
    await waitFor(() => expect(view.result.current.testingEngine).toBeNull());
    expect(view.result.current.message).toBe(SMOKE_TEST_TIMEOUT_MESSAGE);
  });
});
