import { Logger } from '@nestjs/common';
import { createCommerceKit } from '../../../../test/support/commerce-test-kit.js';
import {
  commerceAuthFixture,
  FAKE_ACCESS_TOKEN,
} from '../../../../test/support/fake-commerce-transport.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import { clearKnownSecrets } from '../../../common/secrets/secret-mask.js';
import { buildCommerceUrl } from './commerce-api.client.js';

const SECOND_TOKEN = 'FAKE-ACCESS-TOKEN-second-for-autostore-tests';
const token200 = (accessToken: string) => ({
  ...commerceAuthFixture('token-200'),
  body: { access_token: accessToken, expires_in: 10800, token_type: 'Bearer' },
});

async function rejected(p: Promise<unknown>): Promise<ApiException> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ApiException);
  return e as ApiException;
}

describe('CommerceApiClient(가짜 transport)', () => {
  const originalWarn = Logger.prototype.warn;
  beforeAll(() => {
    Logger.prototype.warn = () => undefined;
  });
  afterAll(() => {
    Logger.prototype.warn = originalWarn;
    clearKnownSecrets();
  });

  it('Bearer 토큰을 붙여 보내고, 결과에 GNCP-GW-Trace-ID와 JSON을 담는다', async () => {
    const kit = createCommerceKit();
    const res = await kit.client.request<{ ok: boolean }>('GET', '/v1/categories', {
      query: { last: true, ids: [1, 2], skip: undefined },
    });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ ok: true });
    expect(res.traceId).toBe('fixture-trace-api-200');
    expect(res.retriedAfterReissue).toBe(false);
    const [tokenReq, apiReq] = kit.transport.requests;
    expect(tokenReq!.path).toBe('/external/v1/oauth2/token');
    expect(apiReq!.url).toBe(
      'https://api.commerce.naver.com/external/v1/categories?last=true&ids=1&ids=2',
    );
    expect(apiReq!.headers.authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`);
  });

  it('401 GW.AUTHN → 토큰 재발급 1회 + 원 요청 다시 보내기 1회', async () => {
    const kit = createCommerceKit();
    kit.transport.respondWith('token-200', 'api-401-authn', token200(SECOND_TOKEN), 'api-200-ok');
    const res = await kit.client.request('POST', '/v2/products', { json: { a: 1 } });
    expect(res.status).toBe(200);
    expect(res.retriedAfterReissue).toBe(true);
    expect(kit.transport.tokenRequests).toHaveLength(2);
    expect(kit.transport.apiRequests).toHaveLength(2);
    expect(kit.transport.apiRequests[1]!.headers.authorization).toBe(`Bearer ${SECOND_TOKEN}`);
    expect(kit.transport.apiRequests[1]!.body).toBe('{"a":1}');
    expect(kit.events.of('auth.failed')).toHaveLength(0);
  });

  it('다시 보낸 것도 401이면 멈추고 502 COMMERCE_AUTH_FAILED + auth.failed 1건, 토큰은 버린다', async () => {
    const kit = createCommerceKit();
    kit.transport.respondWith(
      'token-200',
      'api-401-authn',
      token200(SECOND_TOKEN),
      'api-401-authn',
    );
    const e = await rejected(kit.client.request('GET', '/v1/product-models'));
    expect(e.code).toBe('COMMERCE_AUTH_FAILED');
    expect(e.details).toMatchObject({
      errorCode: 'GW.AUTHN',
      httpStatus: 401,
      traceId: 'fixture-trace-api-401',
    });
    expect(kit.transport.tokenRequests).toHaveLength(2);
    expect(kit.transport.apiRequests).toHaveLength(2);
    expect(kit.events.of('auth.failed')).toEqual([
      expect.objectContaining({ target: 'COMMERCE_API', errorCode: 'GW.AUTHN' }),
    ]);
    expect(kit.tokens.status().tokenValid).toBe(false);
  });

  it('401 뒤 재발급이 거절되면 그 원인으로 502, auth.failed는 1건만', async () => {
    const kit = createCommerceKit();
    kit.transport.respondWith('token-200', 'api-401-authn', 'token-403-dormant');
    const e = await rejected(kit.client.request('GET', '/v1/product-models'));
    expect(e.code).toBe('COMMERCE_AUTH_FAILED');
    expect(e.details).toMatchObject({ causeCategory: 'DORMANT_AUTH' });
    expect(kit.transport.apiRequests).toHaveLength(1);
    expect(kit.events.of('auth.failed')).toHaveLength(1);
  });

  it('403 GW.IP_NOT_ALLOWED는 인증 실패(IP_NOT_ALLOWED)로 던진다', async () => {
    const kit = createCommerceKit();
    kit.transport.respondWith('token-200', 'token-403-ip-not-allowed');
    const e = await rejected(kit.client.request('GET', '/v1/categories'));
    expect(e.details).toMatchObject({ causeCategory: 'IP_NOT_ALLOWED' });
    expect(kit.events.of('auth.failed')).toHaveLength(1);
  });

  it('그 밖의 오류 응답은 던지지 않고 code·message·invalidInputs를 담아 돌려준다', async () => {
    const kit = createCommerceKit();
    kit.transport.respondWith('token-200', 'api-400-invalid-inputs');
    const res = await kit.client.request('POST', '/v2/products', { json: {} });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.data).toBeNull();
    expect(res.error).toEqual({
      code: 'BadRequest',
      message: '요청 값이 올바르지 않습니다.',
      traceId: 'fixture-trace-api-400',
      invalidInputs: [
        { name: 'originProduct.name', type: 'NotBlank', message: '상품명을 입력해 주세요.' },
      ],
    });
    expect(res.traceId).toBe('fixture-trace-api-400');
  });

  it('JSON·form 본문의 Content-Type, 한 번에 하나만', async () => {
    const kit = createCommerceKit();
    await kit.client.request('POST', '/v1/a', { json: { x: '가' } });
    await kit.client.request('POST', '/v1/b', { form: { a: 1, b: 'c d' } });
    const [a, b] = kit.transport.apiRequests;
    expect(a!.contentType).toBe('application/json; charset=utf-8');
    expect(b!.contentType).toBe('application/x-www-form-urlencoded');
    expect(b!.body).toBe('a=1&b=c+d');
    await expect(kit.client.request('POST', '/v1/c', { json: {}, form: { a: 1 } })).rejects.toThrow(
      '하나만',
    );
  });

  it('경로는 /로 시작해야 한다', () => {
    expect(() => buildCommerceUrl('v1/x')).toThrow();
    expect(buildCommerceUrl('/v1/x')).toBe('https://api.commerce.naver.com/external/v1/x');
  });
});
