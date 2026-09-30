import { Writable } from 'node:stream';
import { pino, type LoggerOptions } from 'pino';
import { clearKnownSecrets, registerKnownSecret } from '../secrets/secret-mask.js';
import { buildPinoHttpOptions } from './logging.module.js';

const SECRET = 'fake-client-secret-for-log-test';
const TOKEN = 'FAKE-ACCESS-TOKEN-for-autostore-tests-only';
const SIGN = 'JDJhJDA0JEZha2VTYWx0Rm9yVW5pdFRlc3RzMGVG';

function memoryLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString('utf8'));
      cb();
    },
  });
  const logger = pino(
    buildPinoHttpOptions({ level: 'trace', pretty: false }) as LoggerOptions,
    stream,
  );
  return { logger, output: () => lines.join('') };
}

describe('로그 가림(규칙 5, F-BS-25)', () => {
  beforeEach(() => {
    clearKnownSecrets();
    registerKnownSecret(SECRET);
    registerKnownSecret(SIGN);
  });
  afterAll(() => clearKnownSecrets());

  it('들어오는 요청의 authorization·x-*-secret 헤더를 가린다', () => {
    const { logger, output } = memoryLogger();
    logger.info(
      {
        req: {
          method: 'PUT',
          url: '/api/v1/secrets/COMMERCE_CLIENT_SECRET',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'x-client-secret': SECRET,
            cookie: 'sid=abc123456',
            'x-autostore-client': '1',
          },
        },
      },
      'request completed',
    );
    const out = output();
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain('abc123456');
    expect(out).toContain('"x-autostore-client":"1"');
    expect(out).toContain('COMMERCE_CLIENT_SECRET');
  });

  it('나가는 요청의 Authorization: Bearer와 토큰 폼 본문을 가린다', () => {
    const { logger, output } = memoryLogger();
    logger.debug(
      {
        outgoing: {
          url: 'https://api.commerce.naver.com/external/v1/oauth2/token',
          headers: { Authorization: `Bearer ${TOKEN}` },
          form: { client_id: 'fake-id', client_secret_sign: SIGN, type: 'SELF' },
        },
      },
      `sending client_secret_sign=${SIGN}`,
    );
    logger.warn(`retry with Authorization: Bearer ${TOKEN}`);
    const out = output();
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(SIGN);
    expect(out).toContain('"type":"SELF"');
  });

  it('오류 객체의 메시지·stack 속 알려진 비밀값을 지운다', () => {
    const { logger, output } = memoryLogger();
    logger.error({ err: new Error(`keychain failed near ${SECRET}`) }, `boom ${SECRET}`);
    const out = output();
    expect(out).not.toContain(SECRET);
    expect(out).toContain('keychain failed near ***');
  });
});
