import type { ReactNode } from 'react';
import styles from './Field.module.css';

export interface FieldProps {
  /** 칸(input·select·textarea)의 id. `<label for>`가 이 id를 가리킨다. */
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}

/**
 * 입력칸 틀(화면시안_명세 §3 입력칸): 라벨(12px 600 ink-muted)이 위, 칸, 아래 도움말·오류 글.
 * shared/ui 안에서만 쓴다(TextField·Textarea·Select). 밖으로 내지 않는다.
 */
export function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children}
      {error ? (
        <span id={`${id}-error`} className={styles.error}>
          {error}
        </span>
      ) : null}
      {hint ? (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
