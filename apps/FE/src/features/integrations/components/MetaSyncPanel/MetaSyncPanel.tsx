import { type ReactNode, useId } from 'react';
import { EMPTY_VALUE, formatKstTime } from '@/shared/lib/format';
import { Banner, Button, Chip, DisabledReason, Disclosure, Panel } from '@/shared/ui';
import {
  useCommerceMetaSyncStatusQuery,
  useStartCommerceMetaSyncMutation,
} from '../../api/commerceMetaSync';
import {
  hasRunningMetaSync,
  lastMetaSyncSuccess,
  META_SYNC_STATE_CHIP,
  type MetaSyncRowView,
  metaSyncRows,
  type MetaSyncState,
  type MetaSyncTargetView,
} from '../../model/metaSyncRows';
import styles from './MetaSyncPanel.module.css';

export interface MetaSyncPanelProps {
  /**
   * '지금 동기화'가 409 `SECRET_NOT_CONFIGURED`면 안내 옆에 붙일 키 입력 링크(빠진 키 이름을 받는다).
   * 시스템 상태 화면이 키 입력 패널로 가는 링크를 넣는다(feature끼리 부르지 않게 슬롯으로 받는다).
   */
  renderSecretLink?: (secretKeys: string[]) => ReactNode;
}

/** 진행 중이라 꺼진 '지금 동기화' 옆 이유 글(Proposed — 보드에 없음) */
export const META_SYNC_RUNNING_REASON = '동기화 중입니다. 끝나면 다시 누를 수 있습니다.';

function StateChip({ state }: { state: MetaSyncState }) {
  const chip = META_SYNC_STATE_CHIP[state];
  return (
    <Chip tone={chip.tone} icon={chip.icon}>
      {chip.label}
    </Chip>
  );
}

/** 줄 시각 'HH:MM'(KST, mono 12px — 보드 값). 없으면 '—' */
function Time({ value }: { value: string | null }) {
  return <span className={styles.time}>{value ? formatKstTime(value) : EMPTY_VALUE}</span>;
}

/** 캡션: '하루 한 번 자동으로 받습니다 · 마지막 {HH:MM} 성공'(보드). 성공이 없으면 '아직 받은 적이 없습니다'(Proposed) */
function captionText(loaded: boolean, lastSuccess: string | null): string {
  const base = '하루 한 번 자동으로 받습니다';
  if (!loaded) return base;
  return lastSuccess
    ? `${base} · 마지막 ${formatKstTime(lastSuccess)} 성공`
    : `${base} · 아직 받은 적이 없습니다`;
}

function secretKeysOf(details: unknown): string[] {
  const keys = (details as { secretKeys?: unknown } | undefined)?.secretKeys;
  return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [];
}

/**
 * SCR-11 (3) 메타데이터 동기화(System.dc.html, F-SY-03·F-BS-48). 머리 오른쪽 '지금 동기화'(보조 버튼),
 * 줄마다 이름·상태 칩·시각(HH:MM), 아래 캡션 '하루 한 번 자동으로 받습니다 · 마지막 {HH:MM} 성공'.
 * 대상 8개를 보드의 3줄로 묶는다(카테고리 줄 = 6개, Proposed). 묶은 줄이 실패면 대상별 상태를 펼쳐 볼 수 있다.
 * 동기화 중이면 버튼을 끄고 이유를 쓴다. 끝은 SSE `commerce-meta-sync.completed`로 다시 읽는다(폴링 없음).
 */
export function MetaSyncPanel({ renderSecretLink }: MetaSyncPanelProps) {
  const reasonId = `meta-sync-reason-${useId()}`;
  const status = useCommerceMetaSyncStatusQuery();
  const start = useStartCommerceMetaSyncMutation();
  const data = status.data;
  const running = hasRunningMetaSync(data);
  const lastSuccess = lastMetaSyncSuccess(data);
  const error = start.isError ? start.error : null;
  const missingKeys =
    error?.code === 'SECRET_NOT_CONFIGURED' ? secretKeysOf(error.envelope.details) : [];

  return (
    <Panel
      id="meta-sync"
      title="메타데이터 동기화"
      actions={
        <Button
          size="sm"
          disabled={running || start.isPending}
          aria-describedby={running ? reasonId : undefined}
          onClick={() => start.mutate(undefined)}
        >
          {start.isPending ? '요청 중…' : '지금 동기화'}
        </Button>
      }
    >
      {status.isPending ? <p className={styles.muted}>불러오는 중입니다.</p> : null}
      {status.isError ? <Banner tone="warning">{status.error.message}</Banner> : null}
      {data ? (
        <ul className={styles.rows}>
          {metaSyncRows(data).map((row) => (
            <MetaSyncRow key={row.key} row={row} />
          ))}
        </ul>
      ) : null}
      {running ? <DisabledReason id={reasonId}>{META_SYNC_RUNNING_REASON}</DisabledReason> : null}
      {error ? (
        <p role="alert" className={styles.alert}>
          {error.message}
          {error.code === 'SECRET_NOT_CONFIGURED' && renderSecretLink ? (
            <> {renderSecretLink(missingKeys)}</>
          ) : null}
        </p>
      ) : null}
      <p className={styles.caption}>{captionText(data !== undefined, lastSuccess)}</p>
    </Panel>
  );
}

function MetaSyncRow({ row }: { row: MetaSyncRowView }) {
  const failed = row.targets.filter((t) => t.state === 'failed');
  const single = row.targets.length === 1 ? row.targets[0] : undefined;
  return (
    <li className={styles.row} data-row={row.key} data-state={row.state}>
      <div className={styles.head}>
        <span className={styles.label}>{row.label}</span>
        <StateChip state={row.state} />
        <Time value={row.time} />
      </div>
      {single?.errorMessage ? <p className={styles.error}>{single.errorMessage}</p> : null}
      {!single && failed.length > 0 ? (
        <Disclosure
          look="link"
          className={styles.detail}
          title="대상별 상태"
          meta={`${row.targets.length}개 중 ${failed.length}개 실패`}
        >
          <ul className={styles.targets}>
            {row.targets.map((t) => (
              <MetaSyncTargetItem key={t.target} item={t} />
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </li>
  );
}

function MetaSyncTargetItem({ item }: { item: MetaSyncTargetView }) {
  return (
    <li className={styles.target} data-target={item.target}>
      <div className={styles.head}>
        <span className={styles.targetLabel}>{item.label}</span>
        <StateChip state={item.state} />
        <Time value={item.time} />
      </div>
      {item.errorMessage ? <p className={styles.error}>{item.errorMessage}</p> : null}
    </li>
  );
}
