import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** 화면 ID(예: SCR-13). 제목 옆 ID 칩으로 보인다. */
  screenId?: string;
  /** 제목 위 작은 경로(예: 설정 / AI 엔진). */
  breadcrumb?: ReactNode;
  /** 오른쪽 버튼 묶음. */
  actions?: ReactNode;
}

/** 화면 머리(공통부품_마크업.md §B). 화면마다 하나만 둔다. 문서 제목도 함께 정한다. */
export function PageHeader({ title, description, screenId, breadcrumb, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <title>{`${title} · 신발 자동등록`}</title>
      <div className={styles.text}>
        {breadcrumb ? <div className={styles.breadcrumb}>{breadcrumb}</div> : null}
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {screenId ? <span className={styles.screenId}>{screenId}</span> : null}
        </div>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
