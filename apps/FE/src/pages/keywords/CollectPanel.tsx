import { useId } from 'react';
import {
  abortMessage,
  cidLabel,
  collectDisabledReason,
  collectionStatusLine,
  expectedCollectionPeriod,
  type KeywordCollectionProgress,
  type KeywordCollectionStatus,
  type RankLimit,
} from '@/features/keywords';
import { formatCount } from '@/shared/lib/format';
import {
  Banner,
  Button,
  Chip,
  DisabledReason,
  FilterToggleGroup,
  Icon,
  Panel,
  ProgressBar,
  TextField,
} from '@/shared/ui';
import styles from './CollectPanel.module.css';

/** 경고 띠에 보일 중단 정보(SSE aborted 또는 묶음 조회) */
export interface CollectAbortInfo {
  abortReason: string | null;
  blockedUntil: string | null;
  structureChangeSuspected: boolean;
}

export interface CollectPanelProps {
  status: KeywordCollectionStatus | undefined;
  progress: KeywordCollectionProgress | null;
  /** 표가 보이는 분야(여성신발·남성신발). 이 묶음에 분야가 없으면(붙여넣기 모름) 빈 배열 */
  fieldOptions: readonly (string | null)[];
  field: string | null;
  onFieldChange: (cid: string | null) => void;
  rankLimit: RankLimit;
  onRankLimitChange: (value: RankLimit) => void;
  onCollect: () => void;
  collecting: boolean;
  /** '수집' 요청 오류(409 DAILY_LIMIT_REACHED 등) */
  collectError: string | null;
  pasteOpen: boolean;
  onTogglePaste: () => void;
  abort: CollectAbortInfo | null;
  /** 지금 시각(기간 계산 — 테스트가 바꾼다) */
  now?: Date;
}

const FIELD_NONE = 'NONE';

/** 요청 간격 기본(수집 상태를 아직 받지 못했을 때 — 설정 기본값과 같다) */
const DEFAULT_INTERVAL_SECONDS = 2;

/**
 * 진행 줄: '여성신발 5/5 · 남성신발 5/5' · '10/10 페이지 · 20초' + 상태 칩(수집 중·완료·중단).
 * 초는 예상 소요 시간(요청 수 × 요청 간격, Proposed — 보드 '· 20 초')이다.
 */
function ProgressRow({
  progress,
  intervalSeconds,
}: {
  progress: KeywordCollectionProgress;
  intervalSeconds: number;
}) {
  const done = progress.phase === 'completed';
  const value = done ? progress.requestsTotal : progress.requestsDone;
  const perCid = progress.cids
    .map((cid) => `${cidLabel(cid)} ${progress.pagesByCid[cid] ?? 0}/${progress.pagesPerCid}`)
    .join(' · ');
  const pages = `${formatCount(value)}/${formatCount(progress.requestsTotal)} 페이지`;
  const seconds = formatCount(Math.round(progress.requestsTotal * intervalSeconds));
  return (
    <div className={styles.progress}>
      <div className={styles.progressHead}>
        {progress.phase === 'completed' ? (
          <Chip tone="done" icon="check">
            완료
          </Chip>
        ) : progress.phase === 'aborted' ? (
          <Chip tone="failed" icon="alert">
            중단
          </Chip>
        ) : (
          <Chip tone="running">수집 중</Chip>
        )}
        <span className={styles.perCid}>{perCid}</span>
        <span className={styles.spacer} />
        <span className={styles.pages}>
          {pages}
          <span> · {seconds}초</span>
        </span>
      </div>
      <ProgressBar
        aria-label="수집 진행률"
        value={value}
        max={Math.max(progress.requestsTotal, 1)}
        valueText={pages}
      />
    </div>
  );
}

/**
 * SCR-02 '데이터랩 수집'(Keywords.dc.html 위 줄 왼쪽, F-KW-01~04). 분야(여성신발·남성신발 — M1은 늘 둘 다 모으고, 여기서
 * 고른 분야의 키워드를 아래 표에 보인다, Proposed), 기간(읽기 전용), 수집 범위(100·500위), 진행률, '순위 붙여넣기'·'수집'.
 * M2(세부 분류·기기·성별·연령)는 그리지 않는다. '수집'이 꺼지면 이유를 보인다(수집 중·24시간 쉼).
 */
