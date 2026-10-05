import { useId, type ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { TextField } from '@/shared/ui';
import type { RakutenQueryCheck } from '../../api/useRakutenQueryCheck';
import { HANGUL_QUERY_HINT, hasHangul } from '../../model/sourcing';
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
  /** 요청 오류(여정 만들기·② 실행의 422 등). 있으면 위반 문구 대신 보인다 */
  error?: ReactNode;
  /** 한글이 들어 있을 때 칸 아래 안내. 기본은 '일본어로 바꿔 주세요'(`HANGUL_QUERY_HINT`), null이면 보이지 않는다(자동으로 바꾸는 화면) */
  hangulHint?: string | null;
}

/**
 * 라쿠텐 검색어 칸(Sourcing 보드 '검색 조건', F-SO-01·02): 라벨 줄 오른쪽에 '길이 32/128 · 사용 가능'(맞으면 done 색,
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
  hangulHint: hangulHintText = HANGUL_QUERY_HINT,
}: RakutenQueryFieldProps) {
  const autoId = useId();
  const inputId = id ?? `rakuten-query-${autoId}`;
  const statusId = `${inputId}-status`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const shownError = error ?? (value.trim() === '' ? undefined : check.violationText);
  const summary = value.trim() === '' ? null : check.summary;
  // 검사(길이·형식)는 한글도 통과시키지만 라쿠텐에서는 거의 결과가 없다 — 위반 문구가 없을 때 알린다
  const hangulHint = !shownError && hasHangul(value) ? hangulHintText : null;
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
              길이 <span className={styles.num}>{summary.count}</span> · {summary.text}
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
        aria-describedby={[statusId, shownError ? errorId : null, hangulHint ? hintId : null]
          .filter(Boolean)
          .join(' ')}
      />
      {shownError ? (
        <span id={errorId} className={styles.error}>
          {shownError}
        </span>
      ) : null}
      {hangulHint ? (
        <span id={hintId} className={styles.hint}>
          {hangulHint}
        </span>
      ) : null}
    </div>
  );
}
