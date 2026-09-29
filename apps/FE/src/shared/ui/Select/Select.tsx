import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cx } from '@/shared/lib/cx';
import { Field } from '../Field/Field';
import { fieldDescribedBy } from '../Field/fieldIds';
import { Icon } from '../Icon/Icon';
import styles from './Select.module.css';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /**
   * 칸 위 라벨(`<label for>`). 표·카드 격자처럼 라벨을 칸 밖에 따로 두면 비우고,
   * 그 `<label htmlFor={id}>`가 이 칸의 `id`를 가리키게 한다.
   */
  label?: ReactNode;
  /** 모델 ID처럼 코드 값 목록: mono 13px(AiEngine 보드). */
  mono?: boolean;
  error?: ReactNode;
  hint?: ReactNode;
  /** `<option>`들. */
  children: ReactNode;
}

/** 고르기 칸(04-3 Select, size md 36px). 펼침 화살표는 선 아이콘이다. */
export function Select({
  label,
  mono = false,
  error,
  hint,
  id,
  className,
  children,
  'aria-describedby': describedBy,
  ...rest
}: SelectProps) {
  const autoId = useId();
  const selectId = id ?? `select-${autoId}`;
  const invalid = Boolean(error);
  const control = (
    <div className={cx(styles.wrap, className)}>
      <select
        id={selectId}
        className={cx(styles.select, mono && styles.mono, invalid && styles.invalid)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={fieldDescribedBy(selectId, { hint, error }, describedBy)}
        {...rest}
      >
        {children}
      </select>
      <span className={styles.chevron}>
        <Icon name="chevron-down" size={16} />
      </span>
    </div>
  );
  if (label === undefined) return control;
  return (
    <Field id={selectId} label={label} hint={hint} error={error}>
      {control}
    </Field>
  );
}
