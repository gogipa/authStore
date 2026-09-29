import { isAbsolute } from 'node:path';
import { validateEnv } from './env.validation.js';

describe('validateEnv', () => {
  const base = { DATABASE_URL: 'postgresql://user@localhost:5432/autostore_dev' };

  it('기본값: NODE_ENV development, PORT 3100, LOG_LEVEL info, APP_DATA_DIR 절대 경로(.data)', () => {
    const env = validateEnv({ ...base, APP_DATA_DIR: '' });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3100);
    expect(env.LOG_LEVEL).toBe('info');
    expect(isAbsolute(env.APP_DATA_DIR)).toBe(true);
    expect(env.APP_DATA_DIR.endsWith('.data')).toBe(true);
    expect(env.DEV_FE_ORIGINS).toBe('http://127.0.0.1:5173,http://localhost:5173');
  });

  it('PORT 문자열을 숫자로 바꾼다', () => {
    expect(validateEnv({ ...base, PORT: '4000' }).PORT).toBe(4000);
  });

  it('DATABASE_URL이 없으면 시작하지 않는다', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it.each([
    ['NODE_ENV', 'staging'],
    ['PORT', 'abc'],
    ['PORT', '70000'],
    ['LOG_LEVEL', 'verbose'],
  ])('%s=%s는 거부', (key, value) => {
    expect(() => validateEnv({ ...base, [key]: value })).toThrow(new RegExp(key));
  });
});
