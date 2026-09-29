import { useId, type ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import styles from './Panel.module.css';

export interface PanelProps {
  /** 패널 제목(16px 600). 있으면 `<section aria-labelledby>`로 이름을 붙인다. */
  title?: ReactNode;
  /** 제목 옆 캡션(예: '97개 · 순위순'). */
  caption?: ReactNode;
  /** 머리 오른쪽 버튼 묶음 슬롯. */
  actions?: ReactNode;
  /** 제목이 없을 때의 이름. */
  'aria-label'?: string;
  className?: string;
  children: ReactNode;
}

/** 패널(화면시안_명세 §3): 흰 바탕, line 테두리, radius 8, 안쪽 16, 사이 12. */
export function Panel({
  title,
  caption,
  actions,
  className,
  children,
  'aria-label': ariaLabel,
}: PanelProps) {
  const titleId = `panel-title-${useId()}`;
  const hasHead = title !== undefined || actions !== undefined || caption !== undefined;
  return (
    <section
      className={cx(styles.panel, className)}
      aria-labelledby={title !== undefined ? titleId : undefined}
      aria-label={title === undefined ? ariaLabel : undefined}
    >
      {hasHead ? (
        <div className={styles.head}>
          <div className={styles.titleRow}>
            {title !== undefined ? (
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
            ) : null}
            {caption !== undefined ? <span className={styles.caption}>{caption}</span> : null}
          </div>
          {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
