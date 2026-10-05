import type { ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { formatCount } from '@/shared/lib/format';
import { useControllableState } from '@/shared/lib/useControllableState';
import styles from './FilterToggleGroup.module.css';

export interface FilterToggleItem<V extends string = string> {
  value: V;
  label: ReactNode;
  /** 라벨 뒤 개수(mono). 예: '전체 97'. */
  count?: number;
}

/**
 * 모양(보드마다 다르다, Proposed 04-3):
 * - chips(기본): 떨어진 32px 버튼(Keywords '목록 거르기'·Tags '최종 10').
 * - segmented: 붙은 36px 버튼 묶음(Keywords '분야'·'수집 범위').
 * - soft: 회색 바탕 안 알약(CandidateWork '여정 거르기'·Products 상태 필터).
 */
export type FilterToggleLook = 'chips' | 'segmented' | 'soft';

interface FilterToggleGroupBaseProps<V extends string> {
  items: readonly FilterToggleItem<V>[];
  /** 제어형 값. 새로 고침 뒤에도 남기려면 화면이 URL search params에서 읽어 넘긴다(03-2 §6.1). */
  value?: V;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  look?: FilterToggleLook;
  className?: string;
}

/** 묶음 이름은 `aria-label` 또는 보이는 라벨의 `aria-labelledby`로 반드시 준다. */
export type FilterToggleGroupProps<V extends string = string> = FilterToggleGroupBaseProps<V> &
  (
    | { 'aria-label': string; 'aria-labelledby'?: never }
    | { 'aria-label'?: never; 'aria-labelledby': string }
  );

/** 하나만 고르는 거르기 버튼 묶음(04-3 FilterToggleGroup): `role="group"` 안 버튼마다 `aria-pressed`. */
export function FilterToggleGroup<V extends string = string>({
  items,
  value,
  defaultValue,
  onValueChange,
  look = 'chips',
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: FilterToggleGroupProps<V>) {
  const [selected, setSelected] = useControllableState<V | undefined>(
    value,
    defaultValue ?? items[0]?.value,
    onValueChange as ((next: V | undefined) => void) | undefined,
  );
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cx(styles.group, styles[look], className)}
    >
      {items.map((item) => {
        const pressed = item.value === selected;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={pressed}
            className={cx(styles.toggle, pressed && styles.pressed)}
            onClick={() => setSelected(item.value)}
          >
            {item.label}
            {item.count !== undefined ? (
              <>
                {' '}
                <span className={styles.count}>{formatCount(item.count)}</span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
