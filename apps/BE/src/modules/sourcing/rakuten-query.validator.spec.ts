import { DEFAULT_SETTINGS } from '../settings/defaults/default-settings.js';
import { isWordLongEnough, splitQueryWords } from './domain/rakuten-query.rules.js';
import { validateRakutenQuery } from './rakuten-query.validator.js';

const filters = {
  genreId: DEFAULT_SETTINGS.sourcing.genreId,
  ngKeywords: DEFAULT_SETTINGS.sourcing.ngKeywords,
};

describe('라쿠텐 검색어 형식 검사(F-SO-02, P2-02 규칙 4)', () => {
  it("'アシックス ゲルカヤノ' → valid, 반각 환산 21자(전각 10자 × 2 + 공백 1)", () => {
    const result = validateRakutenQuery('アシックス ゲルカヤノ', filters);
    expect(result).toMatchObject({ valid: true, halfWidthLength: 21, maxHalfWidthLength: 128 });
    expect(result.violations).toEqual([]);
  });

  it("'a' → WORD_TOO_SHORT(반각 1자)", () => {
    const result = validateRakutenQuery('a', filters);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({ rule: 'WORD_TOO_SHORT', word: 'a' }),
    ]);
  });

  it("'あ' → WORD_TOO_SHORT(히라가나는 2자 이상)", () => {
    const result = validateRakutenQuery('あ', filters);
    expect(result.violations.map((v) => v.rule)).toEqual(['WORD_TOO_SHORT']);
    expect(result.violations[0]?.word).toBe('あ');
  });

  it("'靴' → valid(한자 전각 1자)", () => {
    expect(validateRakutenQuery('靴', filters)).toMatchObject({ valid: true, violations: [] });
  });

  it('반각 129자 → TOO_LONG(word null), 128자는 valid', () => {
    expect(validateRakutenQuery('a'.repeat(128), filters).valid).toBe(true);
    const result = validateRakutenQuery('a'.repeat(129), filters);
    expect(result.halfWidthLength).toBe(129);
    expect(result.violations).toEqual([expect.objectContaining({ rule: 'TOO_LONG', word: null })]);
    expect(result.violations[0]?.message).toContain('128');
  });

  it('결과에 검색 필터(genreId 558885·제외어 8개)를 담는다', () => {
    const result = validateRakutenQuery('asics 1201A019', filters);
    expect(result.genreId).toBe(558885);
    expect(result.ngKeywords).toEqual([
      '中古',
      'インソール',
      '靴紐',
      'シューレース',
      '箱のみ',
      'キッズ',
      'ジュニア',
      'ベビー',
    ]);
  });

  it('앞뒤 공백은 떼고 검사하고, 공백만이면 valid=false', () => {
    expect(validateRakutenQuery('  asics  ', filters)).toMatchObject({
      rakutenQuery: 'asics',
      valid: true,
    });
    expect(validateRakutenQuery('   ', filters)).toMatchObject({ rakutenQuery: '', valid: false });
  });

  it('단어 규칙: 기호만 1자·가타카나 1자는 짧고, 한글·전각 영숫자 1자는 된다', () => {
    expect(isWordLongEnough('-')).toBe(false);
    expect(isWordLongEnough('ア')).toBe(false);
    expect(isWordLongEnough('ｱ')).toBe(false);
    expect(isWordLongEnough('アシ')).toBe(true);
    expect(isWordLongEnough('신')).toBe(true);
    expect(isWordLongEnough('Ａ')).toBe(true);
    expect(isWordLongEnough('14')).toBe(true);
  });

  it('단어는 반각·전각 공백으로 나눈다', () => {
    expect(splitQueryWords('アシックス　ゲルカヤノ  14')).toEqual([
      'アシックス',
      'ゲルカヤノ',
      '14',
    ]);
  });
});
