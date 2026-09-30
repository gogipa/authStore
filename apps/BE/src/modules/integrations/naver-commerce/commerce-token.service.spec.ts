import { inspect } from 'node:util';
import { Logger } from '@nestjs/common';
import { createCommerceKit, KIT_START_MS } from '../../../../test/support/commerce-test-kit.js';
import {
  FAKE_ACCESS_TOKEN,
  signatureVector,
} from '../../../../test/support/fake-commerce-transport.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import { clearKnownSecrets, scrubKnownSecrets } from '../../../common/secrets/secret-mask.js';
import { COMMERCE_API_BASE_URL, COMMERCE_TOKEN_PATH } from './commerce-endpoints.js';
import { signClientSecret } from './commerce-signature.js';

const MIN = 60 * 1000;

async function rejected(p: Promise<unknown>): Promise<ApiException> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ApiException);
  return e as ApiException;
}

describe('CommerceTokenService(가짜 transport·시계)', () => {
  const originalWarn = Logger.prototype.warn;
  beforeAll(() => {
    Logger.prototype.warn = () => undefined;
  });
  afterAll(() => {
    Logger.prototype.warn = originalWarn;
    clearKnownSecrets();
  });

  describe('토큰 요청 규격(규칙 6 — 어기면 시간당 1회 제재, 느슨하게 하지 않는다)', () => {
    it('POST {base}/v1/oauth2/token, form 본문, 필드 정확히 5개, type=SELF, grant_type, account_id 없음', async () => {
      const kit = createCommerceKit();
      await kit.tokens.getToken();
      expect(kit.transport.requests).toHaveLength(1);
      const req = kit.transport.requests[0]!;
      expect(req.method).toBe('POST');
      expect(req.url).toBe(`${COMMERCE_API_BASE_URL}${COMMERCE_TOKEN_PATH}`);
      expect(req.url).toBe('https://api.commerce.naver.com/external/v1/oauth2/token');
      expect(req.contentType).toBe('application/x-www-form-urlencoded');
      expect(req.headers.authorization).toBeUndefined();
      expect(() => JSON.parse(req.body!) as unknown).toThrow();
      const form = new URLSearchParams(req.body!);
      expect(new Set(form.keys())).toEqual(
        new Set(['client_id', 'timestamp', 'grant_type', 'client_secret_sign', 'type']),
      );
      expect([...form.keys()]).toHaveLength(5);
      expect(form.get('type')).toBe('SELF');
      expect(form.get('grant_type')).toBe('client_credentials');
      expect(form.has('account_id')).toBe(false);
      expect(form.get('timestamp')).toMatch(/^\d{13}$/);
    });

    it('서명은 요청 순간의 timestamp로 만들고, 다음 발급은 새 timestamp를 쓴다(재사용 안 함)', async () => {
      const kit = createCommerceKit();
      const v = signatureVector();
      await kit.tokens.forceRefresh();
      kit.clock.advance(1234);
      await kit.tokens.forceRefresh();
      const [a, b] = kit.transport.tokenRequests.map((r) => new URLSearchParams(r.body!));
      expect(a!.get('timestamp')).toBe(String(KIT_START_MS));
      expect(b!.get('timestamp')).toBe(String(KIT_START_MS + 1234));
      expect(a!.get('client_id')).toBe(v.clientId);
      expect(a!.get('client_secret_sign')).toBe(
        signClientSecret(v.clientId, v.clientSecret, KIT_START_MS),
      );
      expect(b!.get('client_secret_sign')).not.toBe(a!.get('client_secret_sign'));
    });
  });

  describe('캐시·30분 규칙(규칙 8)', () => {
    it('14:00 발급 → 16:29는 추가 발급 0회, 16:30은 1회. 만료는 17:00', async () => {
      const kit = createCommerceKit();
      await kit.tokens.getToken();
      expect(kit.tokens.status().expiresAt?.toISOString()).toBe('2026-09-28T08:00:00.000Z');
      expect(kit.tokens.status().issuedAt?.toISOString()).toBe('2026-09-28T05:00:00.000Z');
      kit.clock.advance(149 * MIN); // 16:29
      await kit.tokens.getToken();
      expect(kit.transport.tokenRequests).toHaveLength(1);
      kit.clock.advance(1 * MIN); // 16:30
      await kit.tokens.getToken();
      expect(kit.transport.tokenRequests).toHaveLength(2);
      expect(kit.tokens.status().expiresAt?.toISOString()).toBe('2026-09-28T10:30:00.000Z');
    });

    it('getToken() 동시 3번 → 발급 1번, 모두 같은 토큰', async () => {
      const kit = createCommerceKit();
      kit.transport.block();
      const all = Promise.all([
        kit.tokens.getToken(),
        kit.tokens.getToken(),
        kit.tokens.getToken(),
      ]);
      await new Promise((r) => setImmediate(r));
      kit.transport.release();
      const [a, b, c] = await all;
      expect(kit.transport.tokenRequests).toHaveLength(1);
      expect(a).toBe(b);
      expect(b).toBe(c);
    });

    it('invalidate() 뒤 tokenValid=false, 다음 getToken은 새로 받는다', async () => {
      const kit = createCommerceKit();
      await kit.tokens.getToken();
      expect(kit.tokens.status().tokenValid).toBe(true);
      kit.tokens.invalidate();
      expect(kit.tokens.status()).toEqual({
        tokenValid: false,
        issuedAt: null,
        expiresAt: null,
        refreshAt: null,
      });
      await kit.tokens.getToken();
      expect(kit.transport.tokenRequests).toHaveLength(2);
    });

    it('발급 중에 invalidate()하면 그 결과는 캐시에 넣지 않는다(바뀐 키로 다시 받게)', async () => {
      const kit = createCommerceKit();
      kit.transport.block();
      const p = kit.tokens.getToken();
      await new Promise((r) => setImmediate(r));
      kit.tokens.invalidate();
      kit.transport.release();
      await p;
      expect(kit.tokens.status().tokenValid).toBe(false);
    });

    it('만료가 지나면 tokenValid=false', async () => {
      const kit = createCommerceKit();
      await kit.tokens.getToken();
      kit.clock.advance(180 * MIN);
      expect(kit.tokens.status().tokenValid).toBe(false);
    });

    it('미리 받기(16:30~)가 실패해도 만료 전이면 기존 토큰을 쓴다', async () => {
      const kit = createCommerceKit();
      const first = await kit.tokens.getToken();
      kit.clock.advance(155 * MIN); // 16:35
      kit.transport.respondWith('token-503-unavailable');
      await expect(kit.tokens.getToken()).resolves.toBe(first);
      kit.clock.advance(30 * MIN); // 17:05 만료 뒤
      kit.transport.respondWith('token-503-unavailable');
      await expect(kit.tokens.getToken()).rejects.toBeInstanceOf(ApiException);
    });

    it('토큰 값은 toString·JSON·inspect 어디에도 나오지 않는다', async () => {
      const kit = createCommerceKit();
      const token = await kit.tokens.getToken();
      expect(String(token)).not.toContain(FAKE_ACCESS_TOKEN);
      expect(JSON.stringify(token)).not.toContain(FAKE_ACCESS_TOKEN);
      expect(inspect(token)).not.toContain(FAKE_ACCESS_TOKEN);
      expect(JSON.stringify(kit.tokens.status())).not.toContain(FAKE_ACCESS_TOKEN);
      expect(token.authorizationHeader()).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`);
      // 받은 토큰은 알려진 비밀로 올라가 로그에서 지워진다
      expect(scrubKnownSecrets(`t=${FAKE_ACCESS_TOKEN}`)).toBe('t=***');
    });
  });

  describe('실패(규칙 10·12)', () => {
    it('커머스 키가 없으면 409 SECRET_NOT_CONFIGURED(키 이름), 호출·알림 없음', async () => {
      const kit = createCommerceKit({ secrets: { COMMERCE_CLIENT_ID: 'fake-client-id-only' } });
      const e = await rejected(kit.tokens.forceRefresh());
      expect(e.code).toBe('SECRET_NOT_CONFIGURED');
      expect(e.getStatus()).toBe(409);
      expect(e.message).toBe(
        '커머스API client_secret 키가 아직 없습니다. 시스템 상태 화면에서 넣어 주세요.',
      );
      expect(e.details).toEqual({ secretKeys: ['COMMERCE_CLIENT_SECRET'] });
      expect(kit.transport.requests).toHaveLength(0);
      expect(kit.events.of('auth.failed')).toHaveLength(0);
    });

    it('키체인을 못 열면 503 KEYCHAIN_UNAVAILABLE', async () => {
      const kit = createCommerceKit();
      kit.store.unavailable = true;
      const e = await rejected(kit.tokens.getToken());
      expect(e.code).toBe('KEYCHAIN_UNAVAILABLE');
      expect(kit.transport.requests).toHaveLength(0);
    });

    it('403 GW.IP_NOT_ALLOWED → 502 COMMERCE_AUTH_FAILED(IP_NOT_ALLOWED) + auth.failed 1건', async () => {
      const kit = createCommerceKit();
      kit.transport.respondWith('token-403-ip-not-allowed');
      const e = await rejected(kit.tokens.forceRefresh());
      expect(e.code).toBe('COMMERCE_AUTH_FAILED');
      expect(e.getStatus()).toBe(502);
      expect(e.details).toEqual({
        target: 'COMMERCE_API',
        causeCategory: 'IP_NOT_ALLOWED',
        errorCode: 'GW.IP_NOT_ALLOWED',
        httpStatus: 403,
        traceId: 'fixture-trace-403-ip',
      });
      expect(kit.events.of('auth.failed')).toEqual([
        {
          target: 'COMMERCE_API',
          errorCode: 'GW.IP_NOT_ALLOWED',
          causeCategory: 'IP_NOT_ALLOWED',
          occurredAt: '2026-09-28T05:00:00.000Z',
        },
      ]);
      expect(kit.tokens.status().tokenValid).toBe(false);
    });

    it('5xx → 502 EXTERNAL_API_ERROR(reason SERVER_ERROR, traceId) + auth.failed', async () => {
      const kit = createCommerceKit();
      kit.transport.respondWith('token-503-unavailable');
      const e = await rejected(kit.tokens.forceRefresh());
      expect(e.code).toBe('EXTERNAL_API_ERROR');
      expect(e.details).toMatchObject({
        target: 'COMMERCE_API',
        reason: 'SERVER_ERROR',
        httpStatus: 503,
        traceId: 'fixture-trace-503',
      });
      expect(e.message).toBe(
        '네이버 커머스API 응답을 받지 못했습니다(서버 오류, HTTP 503). 잠시 뒤 다시 해 주세요.',
      );
      expect(kit.events.of('auth.failed')).toHaveLength(1);
    });

    it('연결 오류 → 502 EXTERNAL_API_ERROR(details.target·reason·traceId) + auth.failed', async () => {
      const kit = createCommerceKit();
      kit.transport.failNext();
      const e = await rejected(kit.tokens.forceRefresh());
      expect(e.code).toBe('EXTERNAL_API_ERROR');
      expect(e.details).toEqual({
        target: 'COMMERCE_API',
        reason: 'NETWORK_ERROR',
        httpStatus: null,
        traceId: null,
      });
      expect(kit.events.of('auth.failed')).toEqual([
        expect.objectContaining({ errorCode: 'NETWORK_ERROR', causeCategory: 'UNKNOWN' }),
      ]);
    });

    it('client_secret이 salt 모양이 아니면 보내지 않고 COMMERCE_AUTH_FAILED(SECRET_CHANGED)', async () => {
      const kit = createCommerceKit({
        secrets: {
          COMMERCE_CLIENT_ID: 'fake-client-id',
          COMMERCE_CLIENT_SECRET: 'not-a-bcrypt-salt',
        },
      });
      const e = await rejected(kit.tokens.forceRefresh());
      expect(e.code).toBe('COMMERCE_AUTH_FAILED');
      expect(e.details).toMatchObject({
        causeCategory: 'SECRET_CHANGED',
        errorCode: 'CLIENT_SECRET_FORMAT_INVALID',
      });
      expect(kit.transport.requests).toHaveLength(0);
      expect(JSON.stringify(e.details)).not.toContain('not-a-bcrypt-salt');
    });

    it('오류 message·details에 비밀값(client_id·secret·서명)이 없다', async () => {
      const kit = createCommerceKit();
      const v = signatureVector();
      kit.transport.respondWith('token-400-invalid-client');
      const e = await rejected(kit.tokens.forceRefresh());
      const text = JSON.stringify({ message: e.message, details: e.details });
      expect(text).not.toContain(v.clientId);
      expect(text).not.toContain(v.clientSecret);
      const sign = new URLSearchParams(kit.transport.tokenRequests[0]!.body!).get(
        'client_secret_sign',
      )!;
      expect(text).not.toContain(sign);
    });
  });
});