export function CollectPanel({
  status,
  progress,
  fieldOptions,
  field,
  onFieldChange,
  rankLimit,
  onRankLimitChange,
  onCollect,
  collecting,
  collectError,
  pasteOpen,
  onTogglePaste,
  abort,
  now,
}: CollectPanelProps) {
  const reasonId = `collect-reason-${useId()}`;
  const fieldLabelId = `field-label-${useId()}`;
  const rangeLabelId = `range-label-${useId()}`;
  const period = expectedCollectionPeriod(now ?? new Date());
  const disabledReason = status ? collectDisabledReason(status) : null;
  const disabled = disabledReason !== null || collecting || status === undefined;

  return (
    <Panel
      title="데이터랩 수집"
      className={styles.panel}
      actions={
        status ? <span className={styles.statusLine}>{collectionStatusLine(status)}</span> : null
      }
    >
      {abort ? (
        <Banner tone="warning" role="alert">
          {abortMessage(abort.abortReason, abort.blockedUntil)}
        </Banner>
      ) : null}
      <div className={styles.row}>
        <div className={styles.field}>
          <span id={fieldLabelId} className={styles.label}>
            분야
          </span>
          {fieldOptions.length > 0 ? (
            <FilterToggleGroup
              look="segmented"
              aria-labelledby={fieldLabelId}
              items={fieldOptions.map((cid) => ({
                value: cid ?? FIELD_NONE,
                label: cidLabel(cid),
              }))}
              value={field ?? FIELD_NONE}
              onValueChange={(value) => onFieldChange(value === FIELD_NONE ? null : value)}
            />
          ) : (
            <span className={styles.fixed}>여성신발 · 남성신발</span>
          )}
        </div>
        <div className={styles.field}>
          <span className={styles.label}>기간</span>
          <div className={styles.period}>
            <TextField
              aria-label="시작일"
              className={styles.date}
              mono
              locked
              value={period.startDate}
            />
            <span aria-hidden="true" className={styles.tilde}>
              ~
            </span>
            <TextField
              aria-label="종료일"
              className={styles.date}
              mono
              locked
              value={period.endDate}
            />
          </div>
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.field}>
          <span id={rangeLabelId} className={styles.label}>
            수집 범위
          </span>
          <FilterToggleGroup<'100' | '500'>
            look="segmented"
            aria-labelledby={rangeLabelId}
            items={[
              { value: '100', label: '상위 100위' },
              { value: '500', label: '상위 500위' },
            ]}
            value={String(rankLimit) as '100' | '500'}
            onValueChange={(value) => onRankLimitChange(Number(value) as RankLimit)}
          />
        </div>
        <span className={styles.hint}>500위는 요청 50회 · 약 100초</span>
      </div>
      <div className={styles.foot}>
        <div className={styles.progressBox}>
          {progress ? (
            <ProgressRow
              progress={progress}
              intervalSeconds={status?.requestIntervalSeconds ?? DEFAULT_INTERVAL_SECONDS}
            />
          ) : status?.collecting ? (
            <Chip tone="running">수집 중</Chip>
          ) : null}
        </div>
        <Button aria-expanded={pasteOpen} aria-controls="paste-panel" onClick={onTogglePaste}>
          <Icon name="copy" size={16} />
          순위 붙여넣기
        </Button>
        <Button
          variant="primary"
          disabled={disabled}
          aria-describedby={disabledReason ? reasonId : undefined}
          onClick={onCollect}
        >
          <Icon name="refresh" size={16} />
          {collecting ? '요청 중…' : '수집'}
        </Button>
      </div>
      {disabledReason ? (
        <DisabledReason id={reasonId} className={styles.reason}>
          {disabledReason}
        </DisabledReason>
      ) : null}
      {collectError ? (
        <p role="alert" className={styles.error}>
          {collectError}
        </p>
      ) : null}
    </Panel>
  );
}
