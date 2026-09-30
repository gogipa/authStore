import { isSecretFieldName } from '../../../common/secrets/secret-mask.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type { FxRawCostRate, FxRawCustomsRate } from '../../integrations/fx/fx-source.port.js';

/**
 * 환율 정규화·계산(순수 함수, P2-04 규칙 1·2·6·8, §8 '100엔 단위'·'숫자 파싱').
 * - `rate_value`는 고시 원값(예 876)이고 `unit`은 1 또는 100이다. **계산값은 늘 `perUnit()` 하나로 얻는다**
 *   (계산하는 곳마다 `/ unit`을 따로 쓰면 한 곳만 빠져도 100배 틀린다). ③ 판정(P2-05)도 이 함수를 쓴다.
 * - 숫자는 부동소수점이 아니라 `Prisma.Decimal`로 다룬다. 저장 열은 numeric(12,4).
 */

export type Decimal = Prisma.Decimal;
export const Decimal = Prisma.Decimal;
/** Decimal로 바꿀 수 있는 값 */
export type DecimalValue = string | number | Prisma.Decimal;

export const FX_RATE_KINDS = ['COST', 'CUSTOMS'] as const;
export type FxRateKind = (typeof FX_RATE_KINDS)[number];
export const FX_CURRENCIES = ['JPY', 'USD'] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];
export const FX_SOURCES = ['KEXIM', 'CUSTOMS_SERVICE', 'MANUAL'] as const;
export type FxSource = (typeof FX_SOURCES)[number];
export const FX_UNITS = [1, 100] as const;
export type FxUnit = (typeof FX_UNITS)[number];

/** 종류·통화 조합(최신값 응답 순서: COST/JPY → CUSTOMS/JPY → CUSTOMS/USD, 05-2 FxRateLatestSet) */
export const FX_SERIES = [
  { rateKind: 'COST', currency: 'JPY' },
  { rateKind: 'CUSTOMS', currency: 'JPY' },
  { rateKind: 'CUSTOMS', currency: 'USD' },
] as const satisfies readonly { rateKind: FxRateKind; currency: FxCurrency }[];
export type FxSeries = (typeof FX_SERIES)[number];
/** 종류·통화 키('COST/JPY' 등) */
export type FxSeriesKey = 'COST/JPY' | 'CUSTOMS/JPY' | 'CUSTOMS/USD';

export function fxSeriesKey(rateKind: string, currency: string): FxSeriesKey | null {
  const key = `${rateKind}/${currency}`;
  return key === 'COST/JPY' || key === 'CUSTOMS/JPY' || key === 'CUSTOMS/USD' ? key : null;
}

/** numeric(12,4): 정수부 8자리, 소수 4자리 */
export const FX_RATE_MAX_EXCLUSIVE = new Decimal('100000000');
export const FX_RATE_SCALE = 4;

/**
 * 환율 원문 → Decimal. 천 단위 쉼표·앞뒤 공백을 지운다(`1,358.72` → 1358.72). 0 이하·숫자 아님·numeric(12,4) 밖이면 null.
 * 소수 넷째 자리 밑은 반올림한다(half-up, 저장 열과 같다).
 */
export function parseRateNumber(text: string): Decimal | null {
  const cleaned = text.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = new Decimal(cleaned).toDecimalPlaces(FX_RATE_SCALE, Decimal.ROUND_HALF_UP);
  if (value.lte(0) || value.gte(FX_RATE_MAX_EXCLUSIVE)) return null;
  return value;
}

/**
 * 단위 판별(규칙 1·2): 통화 표기·화폐단위명에 '100'이 있으면(`JPY(100)`·`100엔`·`100 JPY`) 100, 아니면 1.
 * 달러는 늘 1이다(ck_fx_unit).
 */
export function unitOf(unitText: string | null | undefined, currency: FxCurrency): FxUnit {
  if (currency === 'USD') return 1;
  const text = (unitText ?? '').replace(/\s/g, '');
  return /(^|\D)100(\D|$)/.test(text) ? 100 : 1;
}

/** 계산용 환율 = rate_value / unit(원/엔·원/달러). ③ 판정도 이것만 쓴다 */
export function perUnit(rateValue: DecimalValue, unit: number): Decimal {
  if (unit !== 1 && unit !== 100) throw new Error('unit은 1 또는 100');
  return new Decimal(rateValue).div(unit);
}

/** JSON number로 줄 값(05-2 x-decision §7-4: rateValue는 JSON number) */
export function toJsonNumber(value: DecimalValue): number {
  return new Decimal(value).toNumber();
}

