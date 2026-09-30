import type { components } from '@/shared/api/schema';
import { EMPTY_VALUE, formatKrw, formatYen, KST_TIME_ZONE } from '@/shared/lib/format';

export type ForwarderRateTableSummary = components['schemas']['ForwarderRateTableSummary'];
export type ForwarderRateTableDetail = components['schemas']['ForwarderRateTableDetail'];
export type ForwarderRateTier = components['schemas']['ForwarderRateTier'];
export type ForwarderRateTableImportResult =
  components['schemas']['ForwarderRateTableImportResult'];

/** 설정 화면 CSV 안내(Settings 보드 그대로) */
export const RATE_TABLE_CSV_HINT =
  'CSV 열: 무게 상한 · 요금 · 통화(엔/원) · 부피무게 나눗수 · 적용 조건';

/** 업로드 상한(05-2 importForwarderRateTable, 5MB) */
export const RATE_TABLE_MAX_BYTES = 5 * 1024 * 1024;

const kstYearMonth = new Intl.DateTimeFormat('en-CA', {
  timeZone: KST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
});

/**
 * 버전 표기 'v2026-09'(Settings 보드). API에 버전 이름 칸이 없어 가져온 달(KST)로 만든다(Proposed — 열린질문 P2-04).
 * 같은 달에 여러 번 가져오면 이름이 겹치므로 표에서는 id를 함께 보인다.
 */
export function rateTableVersionLabel(
  table: Pick<ForwarderRateTableSummary, 'importedAt'>,
): string {
  const date = new Date(table.importedAt);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return `v${kstYearMonth.format(date)}`;
}

/** 요금 표기: 원 '15,000원' · 엔 '¥1,500'(엔화는 판정 때 원가 환율로 바꾼다) */
export function formatTierFee(fee: number, currency: ForwarderRateTier['currency']): string {
  return currency === 'JPY' ? formatYen(fee) : formatKrw(fee);
}

const kgFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 });

export function formatWeightKg(kg: number): string {
  return `${kgFormat.format(kg)}kg`;
}

/** 적용 조건 표기(Proposed 형식: 비움·ALWAYS·NEVER·SUM_CM>n) */
export function appliesWhenLabel(
  tier: Pick<ForwarderRateTier, 'volumetricDivisor' | 'volumetricAppliesWhen'>,
): string {
  if (tier.volumetricDivisor === null) return '부피무게 안 봄';
  const value = tier.volumetricAppliesWhen;
  if (value === null || value === 'ALWAYS') return '늘 비교';
  if (value === 'NEVER') return '부피무게 안 봄';
  const m = /^SUM_CM>(\d+)$/.exec(value);
  return m ? `세 변 합 ${m[1]}cm 초과일 때` : value;
}

export interface ShoeBox {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
}

/** 설정 `pricing.shoeBox` 기본값(33×22×12cm · 1.2kg, P1-03) */
export const DEFAULT_SHOE_BOX: ShoeBox = { lengthCm: 33, widthCm: 22, heightCm: 12, weightKg: 1.2 };

/** 이 구간 기준 청구무게(kg) — BE `settings/forwarder-rate-tables/rate-table.rules.ts` `chargeableWeightKg`와 같은 규칙 */
function chargeableWeightKg(box: ShoeBox, tier: ForwarderRateTier): number {
  const divisor = tier.volumetricDivisor;
  if (divisor === null || divisor <= 0) return box.weightKg;
  const value = tier.volumetricAppliesWhen;
  if (value === 'NEVER') return box.weightKg;
  const m = value ? /^SUM_CM>(\d+)$/.exec(value) : null;
  if (m && box.lengthCm + box.widthCm + box.heightCm <= Number(m[1])) return box.weightKg;
  return Math.max(box.weightKg, (box.lengthCm * box.widthCm * box.heightCm) / divisor);
}

/**
 * 신발 박스가 들어가는 구간(설정 요약 '신발 박스 1.2kg 15,000원'). 무게 오름차순으로 보며 그 구간 기준 청구무게 이하인 첫 구간.
 * 표시용이다 — 판정의 배대지 비용은 ③(P2-05)이 BE에서 같은 규칙으로 계산한다.
 */
export function shoeBoxTier(
  tiers: readonly ForwarderRateTier[],
  box: ShoeBox,
): ForwarderRateTier | null {
  const sorted = [...tiers].sort((a, b) => a.weightMaxKg - b.weightMaxKg);
  return sorted.find((tier) => tier.weightMaxKg >= chargeableWeightKg(box, tier)) ?? null;
}

/** 설정 파일 content에서 신발 박스(pricing.shoeBox). 없거나 모양이 틀리면 기본값 */
export function readShoeBox(content: unknown): ShoeBox {
  const box = (content as { pricing?: { shoeBox?: Partial<ShoeBox> } } | undefined)?.pricing
    ?.shoeBox;
  const n = (v: unknown, d: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d;
  return {
    lengthCm: n(box?.lengthCm, DEFAULT_SHOE_BOX.lengthCm),
    widthCm: n(box?.widthCm, DEFAULT_SHOE_BOX.widthCm),
    heightCm: n(box?.heightCm, DEFAULT_SHOE_BOX.heightCm),
    weightKg: n(box?.weightKg, DEFAULT_SHOE_BOX.weightKg),
  };
}

/** 요금표가 없을 때 판정 기본값(설정 pricing.defaultForwarderFeeKrw, 없으면 15,000원 — F-PJ-07) */
export function readDefaultForwarderFeeKrw(content: unknown): number {
  const v = (content as { pricing?: { defaultForwarderFeeKrw?: unknown } } | undefined)?.pricing
    ?.defaultForwarderFeeKrw;
  return typeof v === 'number' && Number.isFinite(v) ? v : 15_000;
}

/** 요금표 탭 캡션(보드 '요금표 v2026-09'). 활성이 없으면 '요금표 없음 · 기본값' */
export function rateTableTabCaption(active: ForwarderRateTableSummary | null | undefined): string {
  return active ? `요금표 ${rateTableVersionLabel(active)}` : '요금표 없음 · 기본값';
}

/** 가져오기 결과 한 줄 */
export function importResultText(result: ForwarderRateTableImportResult): string {
  const head = result.reused
    ? `같은 파일이라 기존 버전(#${result.rateTable.id})을 다시 켰습니다`
    : `새 버전(#${result.rateTable.id} · 구간 ${result.rateTable.rowCount}개)을 가져와 켰습니다`;
  return result.rerunRequiredStepCount > 0
    ? `${head} · 판정 ${result.rerunRequiredStepCount}건이 재실행 필요가 됐습니다`
    : head;
}
