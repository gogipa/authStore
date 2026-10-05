import type { ReadinessItemView } from '../../model/readiness';
import { ReadinessStateChip } from '../ReadinessStateChip/ReadinessStateChip';
import styles from './ReadinessRows.module.css';

export interface ReadinessRowsProps {
  items: readonly ReadinessItemView[];
  /** 목록 이름(화면 읽기 프로그램) */
  label: string;
}

/** 시작 준비 항목 줄(칩 + 이름 + 글). 설정 마법사의 '지금 상태'가 쓴다. 고칠 곳은 단계의 버튼이 맡아 링크는 두지 않는다 */
export function ReadinessRows({ items, label }: ReadinessRowsProps) {
  return (
    <ul className={styles.rows} aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className={styles.row} data-item={item.key} data-state={item.state}>
          <ReadinessStateChip state={item.state} />
          <span className={styles.label}>{item.label}</span>
          <span className={styles.text}>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}
