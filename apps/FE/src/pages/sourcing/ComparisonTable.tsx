import { Fragment, useState } from 'react';
import {
  anchorMatchView,
  comparisonCaption,
  comparisonParams,
  comparisonSummaryText,
  isComparisonEditable,
  itemNameMarks,
  multiplierText,
  pointMultiplier,
  selectBlockedReason,
  selectionNote,
  targetSizeCount,
  unverifiedGroupText,
  verifiedGroupText,
  type ComparisonGender,
  type SourcingComparisonDetail,
  type SourcingComparisonRow,
  type SourcingRowPatch,
  useRequestStockCheck,
  useSelectSourcingRow,
  useUpdateSourcingRow,
} from '@/features/sourcing';
import { isApiRequestError } from '@/shared/api/errors';
import { formatCount, formatKstTime, formatYen } from '@/shared/lib/format';
import { cx } from '@/shared/lib/cx';
import { Button, Checkbox, Chip, Icon } from '@/shared/ui';
import { ComparisonRowDetail } from './ComparisonRowDetail';
import styles from './ComparisonTable.module.css';

const TITLE = '라쿠텐 후보 비교';
const COLUMNS = [
  { key: 'shop', header: '샵', width: 138, right: false },
  { key: 'anchor', header: '앵커 일치', width: 100, right: false },
  { key: 'stock', header: '목표 사이즈 재고', width: 88, right: true },
  { key: 'price', header: 'SKU가', width: 88, right: true },
  { key: 'shipping', header: '송료', width: 88, right: true },
  { key: 'points', header: '포인트', width: 114, right: true },
  { key: 'effective', header: '실질가', width: 96, right: true },
  { key: 'marks', header: '표시', width: 92, right: false },
  { key: 'at', header: '받은 시각', width: 66, right: true },
] as const;

/** 탐색 모드(앵커 전) 묶음 머리 */
function exploreGroupText(count: number): string {
  return `검색 결과 ${count} · 앵커(型番·색상)를 정하면 같은 상품만 모아 비교합니다. 상품명에 아동 단어가 있는 상품은 뺐습니다.`;
}

export interface ComparisonTableProps {
  candidateId: number | null;
  head: SourcingComparisonDetail | undefined;
  /** 조회 오류(404 '검색 전'은 빼고) */
  error: string | null;
  gender: ComparisonGender | null;
  includeNoMatch: boolean;
  onIncludeNoMatchChange: (value: boolean) => void;
  /** '38/110'(RAKUTEN_PAGE 오늘 조회) */
  usageText: string | null;
  /** 페이지를 읽을 수 없는 이유(하루 상한·쉼) */
  pageBlocked: string | null;
}

/**
 * SCR-03 '라쿠텐 후보 비교'(Sourcing.dc.html, F-SO-11·15·21·22·25~30, P2-03): 제목 + '불일치 결과도 보기', 실질가 캡션,
 * 표(샵·앵커 일치·목표 사이즈 재고·SKU가·송료·포인트·실질가·표시·받은 시각) — 묶음 머리 '검증 N'·'미검증 N'(앵커 전은
 * '검색 결과 N'), 행마다 라쿠텐 링크(새 창)·'선택'·'수동'·'추정'·'확인 필요' 칩. 검증 행은 서버 순서(재고 통과 → 실질가 낮은 순),
 * 미검증 행은 고를 수 없고 '재고 확인'만. 행을 펼치면 상품 줄(상품명·리뷰 수·평점·해외 배송 가능 — F-SO-28 열 중 보드 9열에
 * 없는 값, Proposed)·사이즈별 재고·쿠폰·배율·포인트 분해·같은 상품 판단(앵커와 나란히 + AI 참고). 샵 이름에 마우스를 올리면
 * 상품명. 아래 '다른 샵을 고르면…'과 크레딧(글자만 — 네이버 링크 없음, CON-14). 고르면 `selectSourcingComparisonRow`(② 완료).
 */
