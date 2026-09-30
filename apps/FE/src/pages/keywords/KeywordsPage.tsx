import { useState } from 'react';
import {
  type KeywordCollectionAccepted,
  type KeywordSnapshot,
  type RankedKeyword,
  type RankLimit,
  useCreateKeywordSnapshotMutation,
  useKeywordCollectionEvents,
  useKeywordCollectionStatusQuery,
  useKeywordSnapshotQuery,
  useKeywordSnapshotsQuery,
  useSelectKeywordMutation,
  useSnapshotKeywordsQuery,
  useUnselectKeywordMutation,
} from '@/features/keywords';
import { PageHeader } from '@/shared/ui';
import { ChildTermsPanel } from './ChildTermsPanel';
import { type CollectAbortInfo, CollectPanel } from './CollectPanel';
import { KEYWORD_PAGE_SIZE, type KeywordFilter, KeywordTable } from './KeywordTable';
import { type PasteCid, PastePanel } from './PastePanel';
import { RakutenQueryPanel } from './RakutenQueryPanel';
import styles from './KeywordsPage.module.css';

const DESCRIPTION =
  '데이터랩 인기 검색어를 모아 소싱할 키워드를 고르고, 라쿠텐 검색어를 확인합니다.';

/**
 * SCR-02 키워드(Keywords.dc.html, P2-01). 패널을 배치만 한다:
 * - 위 줄: 데이터랩 수집(분야·기간·범위·진행률·'수집') | 순위 붙여넣기(열고 닫는다 — 수집이 중단되거나 쉬는 중이면 저절로 연다)
 * - 아래 줄: 키워드 표(G1 체크·'검색어로 쓰기') | 라쿠텐 검색어 확인(G1 → '이 검색어로 소싱') · 아동 단어
 * 보이는 묶음은 방금 만든 묶음, 없으면 가장 최근 묶음(`listKeywordSnapshots` size=1). M2(세부 분류·기기·성별·연령·분류 열·
 * 우선 브랜드·'우선·제외 목록' 패널·사전 제안)는 그리지 않는다.
 */
