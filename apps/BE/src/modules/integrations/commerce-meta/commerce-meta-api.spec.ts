import { createCommerceKit } from '../../../../test/support/commerce-test-kit.js';
import { commerceMetaFixture } from '../../../../test/support/fake-commerce-meta.js';
import {
  CommerceMetaApi,
  MetaFetchError,
  rateLimitPauseMs,
  retryAfterMs,
} from './commerce-meta-api.js';

describe('CommerceMetaApi(규칙 15: RateLimit 헤더·429 늦추기)', () => {
  it('Remaining이 0이면 1000/Replenish-Rate ms, 값이 없으면 쉬지 않는다', () => {
    expect(rateLimitPauseMs(new Headers())).toBe(0);
    expect(rateLimitPauseMs(new Headers({ 'GNCP-GW-RateLimit-Remaining': '3' }))).toBe(0);
    expect(
      rateLimitPauseMs(
        new Headers({
          'GNCP-GW-RateLimit-Remaining': '0',
          'GNCP-GW-RateLimit-Replenish-Rate': '4',
        }),
      ),
    ).toBe(250);
    expect(rateLimitPauseMs(new Headers({ 'GNCP-GW-RateLimit-Remaining': '0' }))).toBe(1000);
    expect(retryAfterMs(new Headers({ 'Retry-After': '3' }), 0)).toBe(3000);
    expect(retryAfterMs(new Headers(), 0)).toBe(1000);
    expect(retryAfterMs(new Headers(), 2)).toBe(4000);
  });

  it('남은 토큰이 0인 응답 뒤에는 다음 호출 전에 쉰다(호출은 하나씩)', async () => {
    const kit = createCommerceKit();
    const api = new CommerceMetaApi(kit.client, kit.clock);
    kit.transport.respondWith(
      'token-200',
      {
        status: 200,
        headers: { 'GNCP-GW-RateLimit-Remaining': '0', 'GNCP-GW-RateLimit-Replenish-Rate': '2' },
        body: { a: 1 },
      },
      { status: 200, headers: {}, body: { b: 2 } },
    );
    const t0 = kit.clock.now().getTime();
    expect(await api.get('/v1/x')).toEqual({ a: 1 });
    expect(kit.clock.now().getTime()).toBe(t0);
    expect(await api.get('/v1/y')).toEqual({ b: 2 });
    expect(kit.clock.now().getTime() - t0).toBe(500);
  });

  it('429 뒤 다시 보내 성공하면 그 응답, 2xx가 아니면 MetaFetchError(상태·코드), emptyStatuses면 null', async () => {
    const kit = createCommerceKit();
    const api = new CommerceMetaApi(kit.client, kit.clock);
    kit.transport.respondWith(
      'token-200',
      commerceMetaFixture('error-429-rate-limit'),
      { status: 200, headers: {}, body: [1] },
      commerceMetaFixture('error-500'),
      { status: 404, headers: {}, body: { code: 'NOT_FOUND' } },
    );
    expect(await api.get('/v1/a')).toEqual([1]);
    const error = await api.get('/v1/b').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetaFetchError);
    expect(error).toMatchObject({ httpStatus: 500, errorCode: 'GW.INTERNAL_SERVER_ERROR' });
    expect(await api.get('/v1/c', undefined, { emptyStatuses: [404] })).toBeNull();
  });
});
