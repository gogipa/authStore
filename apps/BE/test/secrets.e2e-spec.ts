import { Writable } from 'node:stream';
import request from 'supertest';
import { LOG_DESTINATION } from '../src/common/logging/logging.module.js';
import { SECRET_KEYS } from '../src/common/secrets/secret-keys.js';
import { clearKnownSecrets } from '../src/common/secrets/secret-mask.js';
import { SECRET_STORE } from '../src/common/secrets/secret-store.port.js';
import { CommerceTokenService } from '../src/modules/integrations/naver-commerce/commerce-token.service.js';
import { createTestApp, type TestApp, truncate } from './helpers/test-app.js';
import {
  FAKE_ACCESS_TOKEN,
  FakeCommerceTransport,
  signatureVector,
} from './support/fake-commerce-transport.js';
import { InMemorySecretStore } from './support/in-memory-secret-store.js';

const CLIENT = { 'X-AutoStore-Client': '1' };

/** 키마다 누가 봐도 가짜인 서로 다른 값 */
const VALUES: Record<(typeof SECRET_KEYS)[number], string> = {
  COMMERCE_CLIENT_ID: signatureVector().clientId,
  COMMERCE_CLIENT_SECRET: signatureVector().clientSecret,
  RAKUTEN_APPLICATION_ID: 'fake-rakuten-application-id-0001',
  RAKUTEN_ACCESS_KEY: 'fake-rakuten-access-key-0001',
  KOREAEXIM_API_KEY: 'fake-koreaexim-api-key-0001',
  CUSTOMS_SERVICE_KEY: 'fake-customs-service-key-0001',
};

