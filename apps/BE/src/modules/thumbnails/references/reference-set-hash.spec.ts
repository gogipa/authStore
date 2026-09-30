import { createHash } from 'node:crypto';
import { referenceSetSha256 } from './reference-set-hash.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const A = sha('front');
const B = sha('side');
const C = sha('logo');

describe('referenceSetSha256(ERD generation_run.reference_set_sha256)', () => {
  it('정렬해 이은 파일 해시의 SHA-256이다', () => {
    const expected = sha([A, B, C].sort().join(''));
    expect(referenceSetSha256([A, B, C])).toBe(expected);
    expect(referenceSetSha256([A, B, C])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('같은 파일을 순서만 바꿔도 같은 값', () => {
    expect(referenceSetSha256([C, A, B])).toBe(referenceSetSha256([A, B, C]));
    expect(referenceSetSha256([B, A])).toBe(referenceSetSha256([A, B]));
  });

  it('한 장만 달라도 다른 값', () => {
    expect(referenceSetSha256([A, B, sha('other')])).not.toBe(referenceSetSha256([A, B, C]));
    expect(referenceSetSha256([A, B])).not.toBe(referenceSetSha256([A, B, C]));
  });

  it('빈 목록·형식이 아닌 해시는 던진다', () => {
    expect(() => referenceSetSha256([])).toThrow();
    expect(() => referenceSetSha256(['ABC'])).toThrow();
    expect(() => referenceSetSha256([A.toUpperCase()])).toThrow();
  });
});
