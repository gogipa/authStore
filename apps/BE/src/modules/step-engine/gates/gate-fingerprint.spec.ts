import {
  changedBasisKeys,
  g2Basis,
  g3Basis,
  gateFingerprint,
  type G2BasisInput,
  type G3BasisInput,
} from './gate-fingerprint.js';

/** 판정 예시(화면시안_명세 §4 뉴발란스 530 · 화이트/실버) */
function judgement(patch: Partial<G2BasisInput> = {}): G2BasisInput {
  return {
    itemCode: 'shop-b:20000456',
    selectedColor: '화이트/실버',
    saleCandidate: true,
    saleSizes: [
      { sizeMm: 245, salePriceKrw: 129000, optionPriceKrw: 0 },
      { sizeMm: 250, salePriceKrw: 129000, optionPriceKrw: 0 },
      { sizeMm: 255, salePriceKrw: 131000, optionPriceKrw: 2000 },
    ],
    ...patch,
  };
}

function selection(patch: Partial<G3BasisInput> = {}): G3BasisInput {
  return {
    referenceHashes: ['b'.repeat(64), 'a'.repeat(64)],
    selectedHash: 'c'.repeat(64),
    anchorKey: { modelCode: 'MR530SG', itemCode: null, colorCode: 'SG' },
    ...patch,
  };
}

describe('게이트 지문(F-CW-02, 규칙 8)', () => {
  it('키 정렬 JSON의 SHA-256 hex 64자(ck_gate_pass_fp)', () => {
    const fp = gateFingerprint(g2Basis(judgement()));
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(gateFingerprint({ b: 1, a: 2 })).toBe(gateFingerprint({ a: 2, b: 1 }));
  });

  describe('G2 = itemCode·색상 + 판매 여부·판매 사이즈·사이즈별 판매가·옵션가', () => {
    const base = gateFingerprint(g2Basis(judgement()));

    it('사이즈 순서만 다르면 같다', () => {
      const shuffled = judgement({ saleSizes: [...judgement().saleSizes].reverse() });
      expect(gateFingerprint(g2Basis(shuffled))).toBe(base);
    });

    it('P_min만 바뀌면(판매가·판매 사이즈 그대로) 같다 — PRD §5.1 예', () => {
      // 공급자가 판정 결과 전체를 넘겨도 G2 구성값은 P_min·환율을 받지 않는다
      const withPmin = { ...judgement(), pMinKrw: 118000, fxRate: 9.12 };
      const otherPmin = { ...judgement(), pMinKrw: 121500, fxRate: 9.31 };
      expect(gateFingerprint(g2Basis(withPmin))).toBe(base);
      expect(gateFingerprint(g2Basis(otherPmin))).toBe(base);
      expect(changedBasisKeys(g2Basis(withPmin), g2Basis(otherPmin))).toEqual([]);
    });

    it('250mm 판매가 +100원 → 다르고, changedBasisKeys에 그 키', () => {
      const changed = judgement({
        saleSizes: judgement().saleSizes.map((s) =>
          s.sizeMm === 250 ? { ...s, salePriceKrw: (s.salePriceKrw ?? 0) + 100 } : s,
        ),
      });
      expect(gateFingerprint(g2Basis(changed))).not.toBe(base);
      expect(changedBasisKeys(g2Basis(judgement()), g2Basis(changed))).toEqual(['salePrices.250']);
    });

    it('itemCode가 바뀌면 다르다', () => {
      const other = g2Basis(judgement({ itemCode: 'shop-c:30000789' }));
      expect(gateFingerprint(other)).not.toBe(base);
      expect(changedBasisKeys(g2Basis(judgement()), other)).toEqual(['itemCode']);
    });

    it('판매 여부·판매 사이즈·옵션가·색상도 지문에 들어간다', () => {
      const notSale = g2Basis(judgement({ saleCandidate: false }));
      expect(changedBasisKeys(g2Basis(judgement()), notSale)).toEqual(['saleCandidate']);
      const fewer = g2Basis(judgement({ saleSizes: judgement().saleSizes.slice(0, 2) }));
      expect(changedBasisKeys(g2Basis(judgement()), fewer)).toEqual([
        'optionPrices.255',
        'salePrices.255',
        'saleSizes',
      ]);
      const color = g2Basis(judgement({ selectedColor: '그레이' }));
      expect(gateFingerprint(color)).not.toBe(base);
    });
  });

  describe('G3 = 레퍼런스 파일 해시 + 선택본 파일 해시 + 앵커 키', () => {
    const base = gateFingerprint(g3Basis(selection()));

    it('레퍼런스 순서만 다르면 같다', () => {
      const same = selection({ referenceHashes: ['a'.repeat(64), 'b'.repeat(64)] });
      expect(gateFingerprint(g3Basis(same))).toBe(base);
    });

    it('레퍼런스 해시·선택본 해시·앵커 색상 중 하나만 바꿔도 다르다', () => {
      const ref = g3Basis(selection({ referenceHashes: ['a'.repeat(64), 'd'.repeat(64)] }));
      const picked = g3Basis(selection({ selectedHash: 'e'.repeat(64) }));
      const color = g3Basis(
        selection({ anchorKey: { modelCode: 'MR530SG', itemCode: null, colorCode: 'SH' } }),
      );
      for (const basis of [ref, picked, color]) expect(gateFingerprint(basis)).not.toBe(base);
      expect(changedBasisKeys(g3Basis(selection()), ref)).toEqual(['referenceHashes']);
      expect(changedBasisKeys(g3Basis(selection()), picked)).toEqual(['selectedHash']);
      expect(changedBasisKeys(g3Basis(selection()), color)).toEqual(['anchorKey.colorCode']);
    });
  });

  it('changedBasisKeys: 한쪽에만 있는 키도 바뀐 것으로 본다(빈 구성값 포함)', () => {
    expect(changedBasisKeys({}, { a: 1 })).toEqual(['a']);
    expect(changedBasisKeys({ a: { b: 1, c: 2 } }, { a: { b: 1 } })).toEqual(['a.c']);
    expect(changedBasisKeys({ a: null }, {})).toEqual([]);
  });
});
