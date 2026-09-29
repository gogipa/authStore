import type { ReactNode } from 'react';
import { PageHeader } from '../PageHeader/PageHeader';
import styles from './ScreenPlaceholder.module.css';

export interface ScreenPlaceholderProps {
  screenId: string;
  title: string;
  description: string;
  /** 따라 그릴 시안 파일(docs/design/screens/). */
  design?: string;
  breadcrumb?: ReactNode;
  children?: ReactNode;
}

/** 스캐폴딩 단계의 화면 자리표시자: 화면 머리 + "아직 만들지 않음" 패널. */
export function ScreenPlaceholder({
  screenId,
  title,
  description,
  design,
  breadcrumb,
  children,
}: ScreenPlaceholderProps) {
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        screenId={screenId}
        breadcrumb={breadcrumb}
      />
      <section className={styles.panel} aria-label="준비 중">
        <p className={styles.lead}>이 화면은 아직 만들지 않았습니다.</p>
        {design ? (
          <p className={styles.caption}>
            시안: <code>docs/design/screens/{design}</code>
          </p>
        ) : null}
        {children}
      </section>
    </>
  );
}
