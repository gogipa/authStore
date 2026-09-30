/**
 * 요금표 구간 규칙(순수 함수, P2-04 — ③ 판정 P2-05가 청구무게로 구간을 찾을 때 그대로 쓴다).
 *
 * `volumetric_applies_when` 형식(Proposed, ERD §7.1-13): 비움 또는 아래 셋 중 하나(대소문자·공백 무시, 저장은 정규화 글자).
 * - `ALWAYS`(비움과 같다, 나눗수가 있을 때): 청구무게 = max(실무게, 부피무게)
 * - `NEVER`: 부피무게를 보지 않는다(청구무게 = 실무게)
 * - `SUM_CM>{n}`: 박스 세 변의 합이 n cm를 넘을 때만 부피무게와 비교한다(n은 1~999 정수)
 * 부피무게(kg) = 가로 × 세로 × 높이(cm) / 나눗수(예 5000·6000). 나눗수가 없는 구간은 실무게만 본다.
 */

export type VolumetricCondition =
  { kind: 'ALWAYS' } | { kind: 'NEVER' } | { kind: 'SUM_CM_OVER'; cm: number };

const SUM_RE = /^SUM_CM>(\d{1,3})$/;

export const VOLUMETRIC_APPLIES_WHEN_HINT =
  '비우거나 ALWAYS · NEVER · SUM_CM>숫자(세 변 합 cm) 중 하나여야 합니다.';

/** 칸 글자 → 정규화한 저장 글자(비우면 null). 형식이 틀리면 오류 문구 */
export function parseVolumetricAppliesWhen(
  raw: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  const text = raw.replace(/\s/g, '').toUpperCase();
  if (text === '') return { ok: true, value: null };
  if (text === 'ALWAYS' || text === 'NEVER') return { ok: true, value: text };
  const m = SUM_RE.exec(text);
  if (m && Number(m[1]) >= 1) return { ok: true, value: `SUM_CM>${Number(m[1])}` };
  return { ok: false, message: VOLUMETRIC_APPLIES_WHEN_HINT };
}

/** 저장 글자 → 조건(null·모르는 값 = ALWAYS) */
export function volumetricConditionOf(value: string | null): VolumetricCondition {
  if (value === 'NEVER') return { kind: 'NEVER' };
  const m = value ? SUM_RE.exec(value) : null;
  if (m) return { kind: 'SUM_CM_OVER', cm: Number(m[1]) };
  return { kind: 'ALWAYS' };
}

export interface BoxSize {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
}

export interface RateTierLike {
  /** 구간 상한 무게(kg) */
  weightMaxKg: number;
  volumetricDivisor: number | null;
  volumetricAppliesWhen: string | null;
}

/** 부피무게(kg) = 세 변 곱 / 나눗수 */
export function volumetricWeightKg(box: BoxSize, divisor: number): number {
  return (box.lengthCm * box.widthCm * box.heightCm) / divisor;
}

/** 이 구간 기준 청구무게(kg) */
export function chargeableWeightKg(box: BoxSize, tier: RateTierLike): number {
  if (tier.volumetricDivisor === null || tier.volumetricDivisor <= 0) return box.weightKg;
  const condition = volumetricConditionOf(tier.volumetricAppliesWhen);
  if (condition.kind === 'NEVER') return box.weightKg;
  if (
    condition.kind === 'SUM_CM_OVER' &&
    box.lengthCm + box.widthCm + box.heightCm <= condition.cm
  ) {
    return box.weightKg;
  }
  return Math.max(box.weightKg, volumetricWeightKg(box, tier.volumetricDivisor));
}

/**
 * 박스가 들어가는 구간: 무게 오름차순으로 보며 `weightMaxKg ≥ 그 구간 기준 청구무게`인 첫 구간. 없으면 null
 * (가장 큰 구간을 넘는 무게 — 처리는 P2-05가 정한다).
 */
export function findTierForBox<T extends RateTierLike>(
  tiers: readonly T[],
  box: BoxSize,
): T | null {
  const sorted = [...tiers].sort((a, b) => a.weightMaxKg - b.weightMaxKg);
  return sorted.find((tier) => tier.weightMaxKg >= chargeableWeightKg(box, tier)) ?? null;
}
