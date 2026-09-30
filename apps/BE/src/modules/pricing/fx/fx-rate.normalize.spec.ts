import { INPUT_KEY_LABEL } from '../../step-engine/domain/input-keys.js';
import {
  Decimal,
  divergenceOf,
  formatPerUnit,
  FX_INPUT_KEYS,
  fxInputKey,
  fxInputValue,
  normalizeCostRate,
  normalizeCustomsRate,
  parseRateNumber,
  perUnit,
  stripSecretKeys,
  unitOf,
} from './fx-rate.normalize.js';

describe('환율 정규화(fx-rate.normalize, 규칙 1·2·8)', () => {
  it("원가: 'JPY(100)', '876.00' → rateValue 876 · unit 100 · 계산값 8.76", () => {
    const n = normalizeCostRate({ currencyUnit: 'JPY(100)', dealBasR: '876.00', raw: {} })!;
    expect(n.rateValue.toFixed()).toBe('876');
    expect(n.unit).toBe(100);
    expect(perUnit(n.rateValue, n.unit).toFixed()).toBe('8.76');
  });

  it("과세 USD '1,358.72' → 1358.72 · unit 1(달러는 늘 1)", () => {
    const n = normalizeCustomsRate({
      currency: 'USD',
      rate: '1,358.72',
      unitName: '100달러',
      applyStartDate: null,
      raw: {},
    })!;
    expect(n.rateValue.toFixed()).toBe('1358.72');
    expect(n.unit).toBe(1);
    expect(n.currency).toBe('USD');
  });

  it("과세 엔 '100엔' → unit 100, 단위 표기 없으면 1", () => {
    expect(unitOf('100엔', 'JPY')).toBe(100);
    expect(unitOf('100 엔', 'JPY')).toBe(100);
    expect(unitOf('JPY', 'JPY')).toBe(1);
    expect(unitOf(null, 'JPY')).toBe(1);
    expect(unitOf('1000엔', 'JPY')).toBe(1);
  });

  it('숫자 파싱: 쉼표·공백 제거, 넷째 자리 반올림, 0 이하·글자·numeric(12,4) 밖은 null', () => {
    expect(parseRateNumber(' 1,358.72 ')!.toFixed()).toBe('1358.72');
    expect(parseRateNumber('8.76005')!.toFixed()).toBe('8.7601');
    expect(parseRateNumber('0')).toBeNull();
    expect(parseRateNumber('-1')).toBeNull();
    expect(parseRateNumber('abc')).toBeNull();
    expect(parseRateNumber('100000000')).toBeNull();
  });

  it('perUnit은 Decimal로 나눈다(부동소수점 오차 없음) · unit은 1·100만', () => {
    expect(perUnit('1358.72', 1).toFixed()).toBe('1358.72');
    expect(perUnit(new Decimal('876.1234'), 100).toFixed()).toBe('8.761234');
    expect(() => perUnit(876, 10)).toThrow();
  });

  it("표기: '8.76원/엔' · '1,358.72원/달러'", () => {
    expect(formatPerUnit(perUnit(876, 100), 'JPY')).toBe('8.76원/엔');
    expect(formatPerUnit(new Decimal('1358.72'), 'USD')).toBe('1,358.72원/달러');
  });
});

describe('원가·과세 차이 경고(divergenceOf, 규칙 6)', () => {
  it('원가 8.76 · 과세 엔 10.52 → FX_DIVERGENCE(+20.09%)', () => {
    const d = divergenceOf('8.76', '10.52');
    expect(d.exceeds).toBe(true);
    expect(d.pct.toFixed(2)).toBe('20.09');
  });

  it('원가 8.76 · 과세 엔 10.512(정확히 +20%) → 경고 없음', () => {
    const d = divergenceOf('8.76', '10.512');
    expect(d.pct.toFixed(2)).toBe('20.00');
    expect(d.exceeds).toBe(false);
  });

  it('아래쪽도 ±로 본다(과세가 20% 넘게 낮으면 경고)', () => {
    expect(divergenceOf('8.76', '7.00').exceeds).toBe(true);
    expect(divergenceOf('8.76', '7.008').exceeds).toBe(false);
  });
});

describe('raw_response 비밀 키 빼기(규칙 3)', () => {
  it('응답에 authkey 최상위 키가 있어도 저장 전에 빠진다(중첩·serviceKey도)', () => {
    const raw = {
      authkey: 'SECRET',
      cur_unit: 'JPY(100)',
      deal_bas_r: '876.00',
      nested: { serviceKey: 'X', keep: 1 },
      list: [{ authKey: 'Y', a: 2 }],
    };
    expect(stripSecretKeys(raw)).toEqual({
      cur_unit: 'JPY(100)',
      deal_bas_r: '876.00',
      nested: { keep: 1 },
      list: [{ a: 2 }],
    });
  });
});

describe('③ 입력 이름·값(P2-04 Proposed)', () => {
  it('종류·통화 → fx.* 이름, 원가 달러는 없다. step-engine 화면 이름 표에 있다', () => {
    expect(fxInputKey('COST', 'JPY')).toBe('fx.costJpy');
    expect(fxInputKey('CUSTOMS', 'JPY')).toBe('fx.customsJpy');
    expect(fxInputKey('CUSTOMS', 'USD')).toBe('fx.customsUsd');
    expect(fxInputKey('COST', 'USD')).toBeNull();
    for (const key of Object.values(FX_INPUT_KEYS)) expect(INPUT_KEY_LABEL[key]).toBeDefined();
  });

  it('값은 계산용 환율 한 칸(876/100과 8.76/1은 같은 값)', () => {
    expect(fxInputValue(876, 100)).toEqual({ perUnit: '8.76' });
    expect(fxInputValue('8.7600', 1)).toEqual(fxInputValue(876, 100));
  });
});
