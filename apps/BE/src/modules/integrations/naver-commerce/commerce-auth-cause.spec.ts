import { commerceAuthFixture } from '../../../../test/support/fake-commerce-transport.js';
import {
  CLIENT_SECRET_FORMAT_INVALID,
  classifyCommerceAuthCause,
  COMMERCE_AUTH_CAUSE_RULES,
  commerceAuthFailed,
} from './commerce-auth-cause.js';

const codeOf = (name: Parameters<typeof commerceAuthFixture>[0]) => {
  const f = commerceAuthFixture(name);
  return [f.status, (f.body as { code: string }).code] as const;
};

describe('인증 실패 원인 분류(규칙 11, F-SY-02)', () => {
  it('403 GW.IP_NOT_ALLOWED → IP_NOT_ALLOWED(공식 문서)', () => {
    expect(classifyCommerceAuthCause(...codeOf('token-403-ip-not-allowed'))).toBe('IP_NOT_ALLOWED');
  });

  it('모르는 코드·코드 없음 → UNKNOWN', () => {
    expect(classifyCommerceAuthCause(...codeOf('token-400-bad-timestamp'))).toBe('UNKNOWN');
    expect(classifyCommerceAuthCause(418, 'SOMETHING_NEW')).toBe('UNKNOWN');
    expect(classifyCommerceAuthCause(403, null)).toBe('UNKNOWN');
    expect(classifyCommerceAuthCause(null, undefined)).toBe('UNKNOWN');
  });

  describe('Proposed 매핑 행마다 한 건', () => {
    it.each([
      ['IP_NOT_ALLOWED', 403, 'CLIENT_IP_NOT_ALLOWED'],
      ['DORMANT_AUTH', ...codeOf('token-403-dormant')],
      ['DORMANT_AUTH', 403, 'APPLICATION_INACTIVE'],
      ['STORE_SUSPENDED', ...codeOf('token-403-store-suspended')],
      ['STORE_SUSPENDED', 403, 'STORE_SUSPENDED'],
      ['SECRET_CHANGED', null, CLIENT_SECRET_FORMAT_INVALID],
      ['SECRET_CHANGED', ...codeOf('token-401-authn')],
      ['SECRET_CHANGED', ...codeOf('token-400-invalid-client')],
    ] as const)('%s ← (%p, %s)', (expected, status, code) => {
      expect(classifyCommerceAuthCause(status, code)).toBe(expected);
    });

    it('표의 원인 네 가지가 모두 한 줄 이상 있다', () => {
      expect(new Set(COMMERCE_AUTH_CAUSE_RULES.map((r) => r.category))).toEqual(
        new Set(['IP_NOT_ALLOWED', 'DORMANT_AUTH', 'STORE_SUSPENDED', 'SECRET_CHANGED']),
      );
    });

    it('시크릿 변경 추정은 400·401에서만(500 GW.AUTHN은 UNKNOWN)', () => {
      expect(classifyCommerceAuthCause(500, 'GW.AUTHN')).toBe('UNKNOWN');
    });
  });

  it('COMMERCE_AUTH_FAILED 문구에 원인 이름을 넣고 details에 분류 근거를 담는다', () => {
    const e = commerceAuthFailed({
      causeCategory: 'SECRET_CHANGED',
      errorCode: 'GW.AUTHN',
      httpStatus: 401,
      traceId: 't-1',
    });
    expect(e.code).toBe('COMMERCE_AUTH_FAILED');
    expect(e.getStatus()).toBe(502);
    expect(e.message).toBe(
      '네이버 커머스API 인증에 실패했습니다(시크릿 변경). 시스템 상태 화면의 안내를 따라 주세요.',
    );
    expect(e.details).toEqual({
      target: 'COMMERCE_API',
      causeCategory: 'SECRET_CHANGED',
      errorCode: 'GW.AUTHN',
      httpStatus: 401,
      traceId: 't-1',
    });
  });
});
