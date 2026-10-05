import { type KeyboardEvent, useId } from 'react';
import { Link } from 'react-router';
import { EMPTY_STATE } from '@/features/guide';
import { cidLabel, type RankedKeyword, type SnapshotOrigin } from '@/features/keywords';
import { formatCount } from '@/shared/lib/format';
import {
  Button,
  ButtonLink,
  Chip,
  DataTable,
  type DataTableColumn,
  EmptyState,
  FilterToggleGroup,
  Radio,
} from '@/shared/ui';
import styles from './KeywordTable.module.css';

export type KeywordFilter = 'ALL' | 'EXCLUDED';

/** 한 페이지 줄 수(보드 '1–10 / 97'·'다음 10개') */
export const KEYWORD_PAGE_SIZE = 10;

export interface KeywordTableProps {
  /** 표 제목의 분야(여성신발·남성신발·분야 모름). 묶음이 없으면 null */
  field: string | null | undefined;
  rows: readonly RankedKeyword[];
  /** 지금 거르기(전체·제외됨)의 전체 줄 수 */
  total: number;
  /** 거르기 버튼의 개수(분야 기준) */
  counts: { all: number | undefined; excluded: number | undefined };
  filter: KeywordFilter;
  onFilterChange: (filter: KeywordFilter) => void;
  page: number;
  onPageChange: (page: number) => void;
  loading: boolean;
  /** 지금 고른 키워드(D-33 — 묶음에서 하나. 다른 쪽·다른 분야에 있으면 이 표에는 고른 줄이 없다) */
  selectedKeywordId: number | null;
  /** 줄을 골랐다(이미 고른 줄을 다시 눌러서는 부르지 않는다) */
  onSelect: (keyword: RankedKeyword) => void;
  /** 방금 고른 줄(응답이 오기 전에도 그 줄을 고른 줄로 보인다. 실패하면 null로 돌아와 앞 줄이 고른 줄이 된다) */
  pendingKeywordId: number | null;
  /** 고르기 오류(409 KEYWORD_EXCLUDED 등) */
  selectionError: string | null;
  hasSnapshot: boolean;
  /** 지금 보는 묶음이 방금 새로 받은 것인지 지난번에 받아 둔 것인지(묶음이 없으면 null) */
  origin?: SnapshotOrigin | null;
}

/** 키워드 고르기 라디오의 묶음 이름(한 표 = 한 묶음) */
const RADIO_NAME = 'keyword-pick';

/**
 * 방향키는 같은 표의 라디오 사이로 **초점만** 옮기고(맨 끝에서 돌아간다), 스페이스(기본 동작)·엔터로 고른다(Proposed, D-33).
 * 네이티브 라디오는 방향키가 곧 고르기라 줄을 지나칠 때마다 PUT과 G1 감사 기록이 생기기 때문이다.
 */
function onRadioKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  if (event.key === 'Enter') {
    event.preventDefault();
    input.click();
    return;
  }
  const step =
    event.key === 'ArrowDown' || event.key === 'ArrowRight'
      ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
        ? -1
        : 0;
  if (step === 0) return;
  event.preventDefault();
  const radios = Array.from(
    input
      .closest('table')
      ?.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${input.name}"]`) ?? [],
  );
  const at = radios.indexOf(input);
  if (at < 0 || radios.length < 2) return;
  radios[(at + step + radios.length) % radios.length]?.focus();
}

/**
 * SCR-02 키워드 표(Keywords.dc.html 아래 줄 왼쪽, F-KW-06~08). '{분야} 키워드 N개 · 순위순', 거르기 '전체'·'제외됨',
 * 열 순위·키워드(라디오 = G1 고르기, 하나만 — D-33)·상태('고름'·'여정 있음'), 10줄씩 넘긴다.
 * 보드(체크박스 + '동작' 열의 '검색어로 쓰기')와 다르다: 고르는 일이 곧 오른쪽 '라쿠텐 검색어 확인'에 쓰는 일이라 버튼을 합쳤다.
 * 아동화로 빠진 키워드는 '제외됨'에서만 보이고 고를 수 없다(라디오 없음). M2(분류 열·'우선 브랜드' 거르기)는 그리지 않는다.
 */
