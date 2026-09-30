import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BE_ROOT } from '../../../common/config/paths.js';
import { DEFAULT_SETTINGS } from '../../settings/defaults/default-settings.js';
import type { AppSettings, PriceRuleMethod } from '../../settings/schema/settings.types.js';
import type { RateTableInput } from './chargeable-weight.js';
import { dec } from './money.js';
import {
  judgePrice,
  minimumPriceOf,
  profitAt,
  type JudgedSize,
  type PriceJudgementInput,
  type PriceJudgementResult,
} from './price-judgement.calc.js';
import { pricingParamsOf } from './pricing-params.js';

/** PRD §8.3 테스트 기대값(NFR-06)과 P2-05 §6 단위 표. fixture는 apps/BE/test/fixtures/pricing/*.json */

interface Fixture {
  settings: 'DEFAULT' | Record<string, Record<string, unknown>>;
  input: Omit<PriceJudgementInput, 'params'> & { forwarder: RateTableInput | null };
  expected: Record<string, unknown>;
}

function load(name: string): Fixture {
  return JSON.parse(
    readFileSync(join(BE_ROOT, 'test', 'fixtures', 'pricing', `${name}.json`), 'utf8'),
  ) as Fixture;
}

function settingsWith(patch: Fixture['settings'] = 'DEFAULT'): AppSettings {
  const base = structuredClone(DEFAULT_SETTINGS) as unknown as Record<
    string,
    Record<string, unknown>
  >;
  if (patch !== 'DEFAULT') {
    for (const [section, values] of Object.entries(patch)) {
      base[section] = { ...base[section], ...values };
    }
  }
  return base as unknown as AppSettings;
}

function run(
  fixture: Fixture,
  patch: Partial<PriceJudgementInput> = {},
  settings = settingsWith(fixture.settings),
): PriceJudgementResult {
  return judgePrice({ ...fixture.input, params: pricingParamsOf(settings), ...patch });
}

function size(result: PriceJudgementResult, mm: number): JudgedSize {
  const found = result.sizes.find((s) => s.sizeMm === mm);
  if (!found) throw new Error(`${mm}mm 없음`);
  return found;
}

function withRule(method: PriceRuleMethod, fixture: Fixture) {
  const settings = settingsWith(fixture.settings);
  settings.pricing = { ...settings.pricing, priceRule: { method, refDiscountPct: 1 } };
  return run(fixture, {}, settings);
}

