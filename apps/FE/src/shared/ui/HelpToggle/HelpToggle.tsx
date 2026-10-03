import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import { cx } from '@/shared/lib/cx';
import { Icon } from '../Icon/Icon';
import { IconButton } from '../IconButton/IconButton';
import styles from './HelpToggle.module.css';

export interface HelpButtonProps {
  /** 도움말이 열려 있는가(`aria-expanded`). */
  expanded: boolean;
  /** 여닫는 도움말 판의 id(`aria-controls`). */
  controls: string;
  onToggle: () => void;
  /** 화면 읽기 이름이자 마우스를 올리면 보이는 글. */
  label?: string;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * 화면 제목 옆 '?' 도움말 버튼(D-29, 화면시안_명세 §8). 28px 아이콘 버튼 + `aria-expanded`·`aria-controls`.
 * 진짜 `<button>`이라 Enter·Space로 여닫는다. 열려 있으면 accent 바탕으로 눌린 모양을 보인다.
 */
export function HelpButton({
  expanded,
  controls,
  onToggle,
  label = '이 화면 도움말',
  ref,
}: HelpButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(styles.button, expanded && styles.expanded)}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <Icon name="help" size={20} />
    </button>
  );
}

export interface HelpPanelProps {
  /** `HelpButton`의 `controls`와 같은 id. */
  id: string;
  open: boolean;
  /** 닫기 버튼·Esc. 부르는 쪽이 초점을 '?' 버튼으로 돌린다. */
  onClose: () => void;
  title?: string;
  closeLabel?: string;
  children: ReactNode;
}

/**
 * '?'로 여는 도움말 판(D-29). 닫혀 있어도 DOM에 두고 `hidden`으로 숨긴다(`aria-controls` 대상이 늘 있다).
 * 판 안에서 Esc를 누르면 닫힌다. 모양은 패널(흰 바탕·line 테두리·radius 8·안쪽 16)과 같다.
 */
export function HelpPanel({
  id,
  open,
  onClose,
  title = '이 화면 도움말',
  closeLabel = '도움말 닫기',
  children,
}: HelpPanelProps) {
  const ref = useRef<HTMLElement>(null);
  const titleId = `${id}-title`;

  useEffect(() => {
    const node = ref.current;
    if (!node || !open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <section ref={ref} id={id} hidden={!open} aria-labelledby={titleId} className={styles.panel}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          <Icon name="help" size={16} />
          {title}
        </h2>
        <IconButton icon="close" aria-label={closeLabel} onClick={onClose} />
      </div>
      {children}
    </section>
  );
}
