import { chargeableWeightOf, forwarderCost, type ForwarderCostInput } from './chargeable-weight.js';
import { ceil100, dec, floor100, roundWon } from './money.js';

const BOX = { lengthCm: 33, widthCm: 22, heightCm: 12, weightKg: 1.2 };

function input(patch: Partial<ForwarderCostInput> = {}): ForwarderCostInput {
  return {
    table: null,
    box: BOX,
    fxCostPerUnit: dec('8.76'),
    defaultFeeKrw: 15000,
    handling: { included: true, amountKrw: 0 },
    couponKrw: 0,
    ...patch,
  };
}

describe('청구무게(규칙 6, F-PJ-06)', () => {
  it('나눗수 6000 → 1.452kg, 5000 → 1.742kg, 부피무게 미적용 → 1.2kg', () => {
    const tier = { weightMaxKg: 3, volumetricAppliesWhen: null };
    expect(chargeableWeightOf(BOX, { ...tier, volumetricDivisor: 6000 }).toFixed(3)).toBe('1.452');
    expect(chargeableWeightOf(BOX, { ...tier, volumetricDivisor: 5000 }).toFixed(3)).toBe('1.742');
    expect(chargeableWeightOf(BOX, { ...tier, volumetricDivisor: null }).toFixed(3)).toBe('1.200');
    expect(
      chargeableWeightOf(BOX, {
        weightMaxKg: 3,
        volumetricDivisor: 6000,
        volumetricAppliesWhen: 'NEVER',
      }).toFixed(3),
    ).toBe('1.200');
  });

  it('구간은 상한 ≥ 청구무게인 가장 작은 것(줄 순서와 무관)', () => {
    const cost = forwarderCost(
      input({
        table: {
          id: 7,
          tiers: [
            {
              weightMaxKg: 2,
              fee: 18000,
              currency: 'KRW',
              volumetricDivisor: null,
              volumetricAppliesWhen: null,
            },
            {
              weightMaxKg: 1.2,
              fee: 15000,
              currency: 'KRW',
              volumetricDivisor: null,
              volumetricAppliesWhen: null,
            },
            {
              weightMaxKg: 1,
              fee: 12000,
              currency: 'KRW',
              volumetricDivisor: null,
              volumetricAppliesWhen: null,
            },
          ],
        },
      }),
    );
    expect(cost.tierWeightMaxKg).toBe(1.2);
    expect(cost.cShipIntlKrw).toBe(15000);
    expect(cost.cFwdKrw).toBe(15000);
    expect(cost.fwdAssumed).toBe(false);
    expect(cost.rateTableId).toBe(7);
  });

  it('엔화 요금은 원가 환율로 환산한다(¥2,000 × 8.76 = 17,520)', () => {
    const cost = forwarderCost(
      input({
        table: {
          id: 1,
          tiers: [
            {
              weightMaxKg: 1.5,
              fee: 2000,
              currency: 'JPY',
              volumetricDivisor: 6000,
              volumetricAppliesWhen: null,
            },
          ],
        },
      }),
    );
    expect(cost.cShipIntlKrw).toBe(17520);
    expect(cost.chargeableWeightKg!.toFixed(3)).toBe('1.452');
  });

  it('검수·포장비는 포함 설정이면 더하고, 끄면 더하지 않는다(Proposed 설정)', () => {
    const table = {
      id: 1,
      tiers: [
        {
          weightMaxKg: 2,
          fee: 15000,
          currency: 'KRW' as const,
          volumetricDivisor: null,
          volumetricAppliesWhen: null,
        },
      ],
    };
    expect(
      forwarderCost(input({ table, handling: { included: true, amountKrw: 2000 } })).cFwdKrw,
    ).toBe(17000);
    expect(
      forwarderCost(input({ table, handling: { included: false, amountKrw: 2000 } })).cFwdKrw,
    ).toBe(15000);
  });

  it('요금표 없음 → 15,000 가정값(요금표 id null, CIF 운임도 15,000 — Proposed)', () => {
    const cost = forwarderCost(input());
    expect(cost).toMatchObject({
      rateTableId: null,
      cFwdKrw: 15000,
      cShipIntlKrw: 15000,
      fwdAssumed: true,
      fallbackReason: 'NO_RATE_TABLE',
      chargeableWeightKg: null,
    });
  });

  it('가장 큰 구간을 넘는 무게 → 가정값(WEIGHT_OVER_MAX_TIER, Proposed)', () => {
    const cost = forwarderCost(
      input({
        table: {
          id: 3,
          tiers: [
            {
              weightMaxKg: 1,
              fee: 9000,
              currency: 'KRW',
              volumetricDivisor: null,
              volumetricAppliesWhen: null,
            },
          ],
        },
      }),
    );
    expect(cost.fwdAssumed).toBe(true);
    expect(cost.rateTableId).toBeNull();
    expect(cost.fallbackReason).toBe('WEIGHT_OVER_MAX_TIER');
    expect(cost.cFwdKrw).toBe(15000);
  });

  it('셀러라이프 쿠폰은 C_fwd에서 뺀다(0 밑으로는 내려가지 않는다)', () => {
    expect(forwarderCost(input({ couponKrw: 2000 }))).toMatchObject({
      cFwdKrw: 13000,
      fwdCouponKrw: 2000,
    });
    expect(forwarderCost(input({ couponKrw: 99999 }))).toMatchObject({
      cFwdKrw: 0,
      fwdCouponKrw: 15000,
    });
  });
});

describe('money(원 단위 반올림은 한 곳에서)', () => {
  it('roundWon은 half-up', () => {
    expect(roundWon('6072.99')).toBe(6073);
    expect(roundWon('3041.5')).toBe(3042);
    expect(roundWon('3041.49')).toBe(3041);
  });

  it('floor100·ceil100', () => {
    expect(floor100(dec(169000).mul('0.99'))).toBe(167300);
    expect(ceil100(153012)).toBe(153100);
    expect(ceil100(153100)).toBe(153100);
  });
});