describe('judgePrice — PRD §8.3 예시(¥12,000 · 환율 8.76 · 모드 A)', () => {
  const fx = load('prd-example');
  const e = fx.expected;
  const result = run(fx);
  const s250 = size(result, 250);

  it('원가·면세: C_goods 107,748 · V_usd 77.37 면세 · 경계값 ¥22,490 · 2켤레 과세 전환(154.73) · 경계 아님', () => {
    expect(s250.cGoodsKrw).toBe(e.cGoodsKrw);
    expect(s250.goodsBaseKrw).toBe(e.goodsBaseKrw);
    expect(s250.cardSurchargeKrw).toBe(e.cardSurchargeKrw);
    expect(s250.vUsd.toFixed(2)).toBe(e.vUsd);
    expect(s250.isDutyFree).toBe(true);
    expect(result.dutyFreeLimitYen).toBe(e.dutyFreeLimitYen);
    expect(s250.twoPairTaxable).toBe(true);
    // 2켤레 금액은 반올림 전 값의 두 배(154.7338…)로 판정한다
    expect(dec(12000).mul('8.76').div('1358.72').mul(2).toFixed(2)).toBe(e.twoPairUsd);
    expect(s250.isBoundary).toBe(false);
    expect(s250.cTaxKrw).toBe(0);
    expect(s250.customsValueKrw).toBeNull();
  });

  it('요금표 없음: C_fwd 15,000 · 가정값 · 요금표 id null', () => {
    expect(result.forwarder.cFwdKrw).toBe(15000);
    expect(result.forwarder.fwdAssumed).toBe(true);
    expect(result.forwarder.rateTableId).toBeNull();
    expect(result.forwarder.fallbackReason).toBe('NO_RATE_TABLE');
  });

  it('최소 판매가 153,100 · 그때 순이익(모드 A) 15,365 · 모드 B 순이익 4,206', () => {
    expect(s250.pMinKrw).toBe(e.pMinKrw);
    const at = profitAt(153100, { cGoodsKrw: 107748, cFwdKrw: 15000, cTaxKrw: 0 }, ratesOf());
    expect(at.profitAKrw).toBe(e.profitAtPMin);
    expect(at.profitBKrw).toBe(e.profitBAtPMin);
  });

  it('국내 기준가 169,000: 판매가 167,300 · C_mkt 11,092(5,019 + 6,073) · VAT_A 3,042 · 순이익 27,418 · 16.4% · 모드 B 16,259 → 판매 가능', () => {
    expect(result.salePriceKrw).toBe(e.salePriceKrw);
    expect(s250.sizeSalePriceKrw).toBe(167300);
    const b = s250.breakdown!;
    expect(b.saleFeeKrw).toBe(e.saleFeeKrw);
    expect(b.npayFeeKrw).toBe(e.npayFeeKrw);
    expect(b.cMktKrw).toBe(e.cMktKrw);
    expect(b.vatAKrw).toBe(e.vatAKrw);
    expect(b.profitAKrw).toBe(e.profitAKrw);
    expect(b.marginRateA.toFixed(4)).toBe(e.marginRateA);
    expect(b.marginRateA.mul(100).toFixed(1)).toBe('16.4');
    expect(b.profitBKrw).toBe(e.profitBKrw);
    expect(s250.isSellable).toBe(true);
    expect(result.sellableSizeCount).toBe(5);
    expect(result.isSaleCandidate).toBe(true);
    expect(result.exclusionReason).toBeNull();
    expect(result.gateRounds).toBe(1);
    expect(s250.pointsReferencePt).toBe(1090);
  });

  it('모드 B로 마진 10%를 맞추는 P_min은 약 168,000(PRD "약" — 참고 검사)', () => {
    const settings = settingsWith();
    settings.costs = { ...settings.costs, vatMode: 'B' };
    const b = size(run(fx, {}, settings), 250);
    expect(Math.abs(b.pMinKrw! - (e.modeBPMinApprox as number))).toBeLessThanOrEqual(500);
  });

  it('쿠폰 ¥1,000: C_goods만 98,769로 줄고 V_usd·CV는 그대로', () => {
    const couponed = size(run(fx, { couponYen: 1000 }), 250);
    expect(couponed.cGoodsKrw).toBe(98769);
    expect(couponed.vUsd.toFixed(2)).toBe('77.37');
    // 과세 상품(¥23,000)이면 CV도 쿠폰과 관계없다
    const tax = load('taxable-23000');
    const plain = size(run(tax), 260);
    const withCoupon = size(run(tax, { couponYen: 1000 }), 260);
    expect(withCoupon.customsValueKrw).toBe(plain.customsValueKrw);
    expect(withCoupon.vUsd.toFixed(2)).toBe(plain.vUsd.toFixed(2));
    expect(withCoupon.cGoodsKrw).toBeLessThan(plain.cGoodsKrw);
  });

  it('판정 여유 경계: P_ref 154,647 → 판매 가능 / 154,646 → P_MIN_OVER_REF', () => {
    expect(size(run(fx, { pRefKrw: 154647 }), 250).isSellable).toBe(true);
    const over = size(run(fx, { pRefKrw: 154646 }), 250);
    expect(over.isSellable).toBe(false);
    expect(over.unsellableReason).toBe('P_MIN_OVER_REF');
    expect(over.sizeSalePriceKrw).toBeNull();
  });
});

function ratesOf() {
  return {
    saleFee: dec('0.03'),
    npayFee: dec('0.0363'),
    margin: dec('0.1'),
    minProfit: 5000,
    misc: 3000,
    pointsValueKrw: 0,
    vatMode: 'A' as const,
  };
}

