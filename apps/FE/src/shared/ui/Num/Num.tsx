import { cx } from '@/shared/lib/cx';
import { formatNum, type NumUnit, type NumValue } from './formatNum';
import styles from './Num.module.css';

/** right(기본): 표 칸 안 오른쪽 정렬 블록 · inline: 문장 안 숫자. */
export type NumAlign = 'right' | 'inline';

export interface NumProps {
  value: NumValue;
  unit: NumUnit;
  align?: NumAlign;
}

/** 표 숫자(공통부품 §J): mono 글꼴, tabular-nums, 표 안에서는 오른쪽 정렬. 값이 없으면 '—'. */
export function Num({ value, unit, align = 'right' }: NumProps) {
  return <span className={cx(styles.num, styles[align])}>{formatNum(value, unit)}</span>;
}
