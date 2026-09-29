import { useId, type ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { useControllableState } from '@/shared/lib/useControllableState';
import styles from './Switch.module.css';

interface SwitchBaseProps {
  /** 제어형 값. 주지 않으면 `defaultChecked`로 시작해 안에서 기억한다. */
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  /** 스위치 옆 상태 글('켜짐'·'꺼짐'). 색만으로 상태를 알리지 않게 기본으로 보인다. */
  showState?: boolean;
  /** 도움말·꺼진 이유 글의 id. */
  'aria-describedby'?: string;
  className?: string;
}

/** 이름은 셋 중 하나로 반드시 준다: 보이는 `label`, `aria-label`, `aria-labelledby`. */
type SwitchNameProps =
  | { label: ReactNode; 'aria-label'?: never; 'aria-labelledby'?: never }
  | { label?: never; 'aria-label': string; 'aria-labelledby'?: never }
  | { label?: never; 'aria-label'?: never; 'aria-labelledby': string };

export type SwitchProps = SwitchBaseProps & SwitchNameProps;

/**
 * 켜고 끄는 스위치(04-3 Switch, Settings·System 보드): `<button role="switch" aria-checked>`.
 * 누르기·Space·Enter로 바뀐다(버튼 기본 동작). 등록 API 차단 스위치(P4-03)도 이 부품을 쓴다.
 */
export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  id,
  showState = true,
  className,
  label,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: SwitchProps) {
  const autoId = useId();
  const labelId = `switch-label-${autoId}`;
  const [on, setOn] = useControllableState(checked, defaultChecked, onCheckedChange);
  return (
    <span className={cx(styles.wrap, className)}>
      {label !== undefined ? (
        <span id={labelId} className={styles.label}>
          {label}
        </span>
      ) : null}
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={on}
        aria-label={ariaLabel}
        aria-labelledby={label !== undefined ? labelId : ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        className={cx(styles.track, on && styles.on)}
        onClick={() => setOn(!on)}
      >
        <span className={styles.knob} />
      </button>
      {showState ? (
        <span className={styles.state} aria-hidden="true">
          {on ? '켜짐' : '꺼짐'}
        </span>
      ) : null}
    </span>
  );
}