describe('judgePrice — 면세 경계·과세(¥23,000, 요금표 1.5kg 구간 ¥2,000)', () => {
  const fx = load('taxable-23000');
  const result = run(fx);
  const e = fx.expected as {
    chargeableWeightKg: string;
    cShipIntlKrw: number;
    sizes: Record<string, Record<string, unknown>>;
  };

  it('¥22,490 → V_usd 145.00(144.998) 면세·경계 / ¥22,491 → 145.005 과세', () => {
    const at = size(result, 250);
    expect(at.vUsd.toFixed(2)).toBe('145.00');
    expect(at.isDutyFree).toBe(true);
    expect(at.isBoundary).toBe(true);
    const over = size(result, 255);
    expect(over.isDutyFree).toBe(false);
    expect(over.unsellableReason).toBe('TAXABLE');
  });

  it('과세 ¥23,000: V_usd 148.29 · 과세 · 경계 · C_ship_intl 17,520 · CV 219,000 · C_tax 53,217(13%) · TAXABLE', () => {
    const tax = size(result, 260);
    expect(tax.vUsd.toFixed(2)).toBe('148.29');
    expect(tax.isDutyFree).toBe(false);
    expect(tax.isBoundary).toBe(true);
    expect(result.forwarder.cShipIntlKrw).toBe(e.cShipIntlKrw);
    expect(result.forwarder.chargeableWeightKg!.toFixed(3)).toBe(e.chargeableWeightKg);
    expect(result.forwarder.rateTableId).toBe(1);
    expect(result.forwarder.fwdAssumed).toBe(false);
    expect(tax.customsValueKrw).toBe(219000);
    expect(tax.dutyKrw).toBe(28470);
    expect(tax.importVatKrw).toBe(24747);
    expect(tax.cTaxKrw).toBe(53217);
    expect(tax.unsellableReason).toBe('TAXABLE');
    // 과세 사이즈도 P_min은 계산해 보여 준다(M1은 판매하지 않는다)
    expect(tax.pMinKrw).not.toBeNull();
  });

  it('간이세율(18%)을 켜면 C_tax 39,420', () => {
    const settings = settingsWith();
    settings.pricing = {
      ...settings.pricing,
      simplifiedDuty: { enabled: true, ratePct: 18 },
    };
    expect(size(run(fx, {}, settings), 260).cTaxKrw).toBe(39420);
  });

  it('HS 6401(8%)로 바꾸면 관세율이 바뀐다(판정 스냅샷 params에 적용 값)', () => {
    const settings = settingsWith();
    settings.pricing = { ...settings.pricing, dutyHsHeading: '6401' };
    const tax = size(run(fx, {}, settings), 260);
    expect(tax.dutyKrw).toBe(17520);
    expect(tax.importVatKrw).toBe(23652);
  });

  it('과세 판매 설정을 켜면 과세 사이즈도 판정에 든다(관부가세를 원가에 넣는다)', () => {
    const settings = settingsWith();
    settings.pricing = { ...settings.pricing, sellTaxableSizes: true };
    const tax = size(run(fx, {}, settings), 260);
    expect(tax.unsellableReason).not.toBe('TAXABLE');
  });
});

describe('judgePrice — 가격 책정 규칙(F-PJ-16)', () => {
  const fx = load('option-price');
  const e = fx.expected as {
    pMinKrw: Record<string, number>;
    OPTION_PRICE: { salePriceKrw: number; optionPriceKrw: Record<string, number> };
    MAX_SKU_SINGLE: { salePriceKrw: number };
    REF_MINUS_100: { salePriceKrw: number };
  };

  it('사이즈별 P_min 153,100 · 153,100 · 155,300', () => {
    const result = run(fx);
    for (const [mm, pMin] of Object.entries(e.pMinKrw)) {
      expect(size(result, Number(mm)).pMinKrw).toBe(pMin);
    }
  });

  it('기본(국내가 −1%) 단일가는 판매 가능 P_min 중 가장 큰 값보다 낮을 수 없다', () => {
    const low = run(fx, { pRefKrw: 157000 });
    // floor100(157,000 × 0.99) = 155,400 ≥ 155,300
    expect(low.salePriceKrw).toBe(155400);
    expect(low.sizes.every((s) => s.optionPriceKrw === 0)).toBe(true);
  });

  it('REF_MINUS_100 → 168,900', () => {
    expect(withRule('REF_MINUS_100', fx).salePriceKrw).toBe(e.REF_MINUS_100.salePriceKrw);
  });

  it('OPTION_PRICE → 판매가 153,100, 옵션가 0·0·2,200(모자란 금액을 100원 단위로 올림)', () => {
    const result = withRule('OPTION_PRICE', fx);
    expect(result.salePriceKrw).toBe(e.OPTION_PRICE.salePriceKrw);
    for (const [mm, option] of Object.entries(e.OPTION_PRICE.optionPriceKrw)) {
      expect(size(result, Number(mm)).optionPriceKrw).toBe(option);
      expect(size(result, Number(mm)).sizeSalePriceKrw).toBe(153100 + option);
    }
    expect(result.pricingRule).toBe('OPTION_PRICE');
  });

  it('MAX_SKU_SINGLE → 155,300(max P_min, 옵션가 0)', () => {
    const result = withRule('MAX_SKU_SINGLE', fx);
    expect(result.salePriceKrw).toBe(e.MAX_SKU_SINGLE.salePriceKrw);
    expect(result.sizes.every((s) => s.optionPriceKrw === 0)).toBe(true);
  });
});

