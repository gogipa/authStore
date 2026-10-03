import { useId } from 'react';
import { Link } from 'react-router';
import { EMPTY_STATE } from '@/features/guide';
import { cidLabel, type RankedKeyword } from '@/features/keywords';
import { formatCount } from '@/shared/lib/format';
import {
  Button,
  ButtonLink,
  Checkbox,
  Chip,
  DataTable,
  type DataTableColumn,
  EmptyState,
  FilterToggleGroup,
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
  /** '검색어로 쓰기'로 고른 줄(오른쪽 '라쿠텐 검색어 확인') */
  activeKeywordId: number | null;
  onToggleSelect: (keyword: RankedKeyword, selected: boolean) => void;
  onUseAsQuery: (keyword: RankedKeyword) => void;
  /** 고르기 요청 중인 줄 */
  pendingKeywordId: number | null;
  /** 고르기·취소 오류(409 KEYWORD_IN_USE 등) */
  selectionError: string | null;
  hasSnapshot: boolean;
}

/**
 * SCR-02 키워드 표(Keywords.dc.html 아래 줄 왼쪽, F-KW-06~08). '{분야} 키워드 N개 · 순위순', 거르기 '전체'·'제외됨',
 * 열 순위·키워드(체크 = G1 고르기)·상태('고름'·'후보 있음')·동작('검색어로 쓰기'), 10줄씩 넘긴다.
 * 아동화로 빠진 키워드는 '제외됨'에서만 보이고 고를 수 없다. M2(분류 열·'우선 브랜드' 거르기)는 그리지 않는다.
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
  activeKeywordId,
  onToggleSelect,
  onUseAsQuery,
  pendingKeywordId,
  selectionError,
  hasSnapshot,
}: KeywordTableProps) {
  const titleId = `keyword-table-${useId()}`;
  const title = field === undefined ? '키워드' : `${cidLabel(field)} 키워드`;
  const from = total === 0 ? 0 : page * KEYWORD_PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * KEYWORD_PAGE_SIZE);
  const excludedView = filter === 'EXCLUDED';

  const columns: DataTableColumn<RankedKeyword>[] = [
    { key: 'rank', header: '순위', num: 'count', value: (row) => row.rank, width: 64 },
    {
      key: 'keyword',
      header: '키워드',
      cell: (row) =>
        row.excludedReason ? (
          <span className={styles.keyword}>{row.keyword}</span>
        ) : (
          <Checkbox
            label={<span className={styles.keyword}>{row.keyword}</span>}
            checked={row.selectedAt !== null}
            disabled={pendingKeywordId === row.id}
            onChange={(e) => onToggleSelect(row, e.target.checked)}
          />
        ),
    },
    {
      key: 'status',
      header: '상태',
      width: 190,
      cell: (row) => (
        <div className={styles.status}>
          {row.excludedReason ? <Chip tone="waiting">아동 단어</Chip> : null}
          {row.selectedAt ? <Chip tone="accent">고름</Chip> : null}
          {row.candidateIds.length > 0 ? (
            <Link to={`/candidates?candidateId=${row.candidateIds[0]}`} className={styles.link}>
              후보 있음
            </Link>
          ) : null}
          {!row.excludedReason && !row.selectedAt && row.candidateIds.length === 0 ? (
            <span className={styles.none}>—</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'action',
      header: '동작',
      width: 136,
      cell: (row) =>
        row.excludedReason ? null : (
          <Button
            size="sm"
            aria-pressed={row.id === activeKeywordId}
            className={row.id === activeKeywordId ? styles.pressed : undefined}
            onClick={() => onUseAsQuery(row)}
          >
            검색어로 쓰기
          </Button>
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
      <DataTable
        aria-labelledby={titleId}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        isRowSelected={(row) => row.id === activeKeywordId}
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
            '아동 단어로 빠진 키워드가 없습니다.'
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
          아동 키워드 <span className={styles.num}>{formatCount(counts.excluded ?? 0)}</span>개는
          목록에서 빼고 &apos;제외됨&apos;에서만 보여 줍니다.
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
