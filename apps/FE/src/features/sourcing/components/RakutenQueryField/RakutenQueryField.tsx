import { useId, type ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { TextField } from '@/shared/ui';
import type { RakutenQueryCheck } from '../../api/useRakutenQueryCheck';
import styles from './RakutenQueryField.module.css';

export interface RakutenQueryFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** `useRakutenQueryCheck(value)` 결과 */
  check: RakutenQueryCheck;
  /** 칸 라벨(기본 '라쿠텐 검색어') */
  label?: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  /** 요청 오류(후보 만들기·② 실행의 422 등). 있으면 위반 문구 대신 보인다 */
  error?: ReactNode;
}

/**
 * 라쿠텐 검색어 칸(Sourcing 보드 '검색 조건', F-SO-01·02): 라벨 줄 오른쪽에 '반각 32/128자 · 형식 맞음'(맞으면 done 색,
 * 어기면 failed 색), 칸 아래에 위반 문구. 검사는 입력이 멈춘 뒤 서버(`validateRakutenQuery`)가 한다.
 */
export function RakutenQueryField({
  value,
  onChange,
  check,
  label = '라쿠텐 검색어',
  id,
  disabled,
  placeholder,
  error,
}: RakutenQueryFieldProps) {
  const autoId = useId();
  const inputId = id ?? `rakuten-query-${autoId}`;
  const statusId = `${inputId}-status`;
  const errorId = `${inputId}-error`;
  const shownError = error ?? (value.trim() === '' ? undefined : check.violationText);
  const summary = value.trim() === '' ? null : check.summary;
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
        <span
          id={statusId}
          aria-live="polite"
          className={cx(styles.status, summary && (summary.valid ? styles.ok : styles.bad))}
        >
          {summary ? (
            <>
              반각 <span className={styles.num}>{summary.count}</span>자 · {summary.text}
            </>
          ) : null}
        </span>
      </div>
      <TextField
        id={inputId}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={shownError ? true : undefined}
        aria-describedby={[statusId, shownError ? errorId : null].filter(Boolean).join(' ')}
      />
      {shownError ? (
        <span id={errorId} className={styles.error}>
          {shownError}
        </span>
      ) : null}
    </div>
  );
}
