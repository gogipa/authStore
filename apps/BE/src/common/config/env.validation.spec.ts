import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { validateEnv } from './env.validation.js';
import { APP_DIR_NAME, defaultProductionDataDir, REPO_ROOT } from './paths.js';

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

  it('운영 기본 데이터 폴더는 설치 폴더(저장소) 밖의 OS 사용자 데이터 폴더다(F-BS-02)', () => {
    const env = validateEnv({ ...base, NODE_ENV: 'production', APP_DATA_DIR: '' });
    expect(env.APP_DATA_DIR).toBe(defaultProductionDataDir({ ...base }));
    expect(relative(REPO_ROOT, env.APP_DATA_DIR).startsWith('..')).toBe(true);
  });

  it.each([
    ['darwin', {}, join('/h', 'Library', 'Application Support', APP_DIR_NAME)],
    [
      'win32',
      { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' },
      join('C:\\Users\\u\\AppData\\Roaming', APP_DIR_NAME),
    ],
    ['linux', {}, join('/h', '.local', 'share', APP_DIR_NAME)],
    ['linux', { XDG_DATA_HOME: '/x/data' }, join('/x/data', APP_DIR_NAME)],
  ] as const)('운영 기본 데이터 폴더(%s)', (platform, extra, expected) => {
    expect(defaultProductionDataDir(extra, platform, '/h')).toBe(expected);
  });

  it('코드 폴더(apps/) 안은 데이터 폴더로 쓸 수 없다', () => {
    expect(() => validateEnv({ ...base, APP_DATA_DIR: 'apps/BE/data' })).toThrow(/APP_DATA_DIR/);
    expect(() => validateEnv({ ...base, APP_DATA_DIR: join(REPO_ROOT, 'apps') })).toThrow(
      /APP_DATA_DIR/,
    );
  });

  it('운영에서는 저장소 안(.data)을 데이터 폴더로 쓸 수 없다', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', APP_DATA_DIR: '.data' })).toThrow(
      /설치 폴더 밖/,
    );
  });

  it('저장소 밖 절대 경로는 그대로 쓴다', () => {
    const dir = join(tmpdir(), 'autostore-data');
    expect(validateEnv({ ...base, APP_DATA_DIR: dir }).APP_DATA_DIR).toBe(dir);
    expect(homedir().length).toBeGreaterThan(0);
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
