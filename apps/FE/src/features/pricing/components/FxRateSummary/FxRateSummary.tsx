import { cx } from '@/shared/lib/cx';
import { EMPTY_VALUE } from '@/shared/lib/format';
import { Banner } from '@/shared/ui';
import {
  FX_SERIES,
  FX_SERIES_LABEL,
  formatRecordRate,
  fxSummaryLabel,
  latestOf,
  type FxRateLatestSet,
  type FxSeriesKey,
} from '../../model/fx';
import styles from './FxRateSummary.module.css';

export interface FxRateSummaryProps {
  /** `GET /fx-rates/latest` 결과(받는 중이면 undefined) */
  latest: FxRateLatestSet | undefined;
  /** 보일 종류(기본 3종 — SCR-04 ③은 원가 환율만 넘긴다) */
  series?: readonly FxSeriesKey[];
  /** 받는 중 */
  pending?: boolean;
  /** 조회 실패 문구 */
  error?: string | null;
  /** '직접 넣기' 링크 단추(Judgement 보드). 주면 칸마다 붙는다 */
  onManualInput?: (series: FxSeriesKey) => void;
  className?: string;
}

/**
 * 환율 요약(P2-04, SCR-10 '환율' 탭과 SCR-04 ③ 가격 요약 칸이 같이 쓴다). 칸마다 머리 '원가 환율 · 자동 09:00'(출처 짧은 이름 +
 * 받은 시각 KST)과 값 '8.76원/엔'(= rateValue / unit). 경고(`FX_FETCH_FAILED`·`FX_DIVERGENCE`)는 위에 경고 띠(Banner warning)로
 * 서버 문구 그대로 보인다(막지 않는다).
 */
export function FxRateSummary({
  latest,
  series = FX_SERIES,
  pending = false,
  error = null,
  onManualInput,
  className,
}: FxRateSummaryProps) {
  const warnings = latest?.warnings ?? [];
  return (
    <div className={cx(styles.summary, className)}>
      {warnings.length > 0 ? (
        <Banner tone="warning">
          <ul className={styles.warnings} aria-label="환율 경고">
            {warnings.map((w, i) => (
              <li key={`${w.code}-${w.rateKind ?? ''}-${w.currency ?? ''}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <ul className={styles.cells} aria-label="최신 환율">
        {series.map((key) => {
          const record = latestOf(latest, key);
          return (
            <li key={key} className={styles.cell}>
              <span className={styles.label}>
                {pending && !latest
                  ? `${FX_SERIES_LABEL[key]} · 받는 중`
                  : fxSummaryLabel(key, record)}
              </span>
              <span className={styles.valueRow}>
                <span className={cx(styles.value, !record && styles.missing)}>
                  {record ? formatRecordRate(record) : EMPTY_VALUE}
                </span>
                {onManualInput ? (
                  <button type="button" className={styles.link} onClick={() => onManualInput(key)}>
                    직접 넣기
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
