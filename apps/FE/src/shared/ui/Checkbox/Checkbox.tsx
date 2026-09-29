import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import styles from './Checkbox.module.css';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** 상자 옆 글. `<label for>`로 묶어 글을 눌러도 체크된다. */
  label: ReactNode;
  /** 글 아래 작은 설명(캡션). */
  description?: ReactNode;
}

/** 체크 상자(04-3 Checkbox): line-strong 테두리, accent 체크, 16px. */
export function Checkbox({ label, description, id, className, ...rest }: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? `checkbox-${autoId}`;
  return (
    <span className={cx(styles.item, className)}>
      <input
        id={inputId}
        type="checkbox"
        className={styles.control}
        aria-describedby={description ? `${inputId}-desc` : undefined}
        {...rest}
      />
      <span className={styles.text}>
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
        {description ? (
          <span id={`${inputId}-desc`} className={styles.description}>
            {description}
          </span>
        ) : null}
      </span>
    </span>
  );
}
