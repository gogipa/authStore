import { useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { useControllableState } from '@/shared/lib/useControllableState';
import { tabId, tabPanelId } from './tabIds';
import styles from './Tabs.module.css';

export interface TabItem<V extends string = string> {
  value: V;
  label: ReactNode;
  /** 라벨 아래 줄(캡션 글 또는 칩). Settings 보드 '요금표 v2026-09'. */
  caption?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<V extends string = string> {
  items: readonly TabItem<V>[];
  /** 제어형 값. 새로 고침 뒤에도 남아야 하면 화면이 URL search params에서 읽어 넘긴다(03-2 §6.1). */
  value?: V;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  /** 탭 묶음 이름(예: '설정 항목'). */
  'aria-label': string;
  /** 탭·패널 id 앞부분. `TabPanel`에도 같은 값을 준다. */
  idPrefix: string;
  className?: string;
}

/**
 * 세로 탭(04-3 Tabs, Settings 보드): `role="tablist"` 안 `role="tab"` + `aria-selected`.
 * 방향키(↑↓·←→)·Home·End로 옮기면 바로 고른다(roving tabindex). 패널은 `TabPanel`로 따로 둔다.
 */
export function Tabs<V extends string = string>({
  items,
  value,
  defaultValue,
  onValueChange,
  idPrefix,
  className,
  'aria-label': ariaLabel,
}: TabsProps<V>) {
  const firstEnabled = items.find((item) => !item.disabled)?.value;
  const [selected, setSelected] = useControllableState<V | undefined>(
    value,
    defaultValue ?? firstEnabled,
    onValueChange as ((next: V | undefined) => void) | undefined,
  );
  const refs = useRef(new Map<V, HTMLButtonElement>());

  const enabled = items.filter((item) => !item.disabled);

  function select(next: V) {
    setSelected(next);
    refs.current.get(next)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: V) {
    const index = enabled.findIndex((item) => item.value === current);
    if (index < 0 || enabled.length === 0) return;
    let nextIndex: number | undefined;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (index + 1) % enabled.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + enabled.length) % enabled.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = enabled.length - 1;
    }
    const next = nextIndex === undefined ? undefined : enabled[nextIndex];
    if (!next) return;
    event.preventDefault();
    select(next.value);
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      className={cx(styles.tablist, className)}
    >
      {items.map((item) => {
        const isSelected = item.value === selected;
        return (
          <button
            key={item.value}
            ref={(node) => {
              if (node) refs.current.set(item.value, node);
              else refs.current.delete(item.value);
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, item.value)}
            aria-selected={isSelected}
            aria-controls={tabPanelId(idPrefix, item.value)}
            tabIndex={isSelected ? 0 : -1}
            disabled={item.disabled}
            className={cx(styles.tab, isSelected && styles.selected)}
            onClick={() => setSelected(item.value)}
            onKeyDown={(event) => onKeyDown(event, item.value)}
          >
            <span className={styles.label}>{item.label}</span>
            {item.caption !== undefined ? (
              <span className={styles.caption}>{item.caption}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps extends HTMLAttributes<HTMLElement> {
  idPrefix: string;
  value: string;
  children: ReactNode;
}

/** 고른 탭의 내용. 화면은 고른 탭의 패널 하나만 그린다. */
export function TabPanel({ idPrefix, value, children, ...rest }: TabPanelProps) {
  return (
    <section
      role="tabpanel"
      id={tabPanelId(idPrefix, value)}
      aria-labelledby={tabId(idPrefix, value)}
      {...rest}
    >
      {children}
    </section>
  );
}
