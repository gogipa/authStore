import { rakutenSearchFixture } from '../../../../test/support/rakuten-fixture.adapters.js';
import { InMemorySecretStore } from '../../../../test/support/in-memory-secret-store.js';
import type { RakutenSearchCache } from '../../../generated/prisma/client.js';
import { DEFAULT_SETTINGS } from '../../settings/defaults/default-settings.js';
import type { SettingsService } from '../../settings/settings.service.js';
import type { Clock } from '../http/clock.token.js';
import type {
  ExternalCallContext,
  ExternalHttpGateway,
  ExternalHttpRequest,
} from '../http/external-http.gateway.js';
import type {
  RakutenSearchCacheRepository,
  RakutenSearchCacheWrite,
} from './rakuten-search-cache.repository.js';
import { RakutenSearchHttpAdapter } from './rakuten-search.http-adapter.js';

const HOUR = 3_600_000;

class FakeClock implements Clock {
  constructor(public ms: number) {}
  now(): Date {
    return new Date(this.ms);
  }
  sleep(ms: number): Promise<void> {
    this.ms += ms;
    return Promise.resolve();
  }
}

/** rakuten_search_cache를 메모리에 두는 가짜(query_hash upsert, expires_at > now만 적중) */
class MemoryCache {
  rows = new Map<string, RakutenSearchCacheWrite>();
  findFresh(queryHash: string, now: Date): Promise<RakutenSearchCache | null> {
    const row = this.rows.get(queryHash);
    if (!row || row.expiresAt.getTime() <= now.getTime()) return Promise.resolve(null);
    return Promise.resolve({
      id: 1,
      queryHash,
      keyword: row.keyword,
      genreId: row.genreId,
      page: row.page,
      requestParams: row.requestParams,
      responseItems: row.responseItems,
      resultCount: row.responseItems.length,
      fetchedAt: row.fetchedAt,
      expiresAt: row.expiresAt,
    } as unknown as RakutenSearchCache);
  }
  upsert(write: RakutenSearchCacheWrite): Promise<void> {
    this.rows.set(write.queryHash, write);
    return Promise.resolve();
  }
}

function setup(replies: { status: number; body: string }[] = []) {
  const clock = new FakeClock(Date.parse('2026-09-28T00:00:00Z'));
  const cache = new MemoryCache();
  const secrets = new InMemorySecretStore({
    initial: {
      RAKUTEN_APPLICATION_ID: 'app-id-fixture-0001',
      RAKUTEN_ACCESS_KEY: 'access-key-fixture-0001',
    },
  });
  const calls: ExternalHttpRequest[] = [];
  const gateway = {
    request: (_target: string, req: ExternalHttpRequest, ctx: ExternalCallContext = {}) => {
      calls.push(req);
      const reply = replies.shift() ?? {
        status: 200,
        body: rakutenSearchFixture('asics-1201a019-p1.json'),
      };
      const raw = { status: reply.status, headers: new Headers(), body: Buffer.from(reply.body) };
      ctx.describeResponse?.(raw);
      return Promise.resolve({ ...raw, callLogId: calls.length });
    },
  } as unknown as ExternalHttpGateway;
  const settings = { current: () => DEFAULT_SETTINGS } as unknown as SettingsService;
  const adapter = new RakutenSearchHttpAdapter(
    gateway,
    settings,
    cache as unknown as RakutenSearchCacheRepository,
    secrets,
    clock,
  );
  return { adapter, cache, calls, clock, secrets };
}

describe('Item Search 캐시(F-BS-34, P2-02 규칙 2)', () => {
  it('처음은 HTTP 1회 + 캐시 저장(키 없는 사본, 6시간), 6시간 안 같은 쿼리 → HTTP 0회', async () => {
    const { adapter, cache, calls, clock } = setup();
    const first = await adapter.search({ keyword: 'アシックス 1201A019' });
    expect(first.fromCache).toBe(false);
    expect(first.items).toHaveLength(30);
    expect(calls).toHaveLength(1);
    const saved = [...cache.rows.values()][0]!;
    expect(saved.requestParams).not.toHaveProperty('accessKey');
    expect(saved.requestParams).not.toHaveProperty('applicationId');
    expect(JSON.stringify(saved.requestParams)).not.toContain('fixture-0001');
    expect(saved.expiresAt.getTime() - saved.fetchedAt.getTime()).toBe(6 * HOUR);

    clock.ms += 6 * HOUR - 1;
    const again = await adapter.search({ keyword: 'アシックス 1201A019' });
    expect(again.fromCache).toBe(true);
    expect(again.items).toHaveLength(30);
    expect(again.fetchedAt).toEqual(first.fetchedAt);
    expect(calls).toHaveLength(1);
  });

  it('expires_at가 지나면 HTTP 1회 더', async () => {
    const { adapter, calls, clock } = setup();
    await adapter.search({ keyword: 'asics' });
    clock.ms += 6 * HOUR;
    const res = await adapter.search({ keyword: 'asics' });
    expect(res.fromCache).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('page만 달라도 다른 캐시 키', async () => {
    const { adapter, calls, cache } = setup([
      { status: 200, body: rakutenSearchFixture('asics-1201a019-p1.json') },
      { status: 200, body: rakutenSearchFixture('asics-1201a019-p2.json') },
    ]);
    const p1 = await adapter.search({ keyword: 'asics', page: 1 });
    const p2 = await adapter.search({ keyword: 'asics', page: 2 });
    expect(p1.queryHash).not.toBe(p2.queryHash);
    expect(calls).toHaveLength(2);
    expect(cache.rows.size).toBe(2);
  });

  it('오류 응답은 저장하지 않는다(다음 요청은 다시 부른다)', async () => {
    const { adapter, cache, calls } = setup([
      { status: 400, body: rakutenSearchFixture('err-400-missing-key.json') },
    ]);
    await expect(adapter.search({ keyword: 'asics' })).rejects.toMatchObject({
      errorCode: 'RAKUTEN_KEY_MISSING',
    });
    expect(cache.rows.size).toBe(0);
    await adapter.search({ keyword: 'asics' });
    expect(calls).toHaveLength(2);
    expect(cache.rows.size).toBe(1);
  });

  it('200인데 읽을 수 없는 본문 → RAKUTEN_INVALID_RESPONSE, 저장 안 함', async () => {
    const { adapter, cache } = setup([{ status: 200, body: '<html>oops</html>' }]);
    await expect(adapter.search({ keyword: 'asics' })).rejects.toMatchObject({
      errorCode: 'RAKUTEN_INVALID_RESPONSE',
    });
    expect(cache.rows.size).toBe(0);
  });

  it('키가 없으면 409 SECRET_NOT_CONFIGURED(보내지 않음). 캐시 적중이면 키 없이도 된다', async () => {
    const { adapter, calls, secrets } = setup();
    await adapter.search({ keyword: 'asics' });
    secrets.reset();
    await expect(adapter.search({ keyword: 'asics' })).resolves.toMatchObject({ fromCache: true });
    await expect(adapter.search({ keyword: 'other' })).rejects.toMatchObject({
      code: 'SECRET_NOT_CONFIGURED',
      details: { secretKeys: ['RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY'] },
    });
    expect(calls).toHaveLength(1);
  });
});
