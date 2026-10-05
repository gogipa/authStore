import { useState } from 'react';
import {
  type KeywordCollectionAccepted,
  type KeywordSnapshot,
  type RankedKeyword,
  useCreateKeywordSnapshotMutation,
  useKeywordCollectionEvents,
  useKeywordCollectionStatusQuery,
  useKeywordSnapshotQuery,
  useKeywordSnapshotsQuery,
  useSelectKeywordMutation,
  snapshotOrigin,
  useSnapshotKeywordsQuery,
} from '@/features/keywords';
import { ScreenHelp } from '@/features/guide';
import { PageHeader } from '@/shared/ui';
import { ChildTermsPanel } from './ChildTermsPanel';
import { type CollectAbortInfo, CollectPanel } from './CollectPanel';
import { KEYWORD_PAGE_SIZE, type KeywordFilter, KeywordTable } from './KeywordTable';
import { type PasteCid, PastePanel } from './PastePanel';
import { RakutenQueryPanel } from './RakutenQueryPanel';
import styles from './KeywordsPage.module.css';

const DESCRIPTION =
  '데이터랩 인기 검색어를 모아 소싱할 키워드를 하나 고르고, 라쿠텐 검색어를 확인합니다.';

/**
 * SCR-02 키워드(Keywords.dc.html, P2-01). 패널을 배치만 한다:
 * - 위 줄: 데이터랩 수집(분야·기간·범위·진행률·'수집') | 순위 붙여넣기(열고 닫는다 — 수집이 중단되거나 쉬는 중이면 저절로 연다)
 * - 아래 줄: 키워드 표(라디오로 하나 고르기 = G1) | 라쿠텐 검색어 확인(고른 키워드 → '이 검색어로 소싱') · 아동 단어
 * 보이는 묶음은 방금 만든 묶음, 없으면 가장 최근 묶음(`listKeywordSnapshots` size=1). M2(세부 분류·기기·성별·연령·분류 열·
 * 우선 브랜드·'우선·제외 목록' 패널·사전 제안)는 그리지 않는다.
 *
 * D-33 — 키워드는 하나만 고른다. '지금 고른 키워드'는 묶음 조회(`getKeywordSnapshot`)의 `selectedKeyword`(묶음에서 `selectedAt`이
 * 가장 늦은 키워드)이고, 표의 선택 줄과 오른쪽 검색어 확인이 모두 이 값을 따른다 — 새로고침해도 같은 줄이 고른 줄이다. 보드의
 * '검색어로 쓰기' 버튼은 고르기와 뜻이 같아 합쳤다(고르면 바로 오른쪽에 나온다). 고르기 취소는 부르지 않는다.
 */
export function KeywordsPage() {
  const [viewSnapshotId, setViewSnapshotId] = useState<number | null>(null);
  const [fieldChoice, setFieldChoice] = useState<string | null | undefined>(undefined);
  const [filter, setFilter] = useState<KeywordFilter>('ALL');
  const [page, setPage] = useState(0);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [autoOpenedFor, setAutoOpenedFor] = useState<string | null>(null);
  // 방금 고른 줄(응답이 오기 전). 라디오가 눌린 그 자리에서 바로 바뀌어 보이게 화면 상태로 둔다 — 응답이 오면 서버 값이 되고, 실패하면 앞 줄로 돌아온다
  const [pickedKeywordId, setPickedKeywordId] = useState<number | null>(null);

  const latest = useKeywordSnapshotsQuery({ page: 0, size: 1 });
  const status = useKeywordCollectionStatusQuery();
  const { progress, start } = useKeywordCollectionEvents();
  const collect = useCreateKeywordSnapshotMutation();
  const pasteMutation = useCreateKeywordSnapshotMutation();
  const select = useSelectKeywordMutation();

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
  // 처음 열면 가장 최근 묶음(= 지난번에 받아 둔 순위). 이 화면에서 [수집]·붙여넣기로 만든 묶음만 '방금 받은 순위'다
  const origin = snapshot
    ? snapshotOrigin(snapshot, viewSnapshotId !== null && viewSnapshotId === snapshot.id)
    : null;

  // 지금 고른 키워드(D-33): 묶음에서 하나. 표가 쪽·분야로 나뉘어도 같은 값이라 새로고침 뒤에도 결정된다
  const selectedKeyword: RankedKeyword | null = detail.data?.selectedKeyword ?? null;

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
    select.reset();
    setViewSnapshotId(id);
    setFieldChoice(undefined);
    setFilter('ALL');
    setPage(0);
  };

  const onCollect = () =>
    collect.mutate(
      { method: 'BUTTON', rankLimit: 100 },
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

  const onSelect = (row: RankedKeyword) => {
    if (row.excludedReason !== null) return;
    setPickedKeywordId(row.id);
    select.mutate(row.id, {
      onSettled: () => setPickedKeywordId((current) => (current === row.id ? null : current)),
    });
  };

  const selectionError = select.error?.message ?? null;
  const pasteError = pasteMutation.error
    ? {
        message: pasteMutation.error.message,
        lines: (pasteMutation.error.envelope.fieldErrors ?? []).map((e) => e.message),
      }
    : null;

  return (
    <>
      <PageHeader
        title="키워드"
        description={DESCRIPTION}
        help={<ScreenHelp screen="keywords" />}
      />
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
          selectedKeywordId={selectedKeyword?.id ?? null}
          onSelect={onSelect}
          pendingKeywordId={pickedKeywordId}
          selectionError={selectionError}
          hasSnapshot={snapshotId !== null}
          origin={origin}
        />
        <div className={styles.side}>
          <RakutenQueryPanel keyword={selectedKeyword} />
          <ChildTermsPanel />
        </div>
      </div>
    </>
  );
}
