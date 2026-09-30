import {
  canonicalJson,
  changedInputKeys,
  fingerprint,
  inputFingerprint,
  normalizeText,
  NULL_VALUE_HASH,
  textHash,
  valueHash,
} from './fingerprint.js';

describe('입력 지문(F-BS-20, 규칙 5)', () => {
  it('키 순서가 달라도 값 해시·지문이 같다', () => {
    expect(valueHash({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(
      valueHash({ b: { d: [1, 2], c: 2 }, a: 1 }),
    );
    expect(fingerprint({ 'candidate.gender': 'x', 'settings.costs': 'y' })).toBe(
      fingerprint({ 'settings.costs': 'y', 'candidate.gender': 'x' }),
    );
    expect(canonicalJson({ b: 1, a: undefined, c: new Date('2026-09-28T00:00:00Z') })).toBe(
      '{"b":1,"c":"2026-09-28T00:00:00.000Z"}',
    );
  });

  it('소문자 hex 64자', () => {
    expect(valueHash('ABC')).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint({})).toMatch(/^[0-9a-f]{64}$/);
    expect(NULL_VALUE_HASH).toBe(valueHash(null));
    expect(valueHash(undefined)).toBe(NULL_VALUE_HASH);
  });

  it("'ＡＢＣ  x'와 'ABC x'가 같은 해시(NFKC·공백 정리)", () => {
    expect(normalizeText('ＡＢＣ  x')).toBe('ABC x');
    expect(normalizeText('  アシックス　 ゲルカヤノ14\n')).toBe('アシックス ゲルカヤノ14');
    expect(textHash('ＡＢＣ  x')).toBe(textHash('ABC x'));
    expect(textHash('ＡＢＣ  x')).toBe(valueHash('ABC x'));
  });

  it('수집 시각·실행 중 오너 입력(ownerInputs)을 바꿔도 지문은 그대로(시작 조건만 넣는다)', () => {
    const base = [
      { inputKey: 'sourcing.targetSkus', isStartCondition: true, valueHash: valueHash([1, 2]) },
      { inputKey: 'candidate.gender', isStartCondition: true, valueHash: valueHash('MALE') },
    ];
    const withOwner = [
      ...base,
      { inputKey: 'owner.domesticPrice', isStartCondition: false, valueHash: valueHash(89000) },
    ];
    const otherOwner = [
      ...base,
      { inputKey: 'owner.domesticPrice', isStartCondition: false, valueHash: valueHash(99000) },
    ];
    expect(inputFingerprint(withOwner)).toBe(inputFingerprint(base));
    expect(inputFingerprint(otherOwner)).toBe(inputFingerprint(base));
    // 수집 시각은 값에 넣지 않는다: 같은 SKU가면 수집 시각이 달라도 같은 해시(실행기가 빼고 넘긴다)
    expect(valueHash({ skus: [1, 2] })).toBe(valueHash({ skus: [1, 2] }));
  });

  it('선택 입력 없음 = null 값 해시(행이 없어도 같은 지문)', () => {
    const withNull = [
      { inputKey: 'sourcing.modelInfo', isStartCondition: true, valueHash: valueHash('X') },
      { inputKey: 'category.leafPath', isStartCondition: true, valueHash: valueHash(null) },
    ];
    expect(inputFingerprint(withNull)).toBe(
      fingerprint({ 'sourcing.modelInfo': valueHash('X'), 'category.leafPath': NULL_VALUE_HASH }),
    );
  });

  it('바뀐 입력 이름: 키를 합쳐 값이 다른 키(한쪽에만 있으면 null 값 해시로 본다)', () => {
    const stored = { a: valueHash(1), b: valueHash(2), c: NULL_VALUE_HASH };
    expect(changedInputKeys(stored, { a: valueHash(1), b: valueHash(3) })).toEqual(['b']);
    expect(changedInputKeys(stored, { ...stored, d: valueHash('new') })).toEqual(['d']);
    expect(changedInputKeys({ a: valueHash(1) }, {})).toEqual(['a']);
    expect(changedInputKeys(stored, stored)).toEqual([]);
  });
});