describe('judgePrice — 모드 B 게이트·최종 판정', () => {
  it('mode-b-negative: 비싼 사이즈가 MODE_B_NEGATIVE로 빠지고 남은 사이즈로 다시 계산한다', () => {
    const fx = load('mode-b-negative');
    const e = fx.expected as {
      salePriceKrw: number;
      gateRounds: number;
      modeBNegative: number[];
      sellable: number[];
    };
    const result = run(fx);
    expect(result.gateRounds).toBe(e.gateRounds);
    for (const mm of e.modeBNegative) {
      const s = size(result, mm);
      expect(s.unsellableReason).toBe('MODE_B_NEGATIVE');
      expect(s.isSellable).toBe(false);
      expect(s.breakdown!.profitBKrw).toBeLessThan(0);
    }
    for (const mm of e.sellable) {
      const s = size(result, mm);
      expect(s.isSellable).toBe(true);
      expect(s.breakdown!.profitBKrw).toBeGreaterThanOrEqual(0);
    }
    expect(result.salePriceKrw).toBe(e.salePriceKrw);
    expect(result.sellableSizeCount).toBe(e.sellable.length);
    expect(result.isSaleCandidate).toBe(true);
  });

  it('게이트로 모두 빠지면 판매가 없음 + 판매 후보 아님', () => {
    const fx = load('mode-b-negative');
    const settings = settingsWith(fx.settings);
    settings.pricing = {
      ...settings.pricing,
      priceRule: { method: 'MAX_SKU_SINGLE', refDiscountPct: 1 },
    };
    const result = run(fx, {}, settings);
    expect(result.sellableSizeCount).toBe(0);
    expect(result.salePriceKrw).toBeNull();
    expect(result.isSaleCandidate).toBe(false);
    expect(result.exclusionReason).toContain('모드 B 순이익 음수');
  });

  it('min-sizes-2: 판매 가능 2개, 기준 3 → 판매 후보 아님 + 사유', () => {
    const fx = load('min-sizes-2');
    const e = fx.expected as {
      sellableSizeCount: number;
      salePriceKrw: number;
      exclusionReason: string;
    };
    const result = run(fx);
    expect(result.sellableSizeCount).toBe(e.sellableSizeCount);
    expect(result.isSaleCandidate).toBe(false);
    expect(result.salePriceKrw).toBe(e.salePriceKrw);
    expect(result.exclusionReason).toBe(e.exclusionReason);
  });

  it('재고 있는 목표 사이즈가 없으면 판매 후보 아님', () => {
    const fx = load('prd-example');
    const result = run(fx, { sizes: [] });
    expect(result.isSaleCandidate).toBe(false);
    expect(result.exclusionReason).toBe('재고 있는 목표 사이즈가 없어 판정할 수 없습니다.');
  });
});

describe('minimumPriceOf', () => {
  it('목표를 맞출 수 없는 비용이면 null(판매 불가)', () => {
    expect(
      minimumPriceOf(
        { cGoodsKrw: 100000, cFwdKrw: 15000, cTaxKrw: 0 },
        { ...ratesOf(), margin: dec('0.9') },
        100,
      ),
    ).toBeNull();
  });
});