describe('비밀정보 키 입력 GET·PUT /secrets (e2e, 메모리 저장소)', () => {
  let t: TestApp;
  const store = new InMemorySecretStore();
  const logLines: string[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      logLines.push(chunk.toString('utf8'));
      cb();
    },
  });
  const commerce = new FakeCommerceTransport();

  beforeAll(async () => {
    t = await createTestApp({
      overrides: [
        { provide: SECRET_STORE, useValue: store },
        { provide: LOG_DESTINATION, useValue: { stream: logStream, level: 'debug' } },
      ],
    });
    t.fetch.handler = commerce.fetchHandler;
  });

  beforeEach(async () => {
    await truncate(t.prisma, ['call_log', 'user_action_log']);
    store.reset();
    commerce.reset();
    t.app.get(CommerceTokenService).invalidate();
  });

  afterAll(async () => {
    await t.app.close();
    clearKnownSecrets();
  });

  const http = () => request(t.app.getHttpServer());
  const put = (key: string, body: unknown) =>
    http()
      .put(`/api/v1/secrets/${key}`)
      .set(CLIENT)
      .send(body as object);

  it('빈 저장소: 200, 허용 키 6개(05-2 순서), 모두 configured=false·updatedAt=null', async () => {
    const res = await http().get('/api/v1/secrets').expect(200);
    expect(res.body).toEqual({
      items: SECRET_KEYS.map((secretKey) => ({ secretKey, configured: false, updatedAt: null })),
    });
  });

  it('PUT → 204 본문 없음. 다시 GET하면 그 키만 configured=true(수정 시각), 값은 어디에도 없다', async () => {
    const res = await put('COMMERCE_CLIENT_ID', { value: VALUES.COMMERCE_CLIENT_ID }).expect(204);
    expect(res.text).toBe('');
    expect(store.peek('COMMERCE_CLIENT_ID')).toBe(VALUES.COMMERCE_CLIENT_ID);
    const list = await http().get('/api/v1/secrets').expect(200);
    const items = (
      list.body as { items: { secretKey: string; configured: boolean; updatedAt: string | null }[] }
    ).items;
    expect(items.filter((i) => i.configured).map((i) => i.secretKey)).toEqual([
      'COMMERCE_CLIENT_ID',
    ]);
    expect(items[0]!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(list.text).not.toContain(VALUES.COMMERCE_CLIENT_ID);
  });

  it('같은 값 덮어쓰기는 멱등(204 두 번, 상태 같음)', async () => {
    await put('RAKUTEN_ACCESS_KEY', { value: VALUES.RAKUTEN_ACCESS_KEY }).expect(204);
    await put('RAKUTEN_ACCESS_KEY', { value: VALUES.RAKUTEN_ACCESS_KEY }).expect(204);
    expect(store.peek('RAKUTEN_ACCESS_KEY')).toBe(VALUES.RAKUTEN_ACCESS_KEY);
    const list = await http().get('/api/v1/secrets').expect(200);
    expect(
      (list.body as { items: { configured: boolean }[] }).items.filter((i) => i.configured),
    ).toHaveLength(1);
  });

  it('허용 목록 밖 키 → 404 SECRET_KEY_UNKNOWN(저장하지 않음)', async () => {
    const res = await put('FOO_KEY', { value: 'fake-foo-value-0001' }).expect(404);
    expect(res.body).toMatchObject({
      code: 'SECRET_KEY_UNKNOWN',
      message: '알 수 없는 키 이름입니다.',
    });
    expect(store.writeCount).toBe(0);
  });

  it.each([
    ['빈 값', { value: '' }],
    ['4097자', { value: 'x'.repeat(4097) }],
    ['정의 밖 필드', { value: 'fake-value-with-extra-0001', extra: 'fake-extra-0001' }],
    ['글자가 아님', { value: 12345678 }],
  ])('%s → 422 VALIDATION_FAILED, rejectedValue 없음, 저장 안 함', async (_name, body) => {
    const res = await put('KOREAEXIM_API_KEY', body).expect(422);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    const fieldErrors = (res.body as { fieldErrors: object[] }).fieldErrors;
    expect(fieldErrors.length).toBeGreaterThan(0);
    for (const fe of fieldErrors) expect(fe).not.toHaveProperty('rejectedValue');
    expect(res.text).not.toContain('xxxxxxxxxx');
    expect(res.text).not.toContain('fake-value-with-extra-0001');
    expect(res.text).not.toContain('fake-extra-0001');
    expect(store.writeCount).toBe(0);
  });

  it('4096자는 받는다', async () => {
    await put('CUSTOMS_SERVICE_KEY', { value: 'y'.repeat(4096) }).expect(204);
  });

  it('X-AutoStore-Client 없음 → 403 CLIENT_HEADER_REQUIRED', async () => {
    const res = await http()
      .put('/api/v1/secrets/COMMERCE_CLIENT_ID')
      .send({ value: VALUES.COMMERCE_CLIENT_ID })
      .expect(403);
    expect(res.body).toMatchObject({ code: 'CLIENT_HEADER_REQUIRED' });
    expect(store.writeCount).toBe(0);
  });

  it('키체인을 못 열면 GET·PUT 모두 503 KEYCHAIN_UNAVAILABLE', async () => {
    store.unavailable = true;
    const get = await http().get('/api/v1/secrets').expect(503);
    expect(get.body).toMatchObject({
      code: 'KEYCHAIN_UNAVAILABLE',
      message: 'macOS 키체인을 열 수 없습니다. 키체인 접근을 허용한 뒤 다시 해 주세요.',
    });
    const res = await put('COMMERCE_CLIENT_ID', { value: VALUES.COMMERCE_CLIENT_ID }).expect(503);
    expect(res.body).toMatchObject({ code: 'KEYCHAIN_UNAVAILABLE' });
    expect(res.text).not.toContain(VALUES.COMMERCE_CLIENT_ID);
  });

  it('감사 기록은 키 이름만(SETTING_CHANGED, detail.secretKey)', async () => {
    await put('RAKUTEN_APPLICATION_ID', { value: VALUES.RAKUTEN_APPLICATION_ID }).expect(204);
    const rows = await t.prisma.userActionLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: 'SETTING_CHANGED',
      detail: { secretKey: 'RAKUTEN_APPLICATION_ID' },
    });
  });

  it('누출 검사: 키 6개 입력·토큰 발급·비밀 헤더 요청 뒤 pino 출력·call_log·user_action_log 어디에도 값·토큰이 없다', async () => {
    logLines.length = 0;
    for (const key of SECRET_KEYS) await put(key, { value: VALUES[key] }).expect(204);
    // 토큰 발급(가짜 커머스 서버 → 실제 관문 → call_log)
    await http().post('/api/v1/auth-checks').set(CLIENT).expect(200);
    expect(commerce.tokenRequests).toHaveLength(1);
    const sign = new URLSearchParams(commerce.tokenRequests[0]!.body!).get('client_secret_sign')!;
    // 들어오는 요청의 비밀 헤더(authorization·x-*-secret)
    await http()
      .get('/api/v1/secrets')
      .set('Authorization', `Bearer ${FAKE_ACCESS_TOKEN}`)
      .set('X-Api-Secret', VALUES.RAKUTEN_ACCESS_KEY)
      .expect(200);
    // 실패 경로(키체인 오류)도 한 번
    store.unavailable = true;
    await put('COMMERCE_CLIENT_SECRET', { value: VALUES.COMMERCE_CLIENT_SECRET }).expect(503);
    store.unavailable = false;

    const [callLogs, actions] = await Promise.all([
      t.prisma.callLog.findMany(),
      t.prisma.userActionLog.findMany(),
    ]);
    expect(callLogs).toHaveLength(1);
    expect(actions).toHaveLength(6);
    const logs = logLines.join('');
    // 로그가 실제로 모였는지(요청 로그·헤더 가림 흔적)
    expect(logs).toContain('/api/v1/secrets');
    expect(logs).toContain('"authorization":"***"');
    const haystack = [logs, JSON.stringify(callLogs), JSON.stringify(actions)].join('\n');
    for (const value of [...Object.values(VALUES), FAKE_ACCESS_TOKEN, sign]) {
      expect(haystack).not.toContain(value);
    }
  });
});