export function KeywordTable({
  field,
  rows,
  total,
  counts,
  filter,
  onFilterChange,
  page,
  onPageChange,
  loading,
  selectedKeywordId,
  onSelect,
  pendingKeywordId,
  selectionError,
  hasSnapshot,
  origin = null,
}: KeywordTableProps) {
  const titleId = `keyword-table-${useId()}`;
  const title = field === undefined ? '키워드' : `${cidLabel(field)} 키워드`;
  const from = total === 0 ? 0 : page * KEYWORD_PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * KEYWORD_PAGE_SIZE);
  const excludedView = filter === 'EXCLUDED';
  // 고르는 중인 줄이 있으면 그 줄을 고른 줄로 보인다(응답이 오면 서버 값과 같아지고, 실패하면 앞 줄로 돌아온다)
  const chosenId = pendingKeywordId ?? selectedKeywordId;

  const columns: DataTableColumn<RankedKeyword>[] = [
    { key: 'rank', header: '순위', num: 'count', value: (row) => row.rank, width: 64 },
    {
      key: 'keyword',
      header: '키워드',
      cell: (row) =>
        row.excludedReason ? (
          <span className={styles.keyword}>{row.keyword}</span>
        ) : (
          <Radio
            name={RADIO_NAME}
            aria-label={`${row.keyword} 고르기`}
            label={<span className={styles.keyword}>{row.keyword}</span>}
            checked={row.id === chosenId}
            onChange={() => {
              if (row.id !== chosenId) onSelect(row);
            }}
            onKeyDown={onRadioKeyDown}
          />
        ),
    },
    {
      key: 'status',
      header: '상태',
      width: 190,
      cell: (row) => (
        <div className={styles.status}>
          {row.excludedReason ? <Chip tone="waiting">아동용이라 제외</Chip> : null}
          {row.id === selectedKeywordId ? <Chip tone="accent">고름</Chip> : null}
          {row.candidateIds.length > 0 ? (
            <Link to={`/candidates?candidateId=${row.candidateIds[0]}`} className={styles.link}>
              여정 있음
            </Link>
          ) : null}
          {!row.excludedReason && row.id !== selectedKeywordId && row.candidateIds.length === 0 ? (
            <span className={styles.none}>—</span>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <section aria-labelledby={titleId} className={styles.section}>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <span className={styles.caption}>
            <span className={styles.num}>{formatCount(total)}</span>개 · 순위순
          </span>
        </div>
        <FilterToggleGroup<KeywordFilter>
          aria-label="목록 거르기"
          items={[
            { value: 'ALL', label: '전체', count: counts.all },
            { value: 'EXCLUDED', label: '제외됨', count: counts.excluded },
          ]}
          value={filter}
          onValueChange={onFilterChange}
        />
      </div>
      {origin ? (
        <p className={styles.origin}>
          <Chip tone={origin.tone}>{origin.label}</Chip>
          <span className={styles.caption}>{origin.detail}</span>
        </p>
      ) : null}
      <DataTable
        aria-labelledby={titleId}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        isRowSelected={(row) => row.id === chosenId}
        empty={
          loading ? (
            '불러오는 중입니다.'
          ) : !hasSnapshot ? (
            // 빈 상태 안내(F-GD-03, D-29): 수집·붙여넣기는 바로 위 패널, 키워드 없이 시작하는 입구 버튼
            <EmptyState
              title={EMPTY_STATE.keywords.title}
              actions={
                <ButtonLink to={EMPTY_STATE.keywords.primary.to} size="sm">
                  {EMPTY_STATE.keywords.primary.label}
                </ButtonLink>
              }
            >
              {EMPTY_STATE.keywords.text}
            </EmptyState>
          ) : excludedView ? (
            '아동용이라 빠진 키워드가 없습니다.'
          ) : (
            '표시할 키워드가 없습니다.'
          )
        }
      />
      {selectionError ? (
        <p role="alert" className={styles.error}>
          {selectionError}
        </p>
      ) : null}
      <div className={styles.foot}>
        <span className={styles.caption}>
          아동용 단어가 든 키워드{' '}
          <span className={styles.num}>{formatCount(counts.excluded ?? 0)}</span>
          개는 목록에서 빼고 &apos;제외됨&apos;에서만 보여 줍니다.
        </span>
        <div className={styles.pager}>
          <span className={styles.range}>
            {from}–{to} / {formatCount(total)}
          </span>
          {page > 0 ? (
            <Button size="sm" onClick={() => onPageChange(page - 1)}>
              이전 10개
            </Button>
          ) : null}
          <Button size="sm" disabled={to >= total} onClick={() => onPageChange(page + 1)}>
            다음 10개
          </Button>
        </div>
      </div>
    </section>
  );
}
