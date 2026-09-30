import request from 'supertest';
import type { PublishedProgressEvent } from '../src/common/events/progress-events.service.js';
import { ProgressEventsService } from '../src/common/events/progress-events.service.js';
import { clearKnownSecrets } from '../src/common/secrets/secret-mask.js';
import { SECRET_STORE } from '../src/common/secrets/secret-store.port.js';
import { APP_USER_AGENT } from '../src/modules/integrations/http/external-http.gateway.js';
import { CommerceTokenService } from '../src/modules/integrations/naver-commerce/commerce-token.service.js';
import { createTestApp, type TestApp, truncate } from './helpers/test-app.js';
import {
  FAKE_ACCESS_TOKEN,
  FakeCommerceTransport,
  signatureVector,
} from './support/fake-commerce-transport.js';
import { InMemorySecretStore } from './support/in-memory-secret-store.js';

const CLIENT = { 'X-AutoStore-Client': '1' };
const HOUR = 60 * 60 * 1000;

interface AuthStatusBody {
  secretsConfigured: boolean;
  tokenValid: boolean;
  tokenExpiresAt: string | null;
  lastCheckedAt: string | null;
  lastSucceeded: boolean | null;
  lastHttpStatus: number | null;
  lastErrorCode: string | null;
  causeCategory: string | null;
  lastTraceId: string | null;
}

