import { describe, expect, it } from 'vitest';
import { createApiClient } from './client';
import {
  ApiRequestError,
  CLIENT_ERROR_CODES,
  isApiRequestError,
  request,
  toApiRequestError,
  unwrap,
} from './errors';

const BASE = 'http://127.0.0.1:3100/api/v1';

function clientReturning(response: () => Response) {
  return createApiClient({ baseUrl: BASE, fetch: (async () => response()) as typeof fetch });
}

const DAILY_LIMIT = {
  code: 'DAILY_LIMIT_REACHED',
  message: '오늘 라쿠텐 페이지 조회 한도(110회)를 모두 썼습니다. 내일 0시(KST)에 다시 열립니다.',
  status: 409,
  timestamp: '2026-09-27T14:02:11+09:00',
  path: '/api/v1/call-usage',
  details: { target: 'RAKUTEN_PAGE' },
};

describe('unwrap', () => {
  it('2xx면 data를 돌려준다', async () => {
    const client = clientReturning(() => Response.json({ items: [] }));
    await expect(request(() => client.GET('/call-usage'))).resolves.toEqual({ items: [] });
  });

  it('409 봉투를 받으면 ApiRequestError를 던진다(code·status·message가 봉투 그대로)', async () => {
    const client = clientReturning(() => Response.json(DAILY_LIMIT, { status: 409 }));
    const result = await client.GET('/call-usage');

    let thrown: unknown;
    try {
      unwrap(result);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiRequestError);
    const error = thrown as ApiRequestError;
    expect(error.code).toBe('DAILY_LIMIT_REACHED');
    expect(error.status).toBe(409);
    expect(error.message).toBe(DAILY_LIMIT.message);
    expect(error.envelope).toEqual(DAILY_LIMIT);
    expect(error.fromServer).toBe(true);
    expect(isApiRequestError(error)).toBe(true);
  });

  it('봉투가 아닌 응답(프록시 502 HTML)은 UNEXPECTED_RESPONSE 봉투로 바꾼다', async () => {
    const client = clientReturning(
      () =>
        new Response('<html><body>Bad Gateway</body></html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        }),
    );
    const result = await client.GET('/call-usage');
    expect(() => unwrap(result)).toThrow(ApiRequestError);
    try {
      unwrap(result);
    } catch (error) {
      const e = error as ApiRequestError;
      expect(e.code).toBe(CLIENT_ERROR_CODES.UNEXPECTED_RESPONSE);
      expect(e.status).toBe(502);
      expect(e.message).toContain('앱 서버에 연결하지 못했습니다');
      expect(e.fromServer).toBe(false);
    }
  });

  it('본문이 빈 오류 응답도 봉투를 만든다', async () => {
    const client = clientReturning(() => new Response(null, { status: 500 }));
    const result = await client.GET('/call-usage');
    expect(() => unwrap(result)).toThrow('서버 응답을 읽지 못했습니다. (HTTP 500)');
  });

  it('204(본문 없음) 성공은 undefined', () => {
    expect(unwrap({ data: undefined, response: new Response(null, { status: 204 }) })).toBe(
      undefined,
    );
  });
});

describe('request / toApiRequestError', () => {
  it('fetch가 실패하면 NETWORK_ERROR(status 0)로 바꾼다', async () => {
    const client = createApiClient({
      baseUrl: BASE,
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    await expect(request(() => client.GET('/call-usage'))).rejects.toMatchObject({
      code: CLIENT_ERROR_CODES.NETWORK_ERROR,
      status: 0,
    });
  });

  it('취소(AbortError)는 그대로 던진다', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    await expect(
      request(async () => {
        throw abort;
      }),
    ).rejects.toBe(abort);
  });

  it('이미 ApiRequestError면 그대로 돌려준다', () => {
    const error = new ApiRequestError(DAILY_LIMIT);
    expect(toApiRequestError(error)).toBe(error);
  });
});
