import { type FormEvent, useEffect, useId, useState } from 'react';
import { isApiRequestError } from '@/shared/api/errors';
import { formatKstMonthDayTime } from '@/shared/lib/format';
import { Button, Radio, Select, TextField } from '@/shared/ui';
import { useCreateManualFxRateMutation } from '../../api/fxRates';
import {
  applyManualFxChange,
  FX_CURRENCY_LABEL,
  FX_KIND_LABEL,
  FX_SERIES_LABEL,
  formatRecordRate,
  fxSeriesKey,
  manualFxDefaults,
  manualFxErrorsOf,
  toManualFxInput,
  unitLabel,
  validateManualFx,
  type FxCurrency,
  type FxRateKind,
  type FxRateRecord,
  type FxSeriesKey,
  type ManualFxErrors,
  type ManualFxFormValues,
} from '../../model/fx';
import styles from './FxRateManualForm.module.css';

export interface FxRateManualFormProps {
  /** 처음 고를 종류·통화(요약 '직접 넣기'에서 온 칸) */
  initialSeries?: FxSeriesKey;
  /** 숫자가 바뀔 때마다 첫 칸(종류)에 초점을 옮긴다(설정 요약 '환율 직접 입력' 단추) */
  focusRequest?: number;
  /** 저장 뒤(201) */
  onSaved?: (record: FxRateRecord) => void;
  /** 기준 시각 기본값의 '지금'(테스트) */
  now?: () => Date;
}

/**
 * 환율 직접 입력(F-ST-06, P2-04 규칙 8): 종류·통화·값·단위(1엔/100엔)·출처 설명·기준 시각. 자동 수집이 실패했을 때 쓴다.
 * - 원가 환율은 엔만(통화 칸의 달러를 끈다), 달러면 단위 100을 끈다(서버 422와 같은 규칙을 칸에서 먼저 막는다)
 * - 기준 시각은 한국 시간(datetime-local, +09:00으로 보낸다)
 * - 422 `fieldErrors`는 칸 옆에 보인다. 값은 고치지 않고 새 기록으로 남는다(오타도 새로 넣어 바로잡는다)
 */
export function FxRateManualForm({
  initialSeries = 'COST/JPY',
  focusRequest,
  onSaved,
  now = () => new Date(),
}: FxRateManualFormProps) {
  const ids = { kind: useId(), unit: useId(), status: useId() };
  const [values, setValues] = useState<ManualFxFormValues>(() =>
    manualFxDefaults(now(), initialSeries),
  );
  const [errors, setErrors] = useState<ManualFxErrors>({});
  const [otherErrors, setOtherErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<FxRateRecord | null>(null);
  const mutation = useCreateManualFxRateMutation();

  useEffect(() => {
    if (focusRequest === undefined || focusRequest === 0) return;
    document.getElementById(ids.kind)?.focus();
  }, [focusRequest, ids.kind]);

  const change = (patch: Partial<ManualFxFormValues>) => {
    setValues((v) => applyManualFxChange(v, patch));
    setSaved(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateManualFx(values);
    setErrors(found);
    setOtherErrors([]);
    if (Object.keys(found).length > 0) return;
    mutation.mutate(toManualFxInput(values), {
      onSuccess: (record) => {
        setSaved(record);
        setValues((v) => ({ ...v, rateValue: '', sourceNote: '' }));
        onSaved?.(record);
      },
      onError: (error) => {
        if (isApiRequestError(error) && error.code === 'VALIDATION_FAILED') {
          const { byField, rest } = manualFxErrorsOf(error.envelope.fieldErrors);
          setErrors(byField);
          setOtherErrors(
            rest.length > 0 ? rest : Object.keys(byField).length > 0 ? [] : [error.message],
          );
          return;
        }
        setOtherErrors([error.message]);
      },
    });
  };

  const usd = values.currency === 'USD';
  const savedKey = saved ? fxSeriesKey(saved.rateKind, saved.currency) : null;

  return (
    <form className={styles.form} onSubmit={submit} noValidate aria-describedby={ids.status}>
      <div className={styles.grid}>
        <Select
          id={ids.kind}
          label="종류"
          value={values.rateKind}
          error={errors.rateKind}
          onChange={(e) => change({ rateKind: e.target.value as FxRateKind })}
        >
          {(Object.keys(FX_KIND_LABEL) as FxRateKind[]).map((k) => (
            <option key={k} value={k}>
              {FX_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        <Select
          label="통화"
          value={values.currency}
          error={errors.currency}
          hint={values.rateKind === 'COST' ? '원가 환율은 엔만 넣습니다' : undefined}
          onChange={(e) => change({ currency: e.target.value as FxCurrency })}
        >
          {(Object.keys(FX_CURRENCY_LABEL) as FxCurrency[]).map((c) => (
            <option key={c} value={c} disabled={values.rateKind === 'COST' && c === 'USD'}>
              {FX_CURRENCY_LABEL[c]}
            </option>
          ))}
        </Select>
        <TextField
          label="값"
          numeric
          inputMode="decimal"
          unit="원"
          value={values.rateValue}
          error={errors.rateValue}
          hint={
            usd ? '1달러당 원' : values.unit === 100 ? '100엔당 원(예 876.00)' : '1엔당 원(예 8.76)'
          }
          onChange={(e) => change({ rateValue: e.target.value })}
        />
        <fieldset
          className={styles.fieldset}
          aria-describedby={errors.unit ? `${ids.unit}-error` : undefined}
        >
          <legend className={styles.legend}>단위</legend>
          <div className={styles.radios}>
            {([1, 100] as const).map((unit) => (
              <Radio
                key={unit}
                name={`${ids.unit}-unit`}
                label={unitLabel(unit, values.currency)}
                value={String(unit)}
                checked={values.unit === unit}
                disabled={usd && unit === 100}
                onChange={() => change({ unit })}
              />
            ))}
          </div>
          {errors.unit ? (
            <span id={`${ids.unit}-error`} className={styles.error}>
              {errors.unit}
            </span>
          ) : null}
        </fieldset>
        <TextField
          label="출처 설명"
          value={values.sourceNote}
          maxLength={200}
          placeholder="예: 은행 고시 확인"
          error={errors.sourceNote}
          onChange={(e) => change({ sourceNote: e.target.value })}
        />
        <TextField
          label="기준 시각(한국 시간)"
          type="datetime-local"
          value={values.referenceAt}
          error={errors.referenceAt}
          onChange={(e) => change({ referenceAt: e.target.value })}
        />
      </div>
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={mutation.isPending}>
          {mutation.isPending ? '넣는 중…' : '환율 넣기'}
        </Button>
        <span id={ids.status} role="status" className={styles.status}>
          {saved && savedKey
            ? `넣었습니다 · ${FX_SERIES_LABEL[savedKey]} ${formatRecordRate(saved)}(기준 ${formatKstMonthDayTime(saved.referenceAt)})`
            : ''}
        </span>
      </div>
      {otherErrors.length > 0 ? (
        <ul role="alert" className={styles.alert}>
          {otherErrors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
