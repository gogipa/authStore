import { describe, expect, it, vi } from 'vitest';
import { CLIENT_HEADER, createApiClient, isApiError } from './client';

function recordingFetch() {
  const requests: Request[] = [];
  const fetchMock = vi.fn(async (input: Request) => {
    requests.push(input);
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { requests, fetch: fetchMock as unknown as typeof fetch };
}

describe('API 클라이언트 미들웨어', () => {
  it('GET에는 X-AutoStore-Client를 붙이지 않는다', async () => {
    const { requests, fetch } = recordingFetch();
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:3100/api/v1', fetch });

    await client.GET('/ai-cli-checks/latest');

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe('http://127.0.0.1:3100/api/v1/ai-cli-checks/latest');
    expect(requests[0]?.headers.get(CLIENT_HEADER)).toBeNull();
  });

  it('POST에는 X-AutoStore-Client: 1을 붙인다', async () => {
    const { requests, fetch } = recordingFetch();
    const client = createApiClient({ baseUrl: 'http://127.0.0.1:3100/api/v1', fetch });

    await client.POST('/ai-cli-checks', { body: { smokeTest: false, trigger: 'MANUAL' } });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.headers.get(CLIENT_HEADER)).toBe('1');
  });

  it('isApiError는 05-3 오류 봉투를 알아본다', () => {
    expect(
      isApiError({
        code: 'CLIENT_HEADER_REQUIRED',
        message: '요청 헤더가 없습니다.',
        status: 403,
        timestamp: '2026-09-27T00:00:00Z',
        path: '/api/v1/x',
      }),
    ).toBe(true);
    expect(isApiError({ message: 'x' })).toBe(false);
    expect(isApiError(null)).toBe(false);
  });
});
