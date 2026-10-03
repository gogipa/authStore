import { useId } from 'react';
import { formatKstTime } from '@/shared/lib/format';
import { Banner, Button, Chip, DataTable, type DataTableColumn, Icon, Panel } from '@/shared/ui';
import { useRefreshStorageUsageMutation, useStorageUsageQuery } from '../../api/storageUsage';
import { STORAGE_USAGE_HELP, type StorageRowView, storageRows } from '../../model/storageUsage';
import styles from './StorageUsagePanel.module.css';

/** 값(mono) + 뒤 글(본문 글꼴): '1.2GB 이상', '120.5GB 남음' */
function ValueText({ value, suffix }: { value: string; suffix: string | null }) {
  return (
    <>
      <span className={styles.mono}>{value}</span>
      {suffix ? <span className={styles.suffix}> {suffix}</span> : null}
    </>
  );
}

const COLUMNS: readonly DataTableColumn<StorageRowView>[] = [
  { key: 'label', header: '항목', width: 128, cell: (row) => row.label },
  {
    key: 'location',
    header: '위치',
    cell: (row) =>
      row.locationIsPath ? <span className={styles.path}>{row.location}</span> : row.location,
  },
  {
    key: 'size',
    header: '크기',
    align: 'right',
    width: 144,
    cell: (row) => <ValueText value={row.size} suffix={row.sizeSuffix} />,
  },
  {
    key: 'count',
    header: '파일 수',
    align: 'right',
    width: 120,
    cell: (row) => <ValueText value={row.count} suffix={row.countSuffix} />,
  },
  {
    key: 'notes',
    header: '안내',
    cell: (row) => (
      <span className={styles.notes}>
        {row.chip ? (
          <span className={styles.chip}>
            <Chip tone={row.chip.tone}>{row.chip.label}</Chip>
          </span>
        ) : null}
        {row.notes.join(' ')}
      </span>
    ),
  },
];

/**
 * SCR-13 '저장 공간'(D-25, F-ST-33 — 화면시안_명세 SCR-13 D-25 절). 읽기 전용 패널이다.
 * 행 3개: agy 기록(`~/.gemini/antigravity-cli`) · 앱 이미지(데이터 폴더 images) · 디스크 남은 공간.
 * 화면을 열 때 한 번 읽고(BE 1분 캐시), [다시 재기]만 새로 잰다(`refresh=true`). 앱은 크기만 재고 아무것도 지우지 않는다.
 */
export function StorageUsagePanel() {
  const usage = useStorageUsageQuery();
  const refresh = useRefreshStorageUsageMutation();
  const titleId = `storage-usage-${useId()}`;
  const measuring = usage.isPending || refresh.isPending;
  const error = refresh.error ?? usage.error;

  return (
    <Panel
      id="storage-usage"
      title={<span id={titleId}>저장 공간</span>}
      caption={
        usage.data ? (
          <>
            측정 <span className={styles.mono}>{formatKstTime(usage.data.measuredAt)}</span>
          </>
        ) : usage.isPending ? (
          '재는 중…'
        ) : undefined
      }
      actions={
        <Button size="sm" onClick={() => refresh.mutate()} disabled={measuring}>
          <Icon name="refresh" size={16} />
          {measuring ? '재는 중…' : '다시 재기'}
        </Button>
      }
    >
      {error ? <Banner tone="warning">{error.message}</Banner> : null}
      {usage.data ? (
        <DataTable
          columns={COLUMNS}
          rows={storageRows(usage.data)}
          rowKey={(row) => row.key}
          aria-labelledby={titleId}
        />
      ) : usage.isPending ? (
        <p className={styles.caption}>재는 중입니다. 최대 5초 걸립니다.</p>
      ) : null}
      <p className={styles.caption}>{STORAGE_USAGE_HELP}</p>
    </Panel>
  );
}
