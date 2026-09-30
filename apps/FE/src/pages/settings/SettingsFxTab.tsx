import { useState } from 'react';
import {
  FX_SERIES_LABEL,
  FX_SOURCE_LABEL,
  FxRateManualForm,
  FxRateSummary,
  formatRecordRate,
  fxAutoCaption,
  fxSeriesKey,
  latestOf,
  unitLabel,
  useFxRatesQuery,
  useLatestFxRatesQuery,
  type FxRateRecord,
  type FxSeriesKey,
} from '@/features/pricing';
import { formatKstMonthDayTime } from '@/shared/lib/format';
import { DataTable, Panel, type DataTableColumn } from '@/shared/ui';
import styles from './SettingsPage.module.css';

/** 환율 기록 표 한 페이지(최근 10건) */
const HISTORY_PAGE = { size: 10 } as const;

const HISTORY_COLUMNS: readonly DataTableColumn<FxRateRecord>[] = [
  { key: 'reference', header: '기준 시각', cell: (r) => formatKstMonthDayTime(r.referenceAt) },
  {
    key: 'series',
    header: '종류',
    cell: (r) => {
      const key = fxSeriesKey(r.rateKind, r.currency);
      return key ? FX_SERIES_LABEL[key] : `${r.rateKind}/${r.currency}`;
    },
  },
  { key: 'value', header: '값', align: 'right', cell: (r) => formatRecordRate(r) },
  {
    key: 'raw',
    header: '고시 원값',
    align: 'right',
    cell: (r) =>
      `${r.rateValue.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}원/${unitLabel(r.unit, r.currency)}`,
  },
  {
    key: 'source',
    header: '출처',
    cell: (r) =>
      r.sourceNote ? `${FX_SOURCE_LABEL[r.source]} · ${r.sourceNote}` : FX_SOURCE_LABEL[r.source],
  },
  { key: 'collected', header: '받은 시각', cell: (r) => formatKstMonthDayTime(r.collectedAt) },
];

export interface SettingsFxTabProps {
  /** 요약 '환율 직접 입력' 단추가 올린 초점 요청 */
  focusRequest: number;
}

/**
 * SCR-10 '환율' 탭(P2-04): 최신 환율 3종과 경고(원가 환율·과세환율 엔·달러 — 보드에는 원가만 있어 과세환율 두 칸을 더했다,
 * 열린질문 P2-04 Proposed), 직접 입력, 최근 기록 10건.
 */
export function SettingsFxTab({ focusRequest }: SettingsFxTabProps) {
  const latest = useLatestFxRatesQuery();
  const history = useFxRatesQuery(HISTORY_PAGE);
  const [series, setSeries] = useState<FxSeriesKey>('COST/JPY');
  const [formRequest, setFormRequest] = useState(0);
  const cost = latestOf(latest.data, 'COST/JPY');

  return (
    <div className={styles.tabBody}>
      <Panel title="환율" caption={fxAutoCaption(cost)}>
        <FxRateSummary
          latest={latest.data}
          pending={latest.isPending}
          error={latest.error?.message ?? null}
          onManualInput={(key) => {
            setSeries(key);
            setFormRequest((n) => n + 1);
          }}
        />
      </Panel>
      <Panel
        title="환율 직접 입력"
        caption="자동 수집이 실패했거나 값을 바로잡을 때 새 기록으로 넣습니다"
      >
        <FxRateManualForm
          key={series}
          initialSeries={series}
          focusRequest={focusRequest + formRequest}
        />
      </Panel>
      <Panel title="환율 기록" caption="최근 10건 · 기준 시각 순">
        {history.error ? <p className={styles.alertText}>{history.error.message}</p> : null}
        <DataTable
          aria-label="환율 기록"
          columns={HISTORY_COLUMNS}
          rows={history.data?.content ?? []}
          rowKey={(r) => r.id}
          empty={history.isPending ? '받는 중…' : '환율 기록이 없습니다.'}
        />
      </Panel>
    </div>
  );
}
