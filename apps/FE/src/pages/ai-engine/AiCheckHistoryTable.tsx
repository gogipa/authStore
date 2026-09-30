import {
  AI_CLI_CHECK_TRIGGER_LABEL,
  type AiCliCheck,
  authStatusView,
  formatLatency,
  smokeChip,
} from '@/features/system';
import { AI_ENGINE_LABEL } from '@/shared/lib/aiEngine';
import { EMPTY_VALUE, formatKstMonthDayTime } from '@/shared/lib/format';
import { Chip, DataTable, type DataTableColumn } from '@/shared/ui';
import styles from './AiCheckHistoryTable.module.css';

export interface AiCheckHistoryTableProps {
  rows: readonly AiCliCheck[];
  'aria-labelledby'?: string;
}

/** 이력 한 행의 로그인 글(카드와 같은 문구 — 행 하나라 '마지막 연결 테스트'는 그 행 자신) */
function authText(row: AiCliCheck): string {
  if (!row.installed) return EMPTY_VALUE;
  return authStatusView({
    engineCode: row.engineCode,
    selected: false,
    latest: row,
    lastSmoke: row.smokeStatus === 'SKIPPED' ? null : row,
  }).chip.label;
}

const COLUMNS: readonly DataTableColumn<AiCliCheck>[] = [
  {
    key: 'checkedAt',
    header: '시각',
    width: 104,
    cell: (row) => <span className={styles.mono}>{formatKstMonthDayTime(row.checkedAt)}</span>,
  },
  { key: 'engine', header: '엔진', cell: (row) => AI_ENGINE_LABEL[row.engineCode] },
  {
    key: 'trigger',
    header: '계기',
    cell: (row) => (
      <>
        {AI_CLI_CHECK_TRIGGER_LABEL[row.trigger]} <span className={styles.code}>{row.trigger}</span>
      </>
    ),
  },
  {
    key: 'install',
    header: '설치·버전',
    cell: (row) =>
      row.installed ? (
        <span className={styles.mono}>{row.cliVersion ?? '버전 모름'}</span>
      ) : (
        '설치 안 됨'
      ),
  },
  { key: 'auth', header: '로그인', cell: authText },
  {
    key: 'smoke',
    header: '연결 테스트',
    cell: (row) => {
      const chip = smokeChip(row.smokeStatus === 'SKIPPED' ? null : row);
      return (
        <span className={styles.smoke}>
          <Chip tone={chip.tone} icon={chip.icon}>
            {row.smokeStatus === 'SKIPPED' ? '안 함' : chip.label}
          </Chip>
          {row.model ? <span className={styles.code}>{row.model}</span> : null}
        </span>
      );
    },
  },
  {
    key: 'latency',
    header: '걸린 시간',
    align: 'right',
    width: 96,
    cell: (row) => <span className={styles.mono}>{formatLatency(row.latencyMs)}</span>,
  },
];

/**
 * SCR-13 '최근 점검 이력' 표(AiEngine.dc.html, P1-11): 시각 · 엔진 · 계기(한국어 + 코드) · 설치·버전 · 로그인 ·
 * 연결 테스트(칩 + 모델) · 걸린 시간(오른쪽 정렬). 행은 `GET /ai-cli-checks`(최신순, Proposed).
 */
export function AiCheckHistoryTable({
  rows,
  'aria-labelledby': labelledBy,
}: AiCheckHistoryTableProps) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey={(row) => row.id}
      aria-labelledby={labelledBy}
      empty="아직 점검한 기록이 없습니다."
    />
  );
}
