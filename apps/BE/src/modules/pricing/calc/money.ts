import { Prisma } from '../../../generated/prisma/client.js';

/**
 * 금액·환율 계산 도우미(P2-05 규칙 7, §8 '소수·반올림'). 금액·환율은 `Prisma.Decimal`로 계산한다(float 금지).
 * **원 단위 반올림은 이 파일 한 곳에서만 한다**(`roundWon`, half-up). 반올림 위치를 바꾸면 PRD §8.3 예시(27,418원·
 * 16,259원)가 1원씩 틀어진다(Proposed — 항목마다 원 단위 반올림, ERD §7.1-17).
 */

export type Decimal = Prisma.Decimal;
export const Decimal = Prisma.Decimal;
/** Decimal로 바꿀 수 있는 값 */
export type Money = Decimal | number | string;

export function dec(value: Money): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

/** 원 단위 반올림(half-up: 0.5는 0에서 먼 쪽으로). 6,072.99 → 6,073 */
export function roundWon(value: Money): number {
  return dec(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** 단위(기본 100원) 내림. floor100(167,310) = 167,300 */
export function floorUnit(value: Money, unit = 100): number {
  return dec(value).div(unit).floor().mul(unit).toNumber();
}

/** 단위(기본 100원) 올림. ceil100(153,012) = 153,100 */
export function ceilUnit(value: Money, unit = 100): number {
  return dec(value).div(unit).ceil().mul(unit).toNumber();
}

export const floor100 = (value: Money): number => floorUnit(value, 100);
export const ceil100 = (value: Money): number => ceilUnit(value, 100);

/** 퍼센트 수(설정 표기, 2.5 = 2.5%) → 비율 Decimal(0.025) */
export function pctRate(pct: number): Decimal {
  return new Decimal(pct).div(100);
}

/** 소수 자리 반올림(half-up). 저장 열 numeric(10,2)·(7,4)·(6,3)에 맞춘다 */
export function roundTo(value: Money, places: number): Decimal {
  return dec(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
}
