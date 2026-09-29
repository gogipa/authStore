import { useId, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cx } from '@/shared/lib/cx';
import { Field } from '../Field/Field';
import { fieldDescribedBy } from '../Field/fieldIds';
import styles from './Textarea.module.css';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: ReactNode;
  /** 잠긴 칸: 읽기 전용 + 잠김 모양. */
  locked?: boolean;
  error?: ReactNode;
  hint?: ReactNode;
}

/** 여러 줄 입력(04-3 Textarea): 붙여넣기(키워드·태그), 카피 본문. 크기 조절 손잡이는 없다. */
export function Textarea({
  label,
  locked = false,
  error,
  hint,
  id,
  className,
  readOnly,
  rows = 3,
  'aria-describedby': describedBy,
  ...rest
}: TextareaProps) {
  const autoId = useId();
  const textareaId = id ?? `textarea-${autoId}`;
  const invalid = Boolean(error);
  return (
    <Field id={textareaId} label={label} hint={hint} error={error}>
      <textarea
        id={textareaId}
        rows={rows}
        className={cx(
          styles.textarea,
          (locked || rest.disabled) && styles.locked,
          invalid && styles.invalid,
          className,
        )}
        readOnly={locked || readOnly}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={fieldDescribedBy(textareaId, { hint, error }, describedBy)}
        {...rest}
      />
    </Field>
  );
}
