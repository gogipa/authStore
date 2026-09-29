import { cx } from '@/shared/lib/cx';
import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  value: number;
  /** 기본 100. 데이터랩 수집이면 페이지 수(예: 10). */
  max?: number;
  /** 필수: 무엇의 진행률인지(예: '수집 진행률'). */
  'aria-label': string;
  /** 화면 읽기 프로그램이 읽을 값 글(예: '10페이지 중 4페이지'). */
  valueText?: string;
}

/**
 * 진행률 막대(04-3 ProgressBar, Keywords 보드): `role="progressbar"`, 높이 6px.
 * 채움은 진행 중이면 running(accent), 다 차면 done 색이다.
 */
export function ProgressBar({ value, max = 100, valueText, ...aria }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), safeMax);
  const percent = (clamped / safeMax) * 100;
  const complete = clamped >= safeMax;
  return (
    <div
      role="progressbar"
      aria-label={aria['aria-label']}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      aria-valuetext={valueText}
      className={styles.track}
    >
      <div
        className={cx(styles.fill, complete && styles.complete)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
