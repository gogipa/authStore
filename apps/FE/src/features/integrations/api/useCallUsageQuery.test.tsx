import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { callUsageQueryKey, useCallUsageQuery } from './useCallUsageQuery';
import { findCallUsage, formatUsageCount } from '../model/callUsage';
import { ApiRequestError } from '@/shared/api/errors';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import { createTestQueryClient } from '@/test/renderRoute';

function wrapperWith() {
  const queryClient = createTestQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, Wrapper };
}

describe('useCallUsageQuery', () => {
  it("queryKey는 ['integrations','getCallUsage']이고 GET /call-usage를 부른다", async () => {
    const api = stubApi({ 'GET /call-usage': () => jsonResponse(callUsageList(38)) });
    const { queryClient, Wrapper } = wrapperWith();
    const { result } = renderHook(() => useCallUsageQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callUsageQueryKey).toEqual(['integrations', 'getCallUsage']);
    expect(queryClient.getQueryData(['integrations', 'getCallUsage'])).toEqual(callUsageList(38));
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]?.headers.get('X-AutoStore-Client')).toBeNull();

    const usage = findCallUsage(result.current.data, 'RAKUTEN_PAGE');
    expect(usage && formatUsageCount(usage)).toBe('38/110');
  });

  it('오류는 05-3 봉투 그대로의 ApiRequestError다(화면은 code로 가르고 message를 보인다)', async () => {
    stubApi({
      'GET /call-usage': () =>
        errorResponse(403, 'HOST_NOT_ALLOWED', '이 주소로는 앱에 접속할 수 없습니다.'),
    });
    const { Wrapper } = wrapperWith();
    const { result } = renderHook(() => useCallUsageQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiRequestError);
    expect(result.current.error?.code).toBe('HOST_NOT_ALLOWED');
    expect(result.current.error?.status).toBe(403);
    expect(result.current.error?.message).toBe('이 주소로는 앱에 접속할 수 없습니다.');
  });
});

describe('callUsage 모델', () => {
  it('상한이 없는 대상은 수만 보인다', () => {
    expect(formatUsageCount({ count: 4, dailyLimit: null })).toBe('4');
    expect(findCallUsage(undefined, 'RAKUTEN_PAGE')).toBeUndefined();
    expect(findCallUsage(callUsageList(), 'AI_CLAUDE_CLI')).toBeUndefined();
  });
});
