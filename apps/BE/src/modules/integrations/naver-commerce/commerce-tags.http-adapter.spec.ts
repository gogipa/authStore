import { ApiException } from '../../../common/errors/api.exception.js';
import type { Clock } from '../http/clock.token.js';
import type { CommerceApiClient, CommerceApiResponse } from './commerce-api.client.js';
import {
  CommerceTagsHttpAdapter,
  parseTagsJson,
  recommendCacheKey,
  toRecommendedTags,
} from './commerce-tags.http-adapter.js';
import {
  COMMERCE_RECOMMEND_TAGS_PATH,
  COMMERCE_RESTRICTED_TAGS_PATH,
} from './commerce-tags.port.js';

function response(status: number, body: string): CommerceApiResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    body: Buffer.from(body),
    data: null,
    error:
      status >= 300 ? { code: `E${status}`, message: 'x', invalidInputs: [], traceId: null } : null,
    traceId: null,
    callLogId: 1,
    retriedAfterReissue: false,
  };
}

function setup() {
  const calls: { method: string; path: string; query: unknown; stepRunId: unknown }[] = [];
  const queue: CommerceApiResponse[] = [];
  const client = {
    request: (method: string, path: string, options: { query?: unknown; stepRunId?: unknown }) => {
      calls.push({ method, path, query: options.query, stepRunId: options.stepRunId });
      return Promise.resolve(queue.shift() ?? response(200, '[]'));
    },
  } as unknown as CommerceApiClient;
  let now = Date.parse('2026-09-28T00:00:00Z');
  const clock: Clock = { now: () => new Date(now), sleep: () => Promise.resolve() };
  const adapter = new CommerceTagsHttpAdapter(client, clock);
  return { adapter, calls, queue, advance: (ms: number) => (now += ms) };
}

describe('커머스API 태그 어댑터(P3-05 규칙 2·10)', () => {
  it('추천 태그: code는 int64 원문 글자(정밀도 손실 없음), 모양이 다른 원소는 뺀다', async () => {
    const { adapter, calls, queue } = setup();
    queue.push(
      response(
        200,
        '[{"code":12345678901234567890,"text":"젤카야노14"},{"code":"77","text":"조깅화"},{"text":"코드없음"},{"code":1,"text":""}]',
      ),
    );
    const tags = await adapter.recommendTags(' 아식스 젤카야노14 ', {
      cacheTtlMs: 0,
      stepRunId: 9,
    });
    expect(tags).toEqual([
      { code: '12345678901234567890', text: '젤카야노14' },
      { code: '77', text: '조깅화' },
    ]);
    expect(calls).toEqual([
      {
        method: 'GET',
        path: COMMERCE_RECOMMEND_TAGS_PATH,
        query: { keyword: '아식스 젤카야노14' },
        stepRunId: 9,
      },
    ]);
  });

  it('추천 응답은 메모리에 캐시한다(키 = NFKC·소문자·공백 정리, TTL 지나면 다시 부른다)', async () => {
    const { adapter, calls, queue, advance } = setup();
    queue.push(response(200, '[{"code":1,"text":"a"}]'), response(200, '[{"code":2,"text":"b"}]'));
    const ttl = 10 * 60_000;
    expect(await adapter.recommendTags('GEL  Kayano', { cacheTtlMs: ttl })).toEqual([
      { code: '1', text: 'a' },
    ]);
    expect(await adapter.recommendTags('gel kayano', { cacheTtlMs: ttl })).toEqual([
      { code: '1', text: 'a' },
    ]);
    expect(calls).toHaveLength(1);
    advance(ttl + 1);
    expect(await adapter.recommendTags('gel kayano', { cacheTtlMs: ttl })).toEqual([
      { code: '2', text: 'b' },
    ]);
    expect(calls).toHaveLength(2);
    expect(recommendCacheKey(' ＧＥＬ  Kayano ')).toBe('gel kayano');
  });

  it('추천 400은 그 키워드의 추천 없음, 500·모양이 다른 200은 502 EXTERNAL_API_ERROR', async () => {
    const { adapter, queue } = setup();
    queue.push(response(400, '{"code":"BAD"}'));
    expect(await adapter.recommendTags('x', { cacheTtlMs: 0 })).toEqual([]);
    queue.push(response(503, '{}'));
    await expect(adapter.recommendTags('y', { cacheTtlMs: 0 })).rejects.toMatchObject({
      code: 'EXTERNAL_API_ERROR',
      details: { target: 'COMMERCE_API', reason: 'HTTP_503' },
    });
    queue.push(response(200, '{"unexpected":true}'));
    await expect(adapter.recommendTags('z', { cacheTtlMs: 0 })).rejects.toBeInstanceOf(
      ApiException,
    );
  });

  it('제한 태그: 반복 파라미터 tags로 보내고 {tag, restricted}를 읽는다. 빈 목록이면 부르지 않는다', async () => {
    const { adapter, calls, queue } = setup();
    expect(await adapter.restrictedTags([])).toEqual([]);
    expect(calls).toHaveLength(0);
    queue.push(
      response(200, '[{"tag":"정품운동화","restricted":true},{"tag":"조깅화","restricted":false}]'),
    );
    expect(await adapter.restrictedTags(['정품운동화', '조깅화'], { candidateId: 3 })).toEqual([
      { tag: '정품운동화', restricted: true },
      { tag: '조깅화', restricted: false },
    ]);
    expect(calls[0]).toMatchObject({
      path: COMMERCE_RESTRICTED_TAGS_PATH,
      query: { tags: ['정품운동화', '조깅화'] },
    });
    queue.push(response(429, '{}'));
    await expect(adapter.restrictedTags(['a'])).rejects.toMatchObject({
      code: 'EXTERNAL_API_ERROR',
      details: { reason: 'HTTP_429' },
    });
  });

  it('목록 모양: 배열 또는 {tags|contents|data|items: [...]}', () => {
    expect(
      toRecommendedTags(parseTagsJson(Buffer.from('{"tags":[{"code":5,"text":"t"}]}'))),
    ).toEqual([{ code: '5', text: 't' }]);
    expect(toRecommendedTags(parseTagsJson(Buffer.from('not json')))).toBeNull();
  });
});
