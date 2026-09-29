import { checkRakutenQuery, halfWidthLength } from './rakuten-query.rules.js';

describe('라쿠텐 검색어 규칙(F-SO-02, P1-04는 반각 128자만)', () => {
  it('반각은 1, 전각(가나·한자·한글·전각 ASCII)은 2로 센다', () => {
    expect(halfWidthLength('asics 1201A019')).toBe(14);
    expect(halfWidthLength('アシックス')).toBe(10);
    expect(halfWidthLength('ｱｼｯｸｽ')).toBe(5); // 반각 가타카나
    expect(halfWidthLength('ゲルカヤノ14')).toBe(12);
    expect(halfWidthLength('아식스')).toBe(6);
    expect(halfWidthLength('ＡＢＣ')).toBe(6);
  });

  it('반각 128자는 되고 129자는 안 된다', () => {
    expect(checkRakutenQuery('a'.repeat(128))).toEqual([]);
    const errors = checkRakutenQuery('a'.repeat(129));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe('rakutenQuery');
  });

  it('전각 65자(반각 130자)는 안 된다', () => {
    expect(checkRakutenQuery('ア'.repeat(64))).toEqual([]);
    expect(checkRakutenQuery('ア'.repeat(65))).toHaveLength(1);
  });
});