/** 화면 표기 `8.76원/엔` · `1,358.72원/달러`(경고 문구). 소수는 넷째 자리까지, 끝 0은 지운다 */
export function formatPerUnit(value: Decimal, currency: FxCurrency): string {
  const [int, frac] = value
    .toDecimalPlaces(FX_RATE_SCALE, Decimal.ROUND_HALF_UP)
    .toFixed()
    .split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${frac ? `${grouped}.${frac}` : grouped}원/${currency === 'JPY' ? '엔' : '달러'}`;
}

export interface NormalizedRate {
  currency: FxCurrency;
  rateValue: Decimal;
  unit: FxUnit;
}

/** 수출입은행 엔화 한 줄 → 원값·단위(규칙 1). 값이 숫자가 아니면 null */
export function normalizeCostRate(raw: FxRawCostRate): NormalizedRate | null {
  const rateValue = parseRateNumber(raw.dealBasR);
  if (!rateValue) return null;
  return { currency: 'JPY', rateValue, unit: unitOf(raw.currencyUnit, 'JPY') };
}

/** 관세청 한 통화 → 원값·단위(규칙 2). 엔은 화폐단위명이 100엔이면 100, 달러는 1 */
export function normalizeCustomsRate(raw: FxRawCustomsRate): NormalizedRate | null {
  const currency = raw.currency.toUpperCase();
  if (currency !== 'JPY' && currency !== 'USD') return null;
  const rateValue = parseRateNumber(raw.rate);
  if (!rateValue) return null;
  return { currency, rateValue, unit: unitOf(raw.unitName, currency) };
}

/** 원가·과세 차이 경고 한계(F-BS-43: ±20% 넘으면. 정확히 20%는 경고 없음) */
export const FX_DIVERGENCE_LIMIT = new Decimal('0.2');

export interface FxDivergence {
  /** FX_cJPY / FX_base − 1 */
  ratio: Decimal;
  /** 퍼센트(소수 둘째 자리 반올림, 예 20.09) */
  pct: Decimal;
  exceeds: boolean;
}

/** 규칙 6: |FX_cJPY / FX_base − 1| > 0.20 이면 경고 */
export function divergenceOf(
  costPerUnit: DecimalValue,
  customsJpyPerUnit: DecimalValue,
): FxDivergence {
  const base = new Decimal(costPerUnit);
  if (base.lte(0)) throw new Error('원가 환율은 0보다 커야 한다');
  const ratio = new Decimal(customsJpyPerUnit).div(base).minus(1);
  return {
    ratio,
    pct: ratio.times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    exceeds: ratio.abs().gt(FX_DIVERGENCE_LIMIT),
  };
}

/**
 * `raw_response`에 넣기 전에 비밀 키 이름(authkey·serviceKey 등)을 모든 깊이에서 뺀다(규칙 3, NFR-02).
 * DB CHECK(ck_fx_no_secret)는 최상위 키만 보므로 앱이 먼저 지운다.
 */
export function stripSecretKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecretKeys);
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (isSecretFieldName(key)) continue;
    out[key] = stripSecretKeys(v);
  }
  return out;
}

/**
 * ③ 판정 입력 이름(step_run_input.input_key, source_type SETTINGS — P2-04 Proposed). ③ 실행기(P2-05)는 판정에 쓴
 * 환율마다 이 이름으로 입력을 남기고(`fxStepInputs`), 새 최신 환율이 생기면 값 해시가 달라진 ③만 재실행 필요가 된다.
 */
export const FX_INPUT_KEYS = {
  'COST/JPY': 'fx.costJpy',
  'CUSTOMS/JPY': 'fx.customsJpy',
  'CUSTOMS/USD': 'fx.customsUsd',
} as const satisfies Record<FxSeriesKey, string>;

export function fxInputKey(rateKind: FxRateKind, currency: FxCurrency): string | null {
  const key = fxSeriesKey(rateKind, currency);
  return key ? FX_INPUT_KEYS[key] : null;
}

/**
 * 입력 값(해시할 값): 계산용 환율 한 칸. 같은 값이면 새 행이어도(수동 정정·같은 고시 재수집) 재실행 필요가 되지 않는다.
 * 어느 행을 썼는지는 판정 스냅샷의 환율 id 3개(price_judgement)가 남긴다.
 */
export function fxInputValue(rateValue: DecimalValue, unit: number): { perUnit: string } {
  return { perUnit: perUnit(rateValue, unit).toFixed() };
}
