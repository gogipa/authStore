import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../config/paths.js';
import {
  COMMERCE_SECRET_KEYS,
  isSecretKey,
  SECRET_KEY_LABEL,
  SECRET_KEYS,
  secretKeysLabel,
} from './secret-keys.js';

/** 05-2 components.schemas.SecretKey enum(순서 그대로) */
function secretKeysFromSpec(): string[] {
  const yaml = readFileSync(join(REPO_ROOT, 'docs', 'dev', '05_API', '05-2_openapi.yaml'), 'utf8');
  const start = yaml.indexOf('\n    SecretKey:');
  const end = yaml.indexOf('\n    SecretStatus:', start);
  return [...yaml.slice(start, end).matchAll(/^ {6}- ([A-Z_]+)$/gm)].map((m) => m[1]!);
}

describe('비밀 키 허용 목록(규칙 2)', () => {
  it('6개이고 05-2 SecretKey enum과 순서까지 같다', () => {
    expect(SECRET_KEYS).toHaveLength(6);
    expect([...SECRET_KEYS]).toEqual(secretKeysFromSpec());
  });

  it('커머스 키는 client_id·client_secret 둘', () => {
    expect([...COMMERCE_SECRET_KEYS]).toEqual(['COMMERCE_CLIENT_ID', 'COMMERCE_CLIENT_SECRET']);
  });

  it.each(['FOO_KEY', 'commerce_client_id', '', 'COMMERCE_CLIENT_ID ', null, 1])(
    '목록 밖 %p는 비밀 키가 아니다',
    (value) => {
      expect(isSecretKey(value)).toBe(false);
    },
  );

  it("오류 문구용 이름은 '키'로 끝나 조사 '가'가 붙는다", () => {
    for (const key of SECRET_KEYS) expect(SECRET_KEY_LABEL[key].endsWith('키')).toBe(true);
    expect(secretKeysLabel(['COMMERCE_CLIENT_SECRET'])).toBe('커머스API client_secret 키');
    expect(secretKeysLabel([...COMMERCE_SECRET_KEYS])).toBe('커머스API client_id·client_secret 키');
  });
});
