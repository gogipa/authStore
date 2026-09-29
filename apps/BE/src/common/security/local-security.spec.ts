import { checkLocalSecurity, type LocalSecurityRequest } from './local-security.js';

const PORT = 3100;
const req = (
  method: string,
  headers: LocalSecurityRequest['headers'],
  localPort: number | undefined = PORT,
): LocalSecurityRequest => ({ method, headers, localPort });
const none = { extraAllowedOrigins: [] as string[] };
const dev = { extraAllowedOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'] };

describe('checkLocalSecurity', () => {
  describe('Host(모든 요청)', () => {
    it.each(['127.0.0.1:3100', 'localhost:3100', 'LOCALHOST:3100'])('%s는 통과', (host) => {
      expect(checkLocalSecurity(req('GET', { host }), none)).toBeNull();
    });

    it.each([
      ['다른 이름', 'evil.example:3100'],
      ['포트 없음', 'localhost'],
      ['다른 포트', '127.0.0.1:5173'],
      ['0.0.0.0', '0.0.0.0:3100'],
      ['IPv6', '[::1]:3100'],
      ['비어 있음', ''],
    ])('%s(%s)는 HOST_NOT_ALLOWED', (_label, host) => {
      expect(checkLocalSecurity(req('GET', { host }), none)).toBe('HOST_NOT_ALLOWED');
    });

    it('Host 헤더가 없으면 HOST_NOT_ALLOWED', () => {
      expect(checkLocalSecurity(req('GET', {}), none)).toBe('HOST_NOT_ALLOWED');
    });

    it('상태 변경 요청도 Host를 먼저 본다', () => {
      expect(
        checkLocalSecurity(
          req('POST', { host: 'evil.example:3100', 'x-autostore-client': '1' }),
          none,
        ),
      ).toBe('HOST_NOT_ALLOWED');
    });
  });

  describe('조회 요청(GET·HEAD·OPTIONS)', () => {
    it.each(['GET', 'HEAD', 'OPTIONS'])('%s는 헤더 없이 통과', (method) => {
      expect(checkLocalSecurity(req(method, { host: 'localhost:3100' }), none)).toBeNull();
    });
  });

  describe('상태 변경 요청(POST·PUT·PATCH·DELETE)', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post'])(
      '%s에 X-AutoStore-Client가 없으면 CLIENT_HEADER_REQUIRED',
      (method) => {
        expect(checkLocalSecurity(req(method, { host: 'localhost:3100' }), none)).toBe(
          'CLIENT_HEADER_REQUIRED',
        );
      },
    );

    it('X-AutoStore-Client 값이 1이 아니면 CLIENT_HEADER_REQUIRED', () => {
      expect(
        checkLocalSecurity(
          req('POST', { host: 'localhost:3100', 'x-autostore-client': 'true' }),
          none,
        ),
      ).toBe('CLIENT_HEADER_REQUIRED');
    });

    it('Origin 없이 헤더만 있으면 통과(curl 등 비브라우저)', () => {
      expect(
        checkLocalSecurity(
          req('POST', { host: 'localhost:3100', 'x-autostore-client': '1' }),
          none,
        ),
      ).toBeNull();
    });

    it.each(['http://127.0.0.1:3100', 'http://localhost:3100'])(
      '앱 자신의 Origin %s는 통과',
      (origin) => {
        expect(
          checkLocalSecurity(
            req('PUT', { host: '127.0.0.1:3100', origin, 'x-autostore-client': '1' }),
            none,
          ),
        ).toBeNull();
      },
    );

    it.each(['http://evil.example', 'null', 'http://127.0.0.1:5173', 'https://localhost:3100'])(
      '다른 Origin %s는 ORIGIN_NOT_ALLOWED',
      (origin) => {
        expect(
          checkLocalSecurity(
            req('POST', { host: 'localhost:3100', origin, 'x-autostore-client': '1' }),
            none,
          ),
        ).toBe('ORIGIN_NOT_ALLOWED');
      },
    );

    it('개발에서는 FE 개발 서버 Origin을 더 받는다', () => {
      expect(
        checkLocalSecurity(
          req('POST', {
            host: '127.0.0.1:3100',
            origin: 'http://127.0.0.1:5173',
            'x-autostore-client': '1',
          }),
          dev,
        ),
      ).toBeNull();
    });

    it('Origin 검사가 헤더 검사보다 먼저다', () => {
      expect(
        checkLocalSecurity(
          req('POST', { host: 'localhost:3100', origin: 'http://evil.example' }),
          none,
        ),
      ).toBe('ORIGIN_NOT_ALLOWED');
    });
  });
});
