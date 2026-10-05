import { useState } from 'react';
import {
  CANDIDATE_STATE_LABEL,
  candidateCounts,
  candidateRows,
  CANDIDATES_TITLE,
  candidatesSummaryText,
  candidateState,
  SELECTION_ORDER_TEXT,
  sourceText,
  type CandidateFilter,
  type TagCandidateItem,
  type TagSetOutput,
} from '@/features/tags';
import { Chip, DataTable, FilterToggleGroup, type DataTableColumn } from '@/shared/ui';
import styles from './TagsPage.module.css';

export interface CandidateTagsPanelProps {
  set: TagSetOutput | undefined;
  /** 여정의 지금 리프(요약의 카테고리 이름) */
  candidateLeaf: { leafCategoryId: string | null; wholeCategoryName: string | null } | null;
}

const STATE_TONE = { FINAL: 'done', OUT_OF_RANK: 'idle', EXCLUDED: 'failed' } as const;

const COLUMNS: readonly DataTableColumn<TagCandidateItem>[] = [
  {
    key: 'order',
    header: '순서',
    num: 'count',
    width: 48,
    value: (c) => c.finalOrder ?? null,
  },
  { key: 'text', header: '태그', cell: (c) => c.text },
  { key: 'source', header: '출처', width: 96, cell: (c) => sourceText(c) },
  {
    key: 'frequency',
    header: '빈도',
    num: 'count',
    width: 64,
    value: (c) => c.competitorFrequency ?? null,
  },
  {
    key: 'state',
    header: '상태',
    width: 88,
    cell: (c) => {
      const state = candidateState(c);
      return <Chip tone={STATE_TONE[state]}>{CANDIDATE_STATE_LABEL[state]}</Chip>;
    },
  },
];

/**
 * '후보 태그' 패널(Tags.dc.html): 거르기(전체·최종·순위 밖·뺌 — 개수), 표(순서·태그·출처·빈도·상태), 선정 순서 설명과 요약
 * ('추천 7(14:40 받음) · 경쟁 13 · 직접 1 · 카테고리 러닝화 기준 필터'). 시안의 '점수' 열은 M2(TG-03 점수화)라 그리지 않는다.
 */
export function CandidateTagsPanel({ set, candidateLeaf }: CandidateTagsPanelProps) {
  const [filter, setFilter] = useState<CandidateFilter>('FINAL');
  const candidates = set?.candidates ?? [];
  const counts = candidateCounts(candidates);
  return (
    <section aria-labelledby="cand-title" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 id="cand-title" className={styles.panelTitle}>
          {CANDIDATES_TITLE}
        </h2>
        <span className={styles.spacer} />
        <FilterToggleGroup<CandidateFilter>
          aria-label="후보 태그 거르기"
          value={filter}
          onValueChange={setFilter}
          items={[
            { value: 'ALL', label: '전체', count: counts.ALL },
            { value: 'FINAL', label: '최종', count: counts.FINAL },
            { value: 'OUT_OF_RANK', label: '순위 밖', count: counts.OUT_OF_RANK },
            { value: 'EXCLUDED', label: '뺌', count: counts.EXCLUDED },
          ]}
        />
      </div>
      <DataTable
        aria-labelledby="cand-title"
        columns={COLUMNS}
        rows={candidateRows(candidates, filter)}
        rowKey={(c) => c.id}
        empty={
          set ? '이 거르기에 맞는 태그가 없습니다.' : '⑦을 실행하면 후보 태그가 여기에 보입니다.'
        }
      />
      <div className={styles.footnotes}>
        <span className={styles.caption}>{SELECTION_ORDER_TEXT}</span>
        {set ? (
          <span className={styles.caption}>{candidatesSummaryText(set, candidateLeaf)}</span>
        ) : null}
      </div>
    </section>
  );
}
