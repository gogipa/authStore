import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import styles from './Radio.module.css';

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** 단추 옆 글. `<label for>`로 묶어 글을 눌러도 골라진다. */
  label: ReactNode;
  /** 글 아래 작은 설명(캡션). */
  description?: ReactNode;
}

/**
 * 라디오(04-3 Radio): line-strong 테두리, accent 점, 16px. 같은 `name`끼리 하나만 고른다.
 * 묶음은 `role="radiogroup"`(+ aria-labelledby)이나 `<fieldset>`으로 감싼다.
 */
export function Radio({ label, description, id, className, ...rest }: RadioProps) {
  const autoId = useId();
  const inputId = id ?? `radio-${autoId}`;
  return (
    <span className={cx(styles.item, className)}>
      <input
        id={inputId}
        type="radio"
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
