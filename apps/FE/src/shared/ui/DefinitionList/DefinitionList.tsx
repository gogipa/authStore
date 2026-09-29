import type { CSSProperties, Key, ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import styles from './DefinitionList.module.css';

export interface DefinitionItem {
  /** 없으면 순서(index)를 key로 쓴다. */
  key?: Key;
  term: ReactNode;
  detail: ReactNode;
}

export interface DefinitionListProps {
  items: readonly DefinitionItem[];
  /** 라벨 열 폭(px). 기본 76(AiEngine 보드 엔진 카드). */
  labelWidth?: number;
  className?: string;
}

/** 라벨-값 목록(04-3 DefinitionList): `<dl>` 2열 격자, 라벨 ink-muted. */
export function DefinitionList({ items, labelWidth = 76, className }: DefinitionListProps) {
  // 라벨 폭은 부품마다 달라서 CSS 변수 하나로 넘긴다(색·글자 토큰이 아니라 배치 값).
  const style = { '--dl-label-width': `${labelWidth}px` } as CSSProperties;
  return (
    <dl className={cx(styles.list, className)} style={style}>
      {items.map((item, index) => (
        <div key={item.key ?? index} className={styles.row}>
          <dt className={styles.term}>{item.term}</dt>
          <dd className={styles.detail}>{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
