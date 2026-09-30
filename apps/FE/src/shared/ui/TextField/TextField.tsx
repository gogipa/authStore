import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { Field } from '../Field/Field';
import { fieldDescribedBy } from '../Field/fieldIds';
import styles from './TextField.module.css';

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'children'
> {
  /**
   * 칸 위 라벨. `<label for>`로 칸과 묶는다(라벨로 칸을 찾을 수 있다). 카드 격자처럼 라벨을 칸 밖에 따로 두면 비우고,
   * 그 `<label htmlFor={id}>`가 이 칸의 `id`를 가리키게 한다(Select와 같다, P1-11 AiEngine 보드 Codex 모델 칸).
   */
  label?: ReactNode;
  /** 모델 ID처럼 코드 값: mono 13px(AiEngine 보드, Select `mono`와 같다). */
  mono?: boolean;
  /** 칸 안 오른쪽 단위 캡션(원·¥·mm). */
  unit?: string;
  /** 잠긴 칸: 읽기 전용 + 잠김 모양(surface-sunk 바탕, line 테두리). */
  locked?: boolean;
  /** 숫자 칸: mono 글꼴, tabular-nums, 오른쪽 정렬(가격·수량). */
  numeric?: boolean;
  /** 오류 글. 있으면 `aria-invalid="true"`이고 칸 아래에 failed 색으로 보인다. */
  error?: ReactNode;
  /** 칸 아래 도움말(캡션). */
  hint?: ReactNode;
}

/** 입력칸(화면시안_명세 §3): 라벨 위, 높이 36px, 단위는 칸 안 오른쪽. */
export function TextField({
  label,
  unit,
  locked = false,
  numeric = false,
  mono = false,
  error,
  hint,
  id,
  className,
  type = 'text',
  readOnly,
  'aria-describedby': describedBy,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? `text-field-${autoId}`;
  const invalid = Boolean(error);
  const control = (
    <div
      className={cx(
        styles.box,
        locked && styles.locked,
        invalid && styles.invalid,
        rest.disabled && styles.locked,
        className,
      )}
    >
      <input
        id={inputId}
        type={type}
        className={cx(styles.input, numeric && styles.numeric, mono && styles.mono)}
        readOnly={locked || readOnly}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={fieldDescribedBy(inputId, { hint, error }, describedBy)}
        {...rest}
      />
      {unit ? <span className={styles.unit}>{unit}</span> : null}
    </div>
  );
  if (label === undefined) return control;
  return (
    <Field id={inputId} label={label} hint={hint} error={error}>
      {control}
    </Field>
  );
}
