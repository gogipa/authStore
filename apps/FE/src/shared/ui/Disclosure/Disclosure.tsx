import { useId, type ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { useControllableState } from '@/shared/lib/useControllableState';
import { Icon } from '../Icon/Icon';
import styles from './Disclosure.module.css';

/** button(기본): 테두리 있는 32px 버튼(Approval 보드) · link: 글자만 있는 accent 버튼(Content 보드 고시 표). */
export type DisclosureLook = 'button' | 'link';

export interface DisclosureProps {
  /** 머리 줄 제목(예: '비용 분해'). */
  title: ReactNode;
  /** 제목 옆 부가 정보(캡션·칩). */
  meta?: ReactNode;
  /** 펼쳤을 때 보이는 내용. */
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  look?: DisclosureLook;
  className?: string;
}

/**
 * 펼치기·접기(04-3 Disclosure): 버튼에 `aria-expanded`·`aria-controls`.
 * 글은 '펼치기'↔'접기'로, 아이콘은 아래↔위 화살표로 바뀐다.
 */
export function Disclosure({
  title,
  meta,
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  look = 'button',
  className,
}: DisclosureProps) {
  const regionId = `disclosure-${useId()}`;
  const [expanded, setExpanded] = useControllableState(open, defaultOpen, onOpenChange);
  return (
    <div className={cx(styles.disclosure, className)}>
      <div className={styles.head}>
        <span className={styles.title}>{title}</span>
        {meta !== undefined ? <span className={styles.meta}>{meta}</span> : null}
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={regionId}
          className={cx(styles.toggle, styles[look])}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '접기' : '펼치기'}
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={look === 'link' ? 14 : 16} />
        </button>
      </div>
      <div id={regionId} hidden={!expanded} className={styles.content}>
        {children}
      </div>
    </div>
  );
}