export function KeywordsPage() {
  const [viewSnapshotId, setViewSnapshotId] = useState<number | null>(null);
  const [fieldChoice, setFieldChoice] = useState<string | null | undefined>(undefined);
  const [filter, setFilter] = useState<KeywordFilter>('ALL');
  const [page, setPage] = useState(0);
  const [rankLimit, setRankLimit] = useState<RankLimit>(100);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [autoOpenedFor, setAutoOpenedFor] = useState<string | null>(null);
  const [activeKeyword, setActiveKeyword] = useState<RankedKeyword | null>(null);

  const latest = useKeywordSnapshotsQuery({ page: 0, size: 1 });
  const status = useKeywordCollectionStatusQuery();
  const { progress, start } = useKeywordCollectionEvents();
  const collect = useCreateKeywordSnapshotMutation();
  const pasteMutation = useCreateKeywordSnapshotMutation();
  const select = useSelectKeywordMutation();
  const unselect = useUnselectKeywordMutation();

  const latestSnapshot = latest.data?.content[0];
  const snapshotId = viewSnapshotId ?? latestSnapshot?.id ?? null;
  const detail = useKeywordSnapshotQuery(snapshotId);
  const snapshot: KeywordSnapshot | undefined =
    detail.data ?? (latestSnapshot?.id === snapshotId ? latestSnapshot : undefined);

  // 분야: 버튼 수집은 두 분야, 붙여넣기는 고른 분야 하나(모름이면 null 하나)
  const fieldOptions: (string | null)[] = snapshot
    ? snapshot.requestedCids.length > 0
      ? [...snapshot.requestedCids]
      : [null]
    : [];
  const field =
    fieldChoice !== undefined && fieldOptions.includes(fieldChoice) ? fieldChoice : fieldOptions[0];
  const cidQuery = field ? { cid: field } : {};

  const keywords = useSnapshotKeywordsQuery(snapshotId, {
    page,
    size: KEYWORD_PAGE_SIZE,
    excluded: filter === 'EXCLUDED',
    ...cidQuery,
  });
  const allCount = useSnapshotKeywordsQuery(snapshotId, { size: 1, excluded: false, ...cidQuery });
  const excludedCount = useSnapshotKeywordsQuery(snapshotId, {
    size: 1,
    excluded: true,
    ...cidQuery,
  });
  const rows = keywords.data?.content ?? [];

  // 오른쪽 검색어 확인에 보일 키워드: '검색어로 쓰기'로 고른 것(표에 있으면 새 값), 없으면 이 페이지에서 고른 첫 줄
  const active =
    (activeKeyword && rows.find((r) => r.id === activeKeyword.id)) ??
    activeKeyword ??
    rows.find((r) => r.selectedAt !== null && r.excludedReason === null) ??
    null;

  // 중단 경고: 이 묶음의 SSE aborted(바로) 또는 묶음 조회(다시 열었을 때)
  const abort: CollectAbortInfo | null =
    progress?.phase === 'aborted' && progress.aborted && progress.keywordSnapshotId === snapshotId
      ? {
          abortReason: progress.aborted.abortReason,
          blockedUntil: progress.aborted.blockedUntil,
          structureChangeSuspected: progress.aborted.structureChangeSuspected,
        }
      : detail.data?.status === 'ABORTED'
        ? {
            abortReason: detail.data.abortReason ?? null,
            blockedUntil: detail.data.blockedUntil ?? null,
            structureChangeSuspected: detail.data.structureChangeSuspected,
          }
        : null;

  // 수집이 중단되거나 24시간 쉼이면 붙여넣기 패널을 한 번 저절로 연다(F-KW-04 '붙여넣기 입력란을 연다')
  const autoOpenKey = abort
    ? `abort-${snapshotId}`
    : status.data?.disabledReasonCode === 'EXTERNAL_CALL_COOLDOWN'
      ? 'cooldown'
      : null;
  if (autoOpenKey !== null && autoOpenKey !== autoOpenedFor) {
    setAutoOpenedFor(autoOpenKey);
    setPasteOpen(true);
  }

  const showSnapshot = (id: number) => {
    setViewSnapshotId(id);
    setFieldChoice(undefined);
    setFilter('ALL');
    setPage(0);
  };

  const onCollect = () =>
    collect.mutate(
      { method: 'BUTTON', rankLimit },
      {
        onSuccess: (res) => {
          const accepted = res as KeywordCollectionAccepted;
          start(accepted);
          showSnapshot(accepted.keywordSnapshotId);
        },
      },
    );

  const onPaste = (text: string, cid: PasteCid) =>
    pasteMutation.mutate(
      { method: 'PASTE', text, cid },
      { onSuccess: (res) => showSnapshot((res as KeywordSnapshot).id) },
    );

  const onToggleSelect = (row: RankedKeyword, selected: boolean) => {
    if (selected) {
      unselect.reset();
      select.mutate(row.id, { onSuccess: (updated) => setActiveKeyword(updated) });
    } else {
      select.reset();
      unselect.mutate(row.id, {
        onSuccess: () => {
          if (activeKeyword?.id === row.id) setActiveKeyword({ ...row, selectedAt: null });
        },
      });
    }
  };

  const onUseAsQuery = (row: RankedKeyword) => {
    if (row.selectedAt !== null) {
      setActiveKeyword(row);
      return;
    }
    unselect.reset();
    select.mutate(row.id, { onSuccess: (updated) => setActiveKeyword(updated) });
  };

  const pendingKeywordId = select.isPending
    ? (select.variables ?? null)
    : unselect.isPending
      ? (unselect.variables ?? null)
      : null;
  const selectionError = select.error?.message ?? unselect.error?.message ?? null;
  const pasteError = pasteMutation.error
    ? {
        message: pasteMutation.error.message,
        lines: (pasteMutation.error.envelope.fieldErrors ?? []).map((e) => e.message),
      }
    : null;

  return (
    <>
      <PageHeader title="키워드" screenId="SCR-02" description={DESCRIPTION} />
      <div className={styles.top}>
        <CollectPanel
          status={status.data}
          progress={progress}
          fieldOptions={fieldOptions}
          field={field ?? null}
          onFieldChange={(cid) => {
            setFieldChoice(cid);
            setPage(0);
          }}
          rankLimit={rankLimit}
          onRankLimitChange={setRankLimit}
          onCollect={onCollect}
          collecting={collect.isPending}
          collectError={collect.error?.message ?? null}
          pasteOpen={pasteOpen}
          onTogglePaste={() => setPasteOpen((open) => !open)}
          abort={abort}
        />
        {pasteOpen ? (
          <PastePanel
            onSubmit={onPaste}
            onClose={() => setPasteOpen(false)}
            pending={pasteMutation.isPending}
            error={pasteError}
          />
        ) : null}
      </div>
      <div className={styles.bottom}>
        <KeywordTable
          field={snapshot ? (field ?? null) : undefined}
          rows={rows}
          total={keywords.data?.page.totalElements ?? 0}
          counts={{
            all: allCount.data?.page.totalElements,
            excluded: excludedCount.data?.page.totalElements,
          }}
          filter={filter}
          onFilterChange={(next) => {
            setFilter(next);
            setPage(0);
          }}
          page={page}
          onPageChange={setPage}
          loading={keywords.isPending && snapshotId !== null}
          activeKeywordId={active?.id ?? null}
          onToggleSelect={onToggleSelect}
          onUseAsQuery={onUseAsQuery}
          pendingKeywordId={pendingKeywordId}
          selectionError={selectionError}
          hasSnapshot={snapshotId !== null}
        />
        <div className={styles.side}>
          <RakutenQueryPanel keyword={active} />
          <ChildTermsPanel />
        </div>
      </div>
    </>
  );
}