describe('커머스API 인증 GET /auth-status · POST /auth-checks (e2e, 가짜 커머스 서버)', () => {
  let t: TestApp;
  let events: ProgressEventsService;
  const store = new InMemorySecretStore();
  const commerce = new FakeCommerceTransport();
  const v = signatureVector();

  beforeAll(async () => {
    t = await createTestApp({ overrides: [{ provide: SECRET_STORE, useValue: store }] });
    // 가짜 커머스 서버를 가짜 fetch(HTTP_FETCH) 뒤에 둔다 → 실제 관문(허용 목록·UA·call_log)을 지난다
    t.fetch.handler = commerce.fetchHandler;
    events = t.app.get(ProgressEventsService);
  });

  beforeEach(async () => {
    await truncate(t.prisma, ['call_log', 'user_action_log']);
    store.reset();
    commerce.reset();
    t.fetch.reset();
    t.fetch.handler = commerce.fetchHandler;
    t.app.get(CommerceTokenService).invalidate();
  });

  afterAll(async () => {
    await t.app.close();
    clearKnownSecrets();
  });

  const http = () => request(t.app.getHttpServer());
  const putKeys = async () => {
    await http()
      .put('/api/v1/secrets/COMMERCE_CLIENT_ID')
      .set(CLIENT)
      .send({ value: v.clientId })
      .expect(204);
    await http()
      .put('/api/v1/secrets/COMMERCE_CLIENT_SECRET')
      .set(CLIENT)
      .send({ value: v.clientSecret })
      .expect(204);
  };
  const authCheck = () => http().post('/api/v1/auth-checks').set(CLIENT);
  const authStatus = async () =>
    (await http().get('/api/v1/auth-status').expect(200)).body as AuthStatusBody;
  const captureEvents = () => {
    const got: PublishedProgressEvent[] = [];
    const sub = events.stream().subscribe((e) => got.push(e));
    return { got, stop: () => sub.unsubscribe() };
  };

  it('기록이 없으면 모두 null, 키가 없으면 secretsConfigured=false', async () => {
    expect(await authStatus()).toEqual({
      secretsConfigured: false,
      tokenValid: false,
      tokenExpiresAt: null,
      lastCheckedAt: null,
      lastSucceeded: null,
      lastHttpStatus: null,
      lastErrorCode: null,
      causeCategory: null,
      lastTraceId: null,
    });
  });

  it('키 없음 → 409 SECRET_NOT_CONFIGURED(키 이름), 커머스 호출 없음', async () => {
    const res = await authCheck().expect(409);
    expect(res.body).toMatchObject({
      code: 'SECRET_NOT_CONFIGURED',
      message:
        '커머스API client_id·client_secret 키가 아직 없습니다. 시스템 상태 화면에서 넣어 주세요.',
      details: { secretKeys: ['COMMERCE_CLIENT_ID', 'COMMERCE_CLIENT_SECRET'] },
    });
    expect(commerce.requests).toHaveLength(0);
    expect(await t.prisma.callLog.count()).toBe(0);
  });

  it('키 넣고 token-200 → 200, tokenValid=true, 만료 = 호출 + 3시간, 토큰 값 없음, call_log 1행', async () => {
    await putKeys();
    const calledAt = t.clock.now().getTime();
    const res = await authCheck().expect(200);
    const body = res.body as AuthStatusBody;
    expect(body).toMatchObject({
      secretsConfigured: true,
      tokenValid: true,
      tokenExpiresAt: new Date(calledAt + 3 * HOUR).toISOString(),
      lastCheckedAt: new Date(calledAt).toISOString(),
      lastSucceeded: true,
      lastHttpStatus: 200,
      lastErrorCode: null,
      causeCategory: null,
      lastTraceId: 'fixture-trace-token-200',
    });
    expect(res.text).not.toContain(FAKE_ACCESS_TOKEN);
    const rows = await t.prisma.callLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      target: 'COMMERCE_API',
      httpMethod: 'POST',
      host: 'api.commerce.naver.com',
      urlMasked: 'https://api.commerce.naver.com/external/v1/oauth2/token',
      httpStatus: 200,
      succeeded: true,
      errorCode: null,
      traceId: 'fixture-trace-token-200',
    });
    // 관문을 지난 실제 요청: form 본문·앱 UA
    const sent = commerce.tokenRequests[0]!;
    expect(sent.contentType).toBe('application/x-www-form-urlencoded');
    expect(sent.headers['user-agent']).toBe(APP_USER_AGENT);
    const form = new URLSearchParams(sent.body!);
    expect([...form.keys()]).toEqual([
      'client_id',
      'timestamp',
      'grant_type',
      'client_secret_sign',
      'type',
    ]);
    expect(form.get('timestamp')).toBe(String(calledAt));
  });

  it('캐시와 상관없이 매번 발급한다(POST /auth-checks 2번 → 발급 2번)', async () => {
    await putKeys();
    await authCheck().expect(200);
    t.clock.advance(1000);
    await authCheck().expect(200);
    expect(commerce.tokenRequests).toHaveLength(2);
    expect(await t.prisma.callLog.count()).toBe(2);
  });

  it('403 GW.IP_NOT_ALLOWED → 502 COMMERCE_AUTH_FAILED(IP_NOT_ALLOWED) + SSE auth.failed 1건, 상태에 원인·추적 번호', async () => {
    await putKeys();
    commerce.respondWith('token-403-ip-not-allowed');
    const sse = captureEvents();
    const res = await authCheck().expect(502);
    sse.stop();
    expect(res.body).toMatchObject({
      code: 'COMMERCE_AUTH_FAILED',
      message:
        '네이버 커머스API 인증에 실패했습니다(호출 IP 불일치). 시스템 상태 화면의 안내를 따라 주세요.',
      details: { causeCategory: 'IP_NOT_ALLOWED', errorCode: 'GW.IP_NOT_ALLOWED' },
    });
    const failed = sse.got.filter((e) => e.name === 'auth.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.data).toEqual({
      target: 'COMMERCE_API',
      errorCode: 'GW.IP_NOT_ALLOWED',
      causeCategory: 'IP_NOT_ALLOWED',
      occurredAt: t.clock.now().toISOString(),
    });
    expect(await authStatus()).toMatchObject({
      secretsConfigured: true,
      tokenValid: false,
      lastSucceeded: false,
      lastHttpStatus: 403,
      lastErrorCode: 'GW.IP_NOT_ALLOWED',
      causeCategory: 'IP_NOT_ALLOWED',
      lastTraceId: 'fixture-trace-403-ip',
    });
    const [row] = await t.prisma.callLog.findMany();
    expect(row).toMatchObject({
      httpStatus: 403,
      succeeded: false,
      errorCode: 'GW.IP_NOT_ALLOWED',
    });
  });

  it.each([
    ['token-403-dormant', 'DORMANT_AUTH'],
    ['token-403-store-suspended', 'STORE_SUSPENDED'],
    ['token-400-invalid-client', 'SECRET_CHANGED'],
    ['token-400-bad-timestamp', 'UNKNOWN'],
  ] as const)('%s → causeCategory %s', async (fixture, category) => {
    await putKeys();
    commerce.respondWith(fixture);
    const res = await authCheck().expect(502);
    expect(res.body).toMatchObject({
      code: 'COMMERCE_AUTH_FAILED',
      details: { causeCategory: category },
    });
    expect((await authStatus()).causeCategory).toBe(category);
  });

  it('연결 오류 → 502 EXTERNAL_API_ERROR(details.target·reason), call_log에 NETWORK_ERROR', async () => {
    await putKeys();
    commerce.failNext();
    const res = await authCheck().expect(502);
    expect(res.body).toMatchObject({
      code: 'EXTERNAL_API_ERROR',
      details: { target: 'COMMERCE_API', reason: 'NETWORK_ERROR', traceId: null },
    });
    expect(await authStatus()).toMatchObject({
      lastSucceeded: false,
      lastErrorCode: 'NETWORK_ERROR',
      causeCategory: 'UNKNOWN',
    });
  });

  it('5xx → 502 EXTERNAL_API_ERROR(reason SERVER_ERROR, traceId)', async () => {
    await putKeys();
    commerce.respondWith('token-503-unavailable');
    const res = await authCheck().expect(502);
    expect(res.body).toMatchObject({
      code: 'EXTERNAL_API_ERROR',
      details: { target: 'COMMERCE_API', reason: 'SERVER_ERROR', traceId: 'fixture-trace-503' },
    });
  });

  it('토큰을 받은 뒤 PUT COMMERCE_CLIENT_SECRET → tokenValid=false', async () => {
    await putKeys();
    await authCheck().expect(200);
    expect((await authStatus()).tokenValid).toBe(true);
    await http()
      .put('/api/v1/secrets/COMMERCE_CLIENT_SECRET')
      .set(CLIENT)
      .send({ value: v.clientSecret })
      .expect(204);
    expect((await authStatus()).tokenValid).toBe(false);
  });

  it('커머스가 아닌 키를 바꾸면 토큰은 그대로', async () => {
    await putKeys();
    await authCheck().expect(200);
    await http()
      .put('/api/v1/secrets/RAKUTEN_ACCESS_KEY')
      .set(CLIENT)
      .send({ value: 'fake-rakuten-access-key-0002' })
      .expect(204);
    expect((await authStatus()).tokenValid).toBe(true);
  });

  it('키체인을 못 열면 POST /auth-checks는 503, GET /auth-status는 secretsConfigured=false로 200', async () => {
    await putKeys();
    store.unavailable = true;
    const res = await authCheck().expect(503);
    expect(res.body).toMatchObject({ code: 'KEYCHAIN_UNAVAILABLE' });
    expect((await authStatus()).secretsConfigured).toBe(false);
  });

  it('X-AutoStore-Client 없음 → 403', async () => {
    await http().post('/api/v1/auth-checks').expect(403);
  });
});
