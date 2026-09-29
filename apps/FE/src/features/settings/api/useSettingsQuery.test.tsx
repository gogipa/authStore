import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { settingsQueryKey, useSettingsQuery } from './useSettingsQuery';
import { useReloadSettingsMutation } from './useReloadSettingsMutation';
import { ApiRequestError } from '@/shared/api/errors';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { settingsReloadResult, settingsView } from '@/test/fixtures/settings';
import { createTestQueryClient } from '@/test/renderRoute';

function wrapperWith() {
  const queryClient = createTestQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, Wrapper };
}

describe('useSettingsQuery', () => {
  it("queryKey는 ['settings','getSettings']이고 GET /settings를 부른다(헤더 없음)", async () => {
    const api = stubApi({ 'GET /settings': () => jsonResponse(settingsView()) });
    const { queryClient, Wrapper } = wrapperWith();
    const { result } = renderHook(() => useSettingsQuery(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(settingsQueryKey).toEqual(['settings', 'getSettings']);
    expect(queryClient.getQueryData(['settings', 'getSettings'])).toEqual(settingsView());
    expect(api.requests[0]?.headers.get('X-AutoStore-Client')).toBeNull();
  });

  it('503 SETTINGS_INVALID는 봉투 그대로의 ApiRequestError(fieldErrors 포함)', async () => {
    stubApi({
      'GET /settings': () =>
        errorResponse(503, 'SETTINGS_INVALID', '설정 파일에 오류가 있어…', {
          fieldErrors: [{ field: '/', message: 'JSON 문법 오류' }],
        }),
    });
    const { Wrapper } = wrapperWith();
    const { result } = renderHook(() => useSettingsQuery(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiRequestError);
    expect(result.current.error?.code).toBe('SETTINGS_INVALID');
    expect(result.current.error?.envelope.fieldErrors).toEqual([
      { field: '/', message: 'JSON 문법 오류' },
    ]);
  });
});

describe('useReloadSettingsMutation', () => {
  it("POST /settings-snapshots(X-AutoStore-Client: 1) 뒤 ['settings']를 무효화한다", async () => {
    const api = stubApi({
      'GET /settings': () => jsonResponse(settingsView()),
      'POST /settings-snapshots': () => jsonResponse(settingsReloadResult(true), 201),
    });
    const { queryClient, Wrapper } = wrapperWith();
    const { result } = renderHook(
      () => ({ q: useSettingsQuery(), m: useReloadSettingsMutation() }),
      {
        wrapper: Wrapper,
      },
    );
    await waitFor(() => expect(result.current.q.isSuccess).toBe(true));
    await act(() => result.current.m.mutateAsync());
    await waitFor(() => expect(result.current.m.data?.created).toBe(true));
    const post = api.requests.find((r) => r.method === 'POST');
    expect(post?.headers.get('X-AutoStore-Client')).toBe('1');
    await waitFor(() => expect(api.requests.filter((r) => r.method === 'GET')).toHaveLength(2));
    expect(queryClient.getQueryState(['settings', 'getSettings'])?.status).toBe('success');
  });

  it('422도 무효화한다(서버 검사 결과가 바뀌었으므로)', async () => {
    const api = stubApi({
      'GET /settings': () => jsonResponse(settingsView()),
      'POST /settings-snapshots': () =>
        errorResponse(422, 'SETTINGS_SCHEMA_INVALID', '설정 형식이 맞지 않습니다: /x.'),
    });
    const { Wrapper } = wrapperWith();
    const { result } = renderHook(
      () => ({ q: useSettingsQuery(), m: useReloadSettingsMutation() }),
      {
        wrapper: Wrapper,
      },
    );
    await waitFor(() => expect(result.current.q.isSuccess).toBe(true));
    await act(async () => {
      await result.current.m.mutateAsync().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.m.error?.code).toBe('SETTINGS_SCHEMA_INVALID'));
    await waitFor(() => expect(api.requests.filter((r) => r.method === 'GET')).toHaveLength(2));
  });
});
