import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { isApiRequestError } from '@/shared/api/errors';
import { formatKrw, formatKstMonthDayTime } from '@/shared/lib/format';
import {
  Banner,
  Button,
  Chip,
  DataTable,
  DefinitionList,
  Disclosure,
  Icon,
  Panel,
  TextField,
  type DataTableColumn,
} from '@/shared/ui';
import {
  useActiveForwarderRateTable,
  useForwarderRateTablesQuery,
  useImportForwarderRateTableMutation,
} from '../../api/forwarderRateTables';
import {
  appliesWhenLabel,
  formatTierFee,
  formatWeightKg,
  importResultText,
  RATE_TABLE_CSV_HINT,
  RATE_TABLE_MAX_BYTES,
  rateTableVersionLabel,
  type ForwarderRateTableSummary,
  type ForwarderRateTier,
} from '../../model/forwarderRateTable';
import styles from './ForwarderRateTablePanel.module.css';

export interface ForwarderRateTablePanelProps {
  /** 요금표가 없을 때 판정 기본 배대지 비용(설정 pricing.defaultForwarderFeeKrw, 15,000원) */
  defaultFeeKrw?: number;
  /** 숫자가 바뀔 때마다 파일 칸에 초점을 옮긴다(설정 요약 'CSV 가져오기' 단추) */
  focusRequest?: number;
}

const TIER_COLUMNS: readonly DataTableColumn<ForwarderRateTier>[] = [
  {
    key: 'weight',
    header: '무게 상한',
    align: 'right',
    cell: (t) => formatWeightKg(t.weightMaxKg),
  },
  { key: 'fee', header: '요금', align: 'right', cell: (t) => formatTierFee(t.fee, t.currency) },
  { key: 'currency', header: '통화', cell: (t) => (t.currency === 'JPY' ? '엔' : '원') },
  {
    key: 'divisor',
    header: '부피무게 나눗수',
    align: 'right',
    cell: (t) => (t.volumetricDivisor === null ? '—' : t.volumetricDivisor.toLocaleString('ko-KR')),
  },
  { key: 'when', header: '적용 조건', cell: (t) => appliesWhenLabel(t) },
];

const VERSION_COLUMNS: readonly DataTableColumn<ForwarderRateTableSummary>[] = [
  { key: 'version', header: '버전', cell: (t) => `${rateTableVersionLabel(t)} · #${t.id}` },
  { key: 'file', header: '파일', cell: (t) => t.sourceFileName },
  { key: 'forwarder', header: '배대지', cell: (t) => t.forwarderName ?? '—' },
  { key: 'imported', header: '가져온 시각', cell: (t) => formatKstMonthDayTime(t.importedAt) },
  {
    key: 'state',
    header: '상태',
    cell: (t) => (t.isActive ? <Chip tone="done">활성</Chip> : <Chip tone="idle">꺼짐</Chip>),
  },
];

interface ImportErrorView {
  message: string;
  fields: { field: string; message: string }[];
}

/**
 * SCR-10 '비용·요금표' 탭의 배대지 요금표(F-ST-04, P2-04): CSV 가져오기(파일 칸 + 배대지 이름), 활성 버전 표시, 구간 표(DataTable),
 * 오류 행·열 목록(`IMPORT_PARSE_FAILED`의 `row{줄}.{열}`), 지난 버전. 같은 파일을 다시 넣으면 그 버전을 다시 켠다(200 reused).
 * 활성 버전이 없으면 판정은 기본 배대지 비용(가정값)으로 계산한다는 안내를 보인다.
 */
