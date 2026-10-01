import { formatSaleSizes, parseSaleSizes } from './size-format.js';

describe('사이즈 표기 되읽기(P4-02 — 사양 블록 사이즈 집합)', () => {
  it('formatSaleSizes 표기를 그대로 되읽는다', () => {
    for (const sizes of [
      [250, 255, 260, 265, 275],
      [250, 255, 260, 265, 270, 275, 280],
      [230],
      [235, 245],
    ]) {
      expect(parseSaleSizes(formatSaleSizes(sizes))).toEqual(sizes);
    }
    expect(parseSaleSizes('250~265·275mm (JP 25.0~26.5·27.5cm)')).toEqual([
      250, 255, 260, 265, 275,
    ]);
  });

  it('모양이 다르면 null', () => {
    expect(parseSaleSizes('상품상세 참조')).toBeNull();
    expect(parseSaleSizes('250~252mm')).toBeNull();
    expect(parseSaleSizes('')).toBeNull();
  });
});