export function ComparisonTable({
  candidateId,
  head,
  error,
  gender,
  includeNoMatch,
  onIncludeNoMatchChange,
  usageText,
  pageBlocked,
}: ComparisonTableProps) {
  const params = comparisonParams(head);
  const select = useSelectSourcingRow();
  const stockCheck = useRequestStockCheck();
  const update = useUpdateSourcingRow(candidateId);
  const [expanded, setExpanded] = useState<number | null>(null);
  const editable = isComparisonEditable(head);
  const rows = head?.comparisonPerformed ? head.rows : [];
  const verified = rows.filter((r) => r.isVerified);
  const unverified = rows.filter((r) => !r.isVerified);
  const selectedRow = rows.find((r) => r.isSelected);
  const openId = expanded ?? selectedRow?.id ?? verified[0]?.id ?? null;
  const target = targetSizeCount(gender, params);

  const actionError = [select.error, stockCheck.error, update.error].find(Boolean);
  const actionMessage = actionError
    ? isApiRequestError(actionError)
      ? actionError.message
      : '요청을 처리하지 못했습니다.'
    : null;

  // 값을 바꾸거나 재고를 확인한 행은 순위가 바뀌어도 펼친 채 둔다(기본 펼침은 '첫 검증 행'이라 순위를 따라 옮겨 간다)
  const patchRow = (rowId: number, patch: SourcingRowPatch) => {
    setExpanded(rowId);
    select.reset();
    stockCheck.reset();
    update.mutate({ rowId, patch });
  };
  const checkStock = (rowId: number) => {
    setExpanded(rowId);
    select.reset();
    update.reset();
    stockCheck.mutate(rowId);
  };
  const choose = (row: SourcingComparisonRow) => {
    if (!head) return;
    stockCheck.reset();
    update.reset();
    select.mutate({ sourcingComparisonId: head.id, rowId: row.id });
  };

  const renderRow = (row: SourcingComparisonRow) => {
    const shopName = row.shopName ?? row.shopCode;
    const match = anchorMatchView(row);
    const blocked = head ? selectBlockedReason(row, head) : null;
    const isOpen = openId === row.id;
    const detailId = `sourcing-row-${row.id}-detail`;
    const marks = itemNameMarks(row.itemName);
    const unit = pointMultiplier(row, params);
    const shippingSource = row.shippingSource ?? null;
    const estimated =
      shippingSource === 'DEFAULT_ESTIMATE' || (!row.isVerified && row.apiPostageFlag !== 0);
    const shippingYen = row.isVerified
      ? (row.shippingYen ?? null)
      : row.apiPostageFlag === 0
        ? 0
        : row.apiPostageFlag === null || row.apiPostageFlag === undefined
          ? null
          : params.defaultShippingYen;
    const price = row.isVerified
      ? (row.representativePriceYen ?? null)
      : (row.apiItemPriceMin3Yen ?? row.apiItemPriceYen ?? null);
    const collectedAt = row.isVerified ? row.rakutenPageCollectedAt : row.apiCollectedAt;
    const checking = stockCheck.isPending && stockCheck.variables === row.id;
    return (
      <Fragment key={row.id}>
        <tr aria-label={shopName} className={cx(row.isSelected && styles.selected)}>
          <td className={styles.td}>
            <div className={styles.shop}>
              <input
                type="radio"
                name={`sourcing-pick-${head?.id ?? 0}`}
                aria-label={`${shopName} 고르기`}
                className={styles.radio}
                checked={row.isSelected}
                disabled={blocked !== null || select.isPending}
                title={blocked ?? undefined}
                onChange={() => choose(row)}
              />
              <button
                type="button"
                className={cx(styles.shopName, !row.isVerified && styles.muted)}
                aria-expanded={isOpen}
                aria-controls={isOpen ? detailId : undefined}
                title={row.itemName}
                onClick={() => setExpanded(isOpen ? -1 : row.id)}
              >
                {shopName}
              </button>
              <a
                href={row.itemUrl}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`${shopName} 상품을 라쿠텐에서 보기`}
                className={styles.link}
              >
                <Icon name="external" size={16} />
              </a>
              {row.isSelected ? <Chip tone="accent">선택</Chip> : null}
              {row.rowSource === 'MANUAL' ? <Chip tone="neutral">수동</Chip> : null}
            </div>
          </td>
          <td className={styles.td}>
            <div className={styles.match}>
              <Chip tone={match.tone} icon={match.tone === 'done' ? 'check' : undefined}>
                {match.label}
              </Chip>
              {match.note ? <span className={styles.note}>{match.note}</span> : null}
            </div>
          </td>
          <td className={cx(styles.td, styles.num)}>
            {row.isVerified && row.inStockSizeCount !== null && row.inStockSizeCount !== undefined
              ? `${row.inStockSizeCount}/${target ?? '—'}`
              : '—'}
          </td>
          <td className={cx(styles.td, styles.num)}>{price === null ? '—' : formatYen(price)}</td>
          <td className={cx(styles.td, styles.num)}>
            {shippingYen === null ? '—' : formatYen(shippingYen)}
            {shippingYen !== null && estimated ? (
              <span className={styles.estimate}> 추정</span>
            ) : null}
          </td>
          <td className={cx(styles.td, styles.num)}>
            {row.isVerified && row.pointsTotalPt !== null && row.pointsTotalPt !== undefined ? (
              <>
                <span className={styles.times}>{multiplierText(unit.total)}</span>{' '}
                {formatCount(row.pointsTotalPt)}pt
              </>
            ) : (
              '—'
            )}
          </td>
          <td className={cx(styles.td, styles.num, styles.effective)}>
            {row.isVerified ? (
              row.effectivePriceYen === null || row.effectivePriceYen === undefined ? (
                '—'
              ) : (
                formatYen(row.effectivePriceYen)
              )
            ) : head && !head.exploreMode ? (
              <Button
                size="sm"
                disabled={!editable || checking || pageBlocked !== null}
                title={pageBlocked ?? undefined}
                onClick={() => checkStock(row.id)}
              >
                {checking ? '읽는 중…' : '재고 확인'}
              </Button>
            ) : (
              '—'
            )}
          </td>
          <td className={styles.td}>
            {marks.length > 0 ? (
              <span className={styles.marks}>
                {marks.map((m) => (
                  <Chip key={m} tone="waiting">
                    {m}
                  </Chip>
                ))}
              </span>
            ) : (
              '—'
            )}
          </td>
          <td className={cx(styles.td, styles.num)}>
            {collectedAt ? formatKstTime(collectedAt) : '—'}
          </td>
        </tr>
        {isOpen ? (
          <tr className={cx(row.isSelected && styles.selected)}>
            <td id={detailId} colSpan={COLUMNS.length} className={styles.detailCell}>
              {head ? (
                <ComparisonRowDetail
                  head={head}
                  row={row}
                  gender={gender}
                  editable={editable}
                  usageText={usageText}
                  pageBlocked={pageBlocked}
                  stockCheckPending={checking}
                  savePending={update.isPending}
                  onStockCheck={() => checkStock(row.id)}
                  onPatch={(patch) => patchRow(row.id, patch)}
                />
              ) : null}
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  return (
    <section aria-labelledby="sourcing-cmp-title" className={styles.comparison}>
      <title>{`${TITLE} · 신발 자동등록`}</title>
      <div className={styles.cmpHead}>
        <div className={styles.titleRow}>
          <h1 id="sourcing-cmp-title" className={styles.title}>
            {TITLE}
          </h1>
          <span className={styles.screenId}>SCR-03</span>
          {head && !head.comparisonPerformed ? <Chip tone="outline">비교 안 함</Chip> : null}
        </div>
        {head?.comparisonPerformed ? (
          <Checkbox
            label="불일치 결과도 보기"
            checked={includeNoMatch}
            disabled={head.exploreMode}
            onChange={(e) => onIncludeNoMatchChange(e.target.checked)}
          />
        ) : null}
      </div>
      <p className={styles.caption}>{comparisonCaption(params.kRank)}</p>
      {error ? (
        <div className={styles.summary}>
          <span role="alert" className={styles.error}>
            {error}
          </span>
        </div>
      ) : !head || !head.comparisonPerformed || rows.length === 0 ? (
        <div className={styles.summary}>{comparisonSummaryText(head)}</div>
      ) : (
        <div className={styles.frame}>
          <table className={styles.table} aria-labelledby="sourcing-cmp-title">
            <colgroup>
              {COLUMNS.map((c) => (
                <col key={c.key} style={{ width: c.width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" className={cx(styles.th, c.right && styles.right)}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {head.exploreMode ? (
                <>
                  <tr>
                    <td colSpan={COLUMNS.length} className={styles.group}>
                      {exploreGroupText(rows.length)}
                    </td>
                  </tr>
                  {rows.map(renderRow)}
                </>
              ) : (
                <>
                  {verified.length > 0 ? (
                    <tr>
                      <td colSpan={COLUMNS.length} className={styles.group}>
                        {verifiedGroupText(verified.length)}
                      </td>
                    </tr>
                  ) : null}
                  {verified.map(renderRow)}
                  {unverified.length > 0 ? (
                    <tr>
                      <td colSpan={COLUMNS.length} className={styles.group}>
                        {unverifiedGroupText(unverified.length)}
                      </td>
                    </tr>
                  ) : null}
                  {unverified.map(renderRow)}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
      {actionMessage ? (
        <span role="alert" className={styles.error}>
          {actionMessage}
        </span>
      ) : null}
      {select.data?.g2Invalidated ? (
        <span className={styles.notice}>다른 샵으로 바꿔 판정(G2)을 다시 통과해야 합니다.</span>
      ) : null}
      {head ? (
        <div className={styles.footer}>
          <span className={styles.caption}>
            {head.comparisonPerformed ? selectionNote(params.minSizeCount) : ''}
          </span>
          <span className={styles.credit}>{head.creditText}</span>
        </div>
      ) : null}
    </section>
  );
}
