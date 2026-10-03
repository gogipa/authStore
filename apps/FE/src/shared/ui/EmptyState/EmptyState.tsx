import type { ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  /** 무엇이 비었는지 한 문장(예: '진행 중인 후보가 없습니다.'). */
  title: ReactNode;
  /** 다음에 할 일 설명. */
  children?: ReactNode;
  /** 다음 행동 버튼(ButtonLink 등). 주 버튼은 화면에 하나만이라 보통 보조 버튼이다. */
  actions?: ReactNode;
  className?: string;
}

/**
 * 빈 상태 안내(D-29, 화면시안_명세 §8): 가운데 정렬 글 + 다음 행동 버튼. 표(DataTable `empty`) 칸 안이나 패널 안에 둔다.
 * 표 칸의 한 줄 규칙(nowrap)을 풀어 여러 줄로 보인다.
 */
export function EmptyState({ title, children, actions, className }: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, className)}>
      <p className={styles.title}>{title}</p>
      {children !== undefined ? <p className={styles.text}>{children}</p> : null}
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
