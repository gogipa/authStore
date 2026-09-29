import { cx } from '@/shared/lib/cx';
import type { FractionDigits } from '@/shared/lib/format';
import { formatNum, type NumUnit, type NumValue } from './formatNum';
import styles from './Num.module.css';

/** right(기본): 표 칸 안 오른쪽 정렬 블록 · inline: 문장 안 숫자. */
export type NumAlign = 'right' | 'inline';

export interface NumProps {
  value: NumValue;
  unit: NumUnit;
  align?: NumAlign;
  /** pct의 소수 자리(예 요율 `{ minFractionDigits: 1, maxFractionDigits: 2 }` → `3.0%`·`3.63%`). */
  digits?: FractionDigits;
}

/** 표 숫자(공통부품 §J): mono 글꼴, tabular-nums, 표 안에서는 오른쪽 정렬. 값이 없으면 '—'. */
export function Num({ value, unit, align = 'right', digits }: NumProps) {
  return <span className={cx(styles.num, styles[align])}>{formatNum(value, unit, digits)}</span>;
}