export function ForwarderRateTablePanel({
  defaultFeeKrw = 15_000,
  focusRequest,
}: ForwarderRateTablePanelProps) {
  const fileInputId = useId();
  const statusId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [forwarderName, setForwarderName] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);
  const [importError, setImportError] = useState<ImportErrorView | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const active = useActiveForwarderRateTable();
  const versions = useForwarderRateTablesQuery({ size: 20 });
  const importMutation = useImportForwarderRateTableMutation();

  useEffect(() => {
    if (focusRequest === undefined || focusRequest === 0) return;
    document.getElementById(fileInputId)?.focus();
  }, [focusRequest, fileInputId]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setImportError(null);
    setResultText(null);
    if (!file) {
      setClientError('가져올 CSV 파일을 골라 주세요.');
      return;
    }
    if (file.size > RATE_TABLE_MAX_BYTES) {
      setClientError('파일이 5MB를 넘습니다. 요금표 CSV만 올려 주세요.');
      return;
    }
    setClientError(null);
    importMutation.mutate(
      { file, forwarderName: forwarderName.trim() || undefined },
      {
        onSuccess: (result) => {
          setResultText(importResultText(result));
          setFile(null);
          formRef.current?.reset();
        },
        onError: (error) => {
          setImportError({
            message: error.message,
            fields: isApiRequestError(error) ? (error.envelope.fieldErrors ?? []) : [],
          });
        },
      },
    );
  };

  const table = active.table;
  const others = (versions.data?.content ?? []).filter((v) => !v.isActive);

  return (
    <Panel
      title="배대지 요금표"
      caption={
        table
          ? `활성 ${rateTableVersionLabel(table)} · #${table.id}`
          : table === null
            ? '활성 요금표 없음'
            : undefined
      }
    >
      <div className={styles.body}>
        <form
          ref={formRef}
          className={styles.importForm}
          onSubmit={submit}
          aria-describedby={statusId}
        >
          <div className={styles.fileField}>
            <label htmlFor={fileInputId} className={styles.label}>
              요금표 CSV
            </label>
            <input
              id={fileInputId}
              type="file"
              accept=".csv,text/csv"
              className={styles.fileInput}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setClientError(null);
              }}
            />
          </div>
          <TextField
            label="배대지 이름(선택)"
            value={forwarderName}
            maxLength={100}
            onChange={(e) => setForwarderName(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            className={styles.submit}
            disabled={importMutation.isPending}
          >
            <Icon name="upload" />
            {importMutation.isPending ? '가져오는 중…' : 'CSV 가져오기'}
          </Button>
        </form>
        <p className={styles.caption}>{RATE_TABLE_CSV_HINT}</p>
        <p id={statusId} role="status" className={styles.done}>
          {resultText ?? ''}
        </p>
        {clientError ? (
          <p role="alert" className={styles.alertText}>
            {clientError}
          </p>
        ) : null}
        {importError ? (
          <Banner tone="blocked" role="alert">
            <p>{importError.message}</p>
            {importError.fields.length > 0 ? (
              <ul className={styles.errorList} aria-label="요금표 오류 위치">
                {importError.fields.map((e, i) => (
                  <li key={`${e.field}-${i}`}>
                    <code className={styles.field}>{e.field}</code> {e.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </Banner>
        ) : null}

        {active.error ? <Banner tone="warning">{active.error.message}</Banner> : null}
        {table === null ? (
          <Banner tone="info">
            활성 요금표가 없어 판정은 배대지 비용 {formatKrw(defaultFeeKrw)}(가정값)으로 계산합니다.
          </Banner>
        ) : null}
        {table ? (
          <section className={styles.active} aria-label="활성 요금표">
            <DefinitionList
              labelWidth={88}
              items={[
                { term: '버전', detail: `${rateTableVersionLabel(table)} · #${table.id}` },
                { term: '배대지', detail: table.forwarderName ?? '—' },
                { term: '파일', detail: table.sourceFileName },
                {
                  term: '가져온 시각',
                  detail: `${formatKstMonthDayTime(table.importedAt)}${
                    table.activatedAt
                      ? ` · 켠 시각 ${formatKstMonthDayTime(table.activatedAt)}`
                      : ''
                  }`,
                },
              ]}
            />
            <DataTable
              aria-label="무게 구간"
              columns={TIER_COLUMNS}
              rows={table.tiers}
              rowKey={(t) => t.id}
              empty="구간이 없습니다."
            />
          </section>
        ) : null}
        {others.length > 0 ? (
          <Disclosure title="지난 버전" meta={`${others.length}개`} look="link">
            <DataTable
              aria-label="지난 요금표 버전"
              columns={VERSION_COLUMNS}
              rows={others}
              rowKey={(t) => t.id}
            />
            <p className={styles.caption}>
              지난 버전을 다시 쓰려면 그 CSV 파일을 다시 가져옵니다(같은 파일이면 그 버전을 켭니다).
            </p>
          </Disclosure>
        ) : null}
      </div>
    </Panel>
  );
}
