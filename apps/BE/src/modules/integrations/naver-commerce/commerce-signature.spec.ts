import bcrypt from 'bcryptjs';
import { signatureVector } from '../../../../test/support/fake-commerce-transport.js';
import {
  buildTokenRequestForm,
  COMMERCE_TOKEN_FORM_FIELDS,
  isBcryptSalt,
  signClientSecret,
} from './commerce-signature.js';

describe('커머스API 서명(규칙 7, F-BS-46)', () => {
  const v = signatureVector();

  it('고정 벡터(다른 구현 Python bcrypt로 계산)와 같다', () => {
    expect(v.source).toMatch(/Python/);
    expect(signClientSecret(v.clientId, v.clientSecret, v.timestamp)).toBe(v.expectedSign);
  });

  it('결과는 Base64이고, 풀면 salt와 같은 접두어로 시작하는 60자 bcrypt 해시다', () => {
    const sign = signClientSecret(v.clientId, v.clientSecret, v.timestamp);
    expect(sign).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const decoded = Buffer.from(sign, 'base64').toString('utf8');
    expect(decoded).toHaveLength(60);
    expect(decoded.startsWith('$2a$')).toBe(true);
    // client_secret 자체가 salt다: 해시 앞 29자가 salt 그대로
    expect(decoded.slice(0, 29)).toBe(v.clientSecret);
  });

  it('비밀번호는 client_id + "_" + timestamp다(순서·구분자가 다르면 서명이 다르다)', () => {
    const sign = signClientSecret(v.clientId, v.clientSecret, v.timestamp);
    const other = Buffer.from(
      bcrypt.hashSync(`${v.timestamp}_${v.clientId}`, v.clientSecret),
    ).toString('base64');
    expect(other).not.toBe(sign);
    expect(signClientSecret(v.clientId, v.clientSecret, v.timestamp + 1)).not.toBe(sign);
  });

  it('rounds 숫자로 새 salt를 만들면 서명이 틀린다(client_secret을 salt로 써야 한다)', () => {
    const wrong = Buffer.from(bcrypt.hashSync(`${v.clientId}_${v.timestamp}`, 4)).toString(
      'base64',
    );
    expect(wrong).not.toBe(v.expectedSign);
  });

  it('client_secret이 bcrypt salt 모양인지 본다', () => {
    expect(isBcryptSalt(v.clientSecret)).toBe(true);
    expect(isBcryptSalt('not-a-salt')).toBe(false);
    expect(isBcryptSalt('$2a$04$short')).toBe(false);
  });

  it('토큰 폼은 정확히 다섯 필드(이 순서), type=SELF, grant_type=client_credentials, account_id 없음', () => {
    const form = new URLSearchParams(
      buildTokenRequestForm({ clientId: 'id', timestampMs: v.timestamp, clientSecretSign: 'c2ln' }),
    );
    expect([...form.keys()]).toEqual([...COMMERCE_TOKEN_FORM_FIELDS]);
    expect(form.get('type')).toBe('SELF');
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('timestamp')).toMatch(/^\d{13}$/);
    expect(form.has('account_id')).toBe(false);
  });
});
