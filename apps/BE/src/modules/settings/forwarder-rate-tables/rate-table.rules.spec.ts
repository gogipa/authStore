import { rateTableInputValue, rateTableStepInput } from './rate-table-input.js';
import {
  chargeableWeightKg,
  findTierForBox,
  parseVolumetricAppliesWhen,
  volumetricConditionOf,
} from './rate-table.rules.js';

const SHOE_BOX = { lengthCm: 33, widthCm: 22, heightCm: 12, weightKg: 1.2 };

describe('부피무게 적용 조건(Proposed, ERD §7.1-13)', () => {
  it('비움·ALWAYS·NEVER·SUM_CM>n만 받고 정규화한다', () => {
    expect(parseVolumetricAppliesWhen('')).toEqual({ ok: true, value: null });
    expect(parseVolumetricAppliesWhen(' always ')).toEqual({ ok: true, value: 'ALWAYS' });
    expect(parseVolumetricAppliesWhen('sum_cm > 160')).toEqual({ ok: true, value: 'SUM_CM>160' });
    expect(parseVolumetricAppliesWhen('SUM_CM>0').ok).toBe(false);
    expect(parseVolumetricAppliesWhen('>5kg').ok).toBe(false);
    expect(volumetricConditionOf(null)).toEqual({ kind: 'ALWAYS' });
    expect(volumetricConditionOf('SUM_CM>160')).toEqual({ kind: 'SUM_CM_OVER', cm: 160 });
  });

  it('청구무게: 나눗수가 없으면 실무게, ALWAYS면 max(실무게, 부피무게), NEVER면 실무게', () => {
    const base = { weightMaxKg: 2, volumetricAppliesWhen: null };
    expect(chargeableWeightKg(SHOE_BOX, { ...base, volumetricDivisor: null })).toBe(1.2);
    expect(chargeableWeightKg(SHOE_BOX, { ...base, volumetricDivisor: 6000 })).toBeCloseTo(1.452);
    expect(
      chargeableWeightKg(SHOE_BOX, {
        ...base,
        volumetricDivisor: 6000,
        volumetricAppliesWhen: 'NEVER',
      }),
    ).toBe(1.2);
    // 세 변 합 67cm ≤ 160 → 부피무게를 보지 않는다
    expect(
      chargeableWeightKg(SHOE_BOX, {
        ...base,
        volumetricDivisor: 6000,
        volumetricAppliesWhen: 'SUM_CM>160',
      }),
    ).toBe(1.2);
    expect(
      chargeableWeightKg(SHOE_BOX, {
        ...base,
        volumetricDivisor: 6000,
        volumetricAppliesWhen: 'SUM_CM>60',
      }),
    ).toBeCloseTo(1.452);
  });

  it('신발 박스 1.2kg이 들어가는 구간: 무게 오름차순 첫 구간, 넘으면 null', () => {
    const tiers = [
      { weightMaxKg: 2, volumetricDivisor: 6000, volumetricAppliesWhen: 'SUM_CM>160', fee: 18000 },
      { weightMaxKg: 1.2, volumetricDivisor: null, volumetricAppliesWhen: null, fee: 15000 },
      { weightMaxKg: 1, volumetricDivisor: null, volumetricAppliesWhen: null, fee: 12000 },
    ];
    expect(findTierForBox(tiers, SHOE_BOX)?.fee).toBe(15000);
    // 1.2 구간에 나눗수 6000(ALWAYS)이 있으면 청구무게 1.452 → 다음 구간
    const volumetric = tiers.map((t) =>
      t.weightMaxKg === 1.2 ? { ...t, volumetricDivisor: 6000 } : t,
    );
    expect(findTierForBox(volumetric, SHOE_BOX)?.fee).toBe(18000);
    expect(findTierForBox(tiers, { ...SHOE_BOX, weightKg: 5 })).toBeNull();
  });
});

describe('③ 입력 forwarder.rateTable(P2-04 Proposed)', () => {
  it('값은 활성 버전 id(없으면 null), SETTINGS 시작 조건', () => {
    expect(rateTableInputValue(3)).toEqual({ rateTableId: 3 });
    expect(rateTableStepInput(null)).toEqual({
      inputKey: 'forwarder.rateTable',
      sourceType: 'SETTINGS',
      isStartCondition: true,
      required: false,
      value: { rateTableId: null },
    });
  });
});
