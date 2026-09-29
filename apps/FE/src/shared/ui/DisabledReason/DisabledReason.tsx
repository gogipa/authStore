import type { ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import styles from './DisabledReason.module.css';

/** waiting(기본): 조치가 필요한 이유(#9A5B00) · muted: 단순 안내(ink-muted). 공통부품 §I. */
export type DisabledReasonTone = 'waiting' | 'muted';

export interface DisabledReasonProps {
  /** 꺼진 버튼의 `aria-describedby`가 가리킬 id. */
  id?: string;
  tone?: DisabledReasonTone;
  children: ReactNode;
  className?: string;
}

/**
 * 꺼진 버튼 옆·아래의 이유 글(04-3 DisabledReason, 화면시안_명세 §3 "꺼진 버튼 옆에는 꺼진 이유를 보이는 글로").
 * 버튼에는 `disabled`와 `aria-describedby={id}`를 함께 준다.
 */
export function DisabledReason({ id, tone = 'waiting', children, className }: DisabledReasonProps) {
  return (
    <span id={id} className={cx(styles.reason, styles[tone], className)}>
      {children}
    </span>
  );
}
