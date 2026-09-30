import {
  clearKnownSecrets,
  isSecretHeaderName,
  KNOWN_SECRET_MAX,
  knownSecretCount,
  maskFormBody,
  maskSecret,
  redactSecretHeaders,
  redactSecrets,
  registerKnownSecret,
  SECRET_MASK,
  scrubKnownSecrets,
} from './secret-mask.js';

const SECRET = 'fake-secret-value-0001';
const TOKEN = 'FAKE-ACCESS-TOKEN-for-autostore-tests-only';

describe('secret-mask(규칙 5, F-BS-25)', () => {
  beforeEach(() => clearKnownSecrets());
  afterAll(() => clearKnownSecrets());

  it('maskSecret은 값 대신 ***', () => {
    expect(maskSecret('anything')).toBe(SECRET_MASK);
    expect(maskSecret('')).toBe('');
    expect(maskSecret(null)).toBe('');
  });

  it('알려진 비밀값을 문자열 어디에서든 지운다(겹치면 긴 값부터)', () => {
    registerKnownSecret(SECRET);
    registerKnownSecret(`${SECRET}-longer`);
    const out = scrubKnownSecrets(`a=${SECRET}-longer&b=${SECRET} ${SECRET}`);
    expect(out).toBe('a=***&b=*** ***');
    expect(out).not.toContain(SECRET);
  });

  it('짧은 값은 올리지 않는다(로그가 망가지지 않게)', () => {
    registerKnownSecret('abc');
    expect(knownSecretCount()).toBe(0);
    expect(scrubKnownSecrets('abcabc')).toBe('abcabc');
  });

  it('목록은 최대 개수를 넘으면 오래된 것부터 뺀다', () => {
    for (let i = 0; i < KNOWN_SECRET_MAX + 5; i++) registerKnownSecret(`secret-value-${i}-xxxx`);
    expect(knownSecretCount()).toBe(KNOWN_SECRET_MAX);
    expect(scrubKnownSecrets('secret-value-0-xxxx')).toBe('secret-value-0-xxxx');
    expect(scrubKnownSecrets(`secret-value-${KNOWN_SECRET_MAX + 4}-xxxx`)).toBe(SECRET_MASK);
  });

  it('Bearer 토큰 모양은 목록에 없어도 가린다', () => {
    expect(scrubKnownSecrets(`Authorization: Bearer ${TOKEN}`)).toBe('Authorization: Bearer ***');
  });

  it.each([
    'authorization',
    'Authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-secret',
    'X-Client-Secret',
    'x-access-token',
    'x-api-key',
  ])('헤더 %s는 비밀 헤더다', (name) => {
    expect(isSecretHeaderName(name)).toBe(true);
  });

  it('들어오는·나가는 헤더에서 비밀 헤더 값은 ***, 나머지는 그대로(알려진 비밀은 지움)', () => {
    registerKnownSecret(SECRET);
    const out = redactSecretHeaders({
      authorization: `Bearer ${TOKEN}`,
      'x-app-secret': SECRET,
      'content-type': 'application/json',
      'x-note': `leak ${SECRET}`,
    });
    expect(out).toEqual({
      authorization: SECRET_MASK,
      'x-app-secret': SECRET_MASK,
      'content-type': 'application/json',
      'x-note': 'leak ***',
    });
  });

  it('토큰 폼 본문의 client_id·client_secret_sign 값을 가린다(다른 필드는 그대로)', () => {
    const body =
      'client_id=fake-client-id-for-tests&timestamp=1790000000000&grant_type=client_credentials' +
      '&client_secret_sign=JDJhJDA0JEZha2U%3D&type=SELF';
    expect(maskFormBody(body)).toBe(
      'client_id=***&timestamp=1790000000000&grant_type=client_credentials' +
        '&client_secret_sign=***&type=SELF',
    );
  });

  it('redactSecrets: 객체의 비밀 이름 키·헤더·알려진 값·Error 메시지를 깊게 가리고 원본은 그대로 둔다', () => {
    registerKnownSecret(SECRET);
    const err = new Error(`keychain write failed: ${SECRET}`);
    const input = {
      secretKey: 'COMMERCE_CLIENT_SECRET',
      headers: { Authorization: `Bearer ${TOKEN}`, accept: 'application/json' },
      form: { client_secret_sign: 'abc', access_token: TOKEN, type: 'SELF' },
      nested: [{ note: `value=${SECRET}` }],
      err,
    };
    const out = redactSecrets(input);
    const text = JSON.stringify({
      ...out,
      err: { message: out.err.message, stack: out.err.stack },
    });
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(TOKEN);
    expect(out.secretKey).toBe('COMMERCE_CLIENT_SECRET');
    expect(out.headers).toEqual({ Authorization: SECRET_MASK, accept: 'application/json' });
    expect(out.form).toEqual({
      client_secret_sign: SECRET_MASK,
      access_token: SECRET_MASK,
      type: 'SELF',
    });
    expect(out.err).toBeInstanceOf(Error);
    expect(out.err.message).toBe('keychain write failed: ***');
    // 원본은 바꾸지 않는다
    expect(input.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(err.message).toContain(SECRET);
  });

  it('redactSecrets는 순환 참조에서 멈추지 않는다', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(() => redactSecrets(a)).not.toThrow();
  });
});
