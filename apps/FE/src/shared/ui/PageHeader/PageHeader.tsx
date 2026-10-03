import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { documentTitle } from '@/shared/lib/appName';
import { HelpButton, HelpPanel } from '../HelpToggle/HelpToggle';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** 제목 위 작은 경로(예: 설정 / AI 엔진). */
  breadcrumb?: ReactNode;
  /** 오른쪽 버튼 묶음. */
  actions?: ReactNode;
  /**
   * 이 화면 도움말 내용(D-29). 주면 제목 옆에 '?' 버튼이 붙고, 누르면 머리 아래에 도움말 판이 열린다.
   * 내용은 화면이 넘긴다(보통 `@/features/guide`의 `ScreenHelp`).
   */
  help?: ReactNode;
}

/**
 * 화면 머리(공통부품_마크업.md §B). 화면마다 하나만 둔다. 문서 제목도 함께 정한다.
 * 화면 ID(SCR-xx)는 설계 문서에만 쓰고 화면에는 그리지 않는다(D-27).
 */
export function PageHeader({ title, description, breadcrumb, actions, help }: PageHeaderProps) {
  const helpId = `page-help-${useId()}`;
  const [helpOpen, setHelpOpen] = useState(false);
  const helpButton = useRef<HTMLButtonElement>(null);
  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    helpButton.current?.focus();
  }, []);

  return (
    <>
      <header className={styles.header}>
        <title>{documentTitle(title)}</title>
        <div className={styles.text}>
          {breadcrumb ? <div className={styles.breadcrumb}>{breadcrumb}</div> : null}
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{title}</h1>
            {help !== undefined ? (
              <HelpButton
                ref={helpButton}
                expanded={helpOpen}
                controls={helpId}
                onToggle={() => setHelpOpen((open) => !open)}
              />
            ) : null}
          </div>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      {help !== undefined ? (
        <HelpPanel id={helpId} open={helpOpen} onClose={closeHelp}>
          {help}
        </HelpPanel>
      ) : null}
    </>
  );
}
