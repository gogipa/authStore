import type { ReactNode } from 'react';
import { documentTitle } from '@/shared/lib/appName';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** 제목 위 작은 경로(예: 설정 / AI 엔진). */
  breadcrumb?: ReactNode;
  /** 오른쪽 버튼 묶음. */
  actions?: ReactNode;
}

/**
 * 화면 머리(공통부품_마크업.md §B). 화면마다 하나만 둔다. 문서 제목도 함께 정한다.
 * 화면 ID(SCR-xx)는 설계 문서에만 쓰고 화면에는 그리지 않는다(D-27).
 */
export function PageHeader({ title, description, breadcrumb, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <title>{documentTitle(title)}</title>
      <div className={styles.text}>
        {breadcrumb ? <div className={styles.breadcrumb}>{breadcrumb}</div> : null}
        <h1 className={styles.title}>{title}</h1>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
