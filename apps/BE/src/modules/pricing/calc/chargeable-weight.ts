import {
  chargeableWeightKg,
  findTierForBox,
  type BoxSize,
} from '../../settings/forwarder-rate-tables/rate-table.rules.js';
import { dec, roundTo, roundWon, type Decimal } from './money.js';

/**
 * 배대지 비용(P2-05 규칙 6, F-PJ-06·07, US-09 AC4). 순수 함수.
 * - 청구무게 = 요금표 구간 규칙(settings `rate-table.rules.ts` — 부피무게 = 세 변 곱 / 나눗수, 적용 조건은 요금표 열)으로
 *   max(실무게, 부피무게). 구간 = `weight_max_kg ≥ 청구무게`인 가장 작은 구간(`findTierForBox`)
 * - 국제운임 C_ship_intl = 구간 요금(엔이면 원가 환율 `FX_base`로 원 환산, 원 단위 반올림)
 * - 검수·포장비(Proposed 설정 `pricing.forwarderHandlingFee{ included, amountKrw }`, 기본 포함·0원 — 요금표 운임에
 *   검수·포장이 빠진 배대지면 오너가 금액을 넣는다): 포함이면 더한다
 * - 셀러라이프 배대지 쿠폰(F-ST-05): 부르는 쪽이 적용할 금액을 주면 C_fwd에서 뺀다(0 밑으로 내려가지 않는다)
 * - 활성 요금표가 없으면 C_fwd = 기본 배대지비(15,000원) + '가정값'(fwd_assumed, 요금표 id NULL — ck_pj_fwd_assumed).
 *   이때 과세 CIF에 쓰는 C_ship_intl도 같은 기본값으로 본다(Proposed — 보수적, 배대지비 전부를 운임으로 친다)
 * - 가장 큰 구간을 넘는 청구무게(Proposed): 요금표로 값을 정할 수 없어 요금표가 없을 때와 같은 가정값으로 계산하고
 *   `fallbackReason = WEIGHT_OVER_MAX_TIER`를 남긴다(판정 스냅샷 params). 요금표 id는 NULL이 된다(ck_pj_fwd_assumed)
 */

export interface RateTierInput {
  weightMaxKg: number;
  fee: number;
  currency: 'JPY' | 'KRW';
  volumetricDivisor: number | null;
  volumetricAppliesWhen: string | null;
}

export interface RateTableInput {
  id: number;
  tiers: readonly RateTierInput[];
}

export interface ForwarderCostInput {
  table: RateTableInput | null;
  box: BoxSize;
  /** 원가 환율 FX_base(원/엔) — 엔화 요금 환산 */
  fxCostPerUnit: Decimal;
  defaultFeeKrw: number;
  handling: { included: boolean; amountKrw: number };
  /** 적용할 셀러라이프 배대지 쿠폰 금액(원, 0 = 적용 안 함) */
  couponKrw: number;
}

export type ForwarderFallbackReason = 'NO_RATE_TABLE' | 'WEIGHT_OVER_MAX_TIER';

export interface ForwarderCost {
  /** 판정에 쓴 요금표(가정값이면 null) */
  rateTableId: number | null;
  /** 청구무게(kg, 소수 셋째 자리). 가정값이면 null */
  chargeableWeightKg: Decimal | null;
  /** 고른 구간의 상한 무게(kg). 가정값이면 null */
  tierWeightMaxKg: number | null;
  /** 국제운임 C_ship_intl(원) — 과세 CIF에도 쓴다 */
  cShipIntlKrw: number;
  /** 더한 검수·포장비(원) */
  handlingFeeKrw: number;
  /** C_fwd에서 뺀 셀러라이프 쿠폰(원) */
  fwdCouponKrw: number;
  /** 배대지 비용 C_fwd(원, 쿠폰 차감 뒤) */
  cFwdKrw: number;
  fwdAssumed: boolean;
  fallbackReason: ForwarderFallbackReason | null;
}

function assumed(input: ForwarderCostInput, reason: ForwarderFallbackReason): ForwarderCost {
  const coupon = Math.min(Math.max(0, input.couponKrw), input.defaultFeeKrw);
  return {
    rateTableId: null,
    chargeableWeightKg: null,
    tierWeightMaxKg: null,
    cShipIntlKrw: input.defaultFeeKrw,
    handlingFeeKrw: 0,
    fwdCouponKrw: coupon,
    cFwdKrw: input.defaultFeeKrw - coupon,
    fwdAssumed: true,
    fallbackReason: reason,
  };
}

/** 청구무게(kg, 소수 셋째 자리 half-up) — 표시·저장용(numeric(6,3)) */
export function chargeableWeightOf(
  box: BoxSize,
  tier: Pick<RateTierInput, 'weightMaxKg' | 'volumetricDivisor' | 'volumetricAppliesWhen'>,
): Decimal {
  return roundTo(chargeableWeightKg(box, tier), 3);
}

export function forwarderCost(input: ForwarderCostInput): ForwarderCost {
  if (!input.table) return assumed(input, 'NO_RATE_TABLE');
  const tier = findTierForBox(input.table.tiers, input.box);
  if (!tier) return assumed(input, 'WEIGHT_OVER_MAX_TIER');
  const shipping =
    tier.currency === 'JPY' ? roundWon(dec(tier.fee).mul(input.fxCostPerUnit)) : tier.fee;
  const handling = input.handling.included ? input.handling.amountKrw : 0;
  const gross = shipping + handling;
  const coupon = Math.min(Math.max(0, input.couponKrw), gross);
  return {
    rateTableId: input.table.id,
    chargeableWeightKg: chargeableWeightOf(input.box, tier),
    tierWeightMaxKg: tier.weightMaxKg,
    cShipIntlKrw: shipping,
    handlingFeeKrw: handling,
    fwdCouponKrw: coupon,
    cFwdKrw: gross - coupon,
    fwdAssumed: false,
    fallbackReason: null,
  };
}
