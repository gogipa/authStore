import { Fragment, useState } from 'react';
import {
  anchorMatchView,
  canPickAnchor,
  comparisonCaption,
  comparisonParams,
  comparisonSummaryText,
  FOLDED_GROUP_NOTE,
  foldedGroupText,
  isComparisonEditable,
  isFoldedRow,
  itemNameMarks,
  lacksAnchorColorCode,
  lacksAnchorModelCode,
  multiplierText,
  NO_COLOR_CODE_NOTE,
  NO_MODEL_CODE_NOTE,
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
import { useDocumentTitle } from '@/shared/lib/appName';
import { cx } from '@/shared/lib/cx';
import { externalLinkProps, useDemo } from '@/shared/lib/demo';
import { formatCount, formatKstTime, formatYen } from '@/shared/lib/format';
import { Banner, Button, Checkbox, Chip, Disclosure, Icon } from '@/shared/ui';
import { ComparisonRowDetail } from './ComparisonRowDetail';
import { SearchResultList } from './SearchResultList';
import styles from './ComparisonTable.module.css';

/** 기준 상품을 정하기 전(상품 고르기 목록)과 정한 뒤(같은 상품을 파는 샵 표)의 제목(D-47) */
const PICK_TITLE = '상품 고르기';
const SHOP_TITLE = '같은 상품을 파는 샵 비교';
const COLUMNS = [
  { key: 'shop', header: '샵', width: 138, right: false },
  { key: 'anchor', header: '같은 상품인가', width: 100, right: false },
  { key: 'stock', header: '목표 사이즈 재고', width: 88, right: true },
  { key: 'price', header: '상품 가격', width: 88, right: true },
  { key: 'shipping', header: '일본 내 배송비', width: 88, right: true },
  { key: 'points', header: '포인트', width: 114, right: true },
  { key: 'effective', header: '실질가', width: 96, right: true },
  { key: 'marks', header: '주의 표시', width: 92, right: false },
  { key: 'at', header: '받은 시각', width: 66, right: true },
] as const;

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
 * ② 비교 칸(Sourcing.dc.html, F-SO-11·15·21·22·25~30, P2-03, D-47). 한 자리에 두 모습이 번갈아 나온다.
 * - 기준 상품 전(탐색 모드): '상품 고르기' — 쇼핑몰 같은 검색 결과 목록(SearchResultList). 표는 그리지 않는다(D-39)
 * - 기준 상품을 정한 뒤: '같은 상품을 파는 샵 비교' — 제목 + '다른 상품도 보기', 실질가 캡션, 표(샵·같은 상품인가·목표 사이즈 재고·
 *   상품 가격·일본 내 배송비·포인트·실질가·주의 표시·받은 시각). 묶음 머리 '재고 확인 N'·'아직 확인 안 함 N', 행마다 라쿠텐 링크(새 창)·
 *   '선택'·'수동'·'추정'·'확인 필요' 칩. 재고 확인 행은 서버 순서(재고 통과 → 실질가 낮은 순), 아직 확인 안 한 행은 고를 수 없고
 *   '재고 확인'만. 아직 읽지 않았고 같은 상품인지도 가리지 못한 행(확인 필요)은 '같은 상품인지 확실하지 않은 N개'로 접는다.
 *   모델 번호를 모르는 상품을 기준 상품으로 정했으면 위에 안내 띠. 행을 펼치면 상품 줄(상품명·리뷰 수·평점·해외 배송 가능 —
 *   F-SO-28 열 중 보드 9열에 없는 값, Proposed)·사이즈별 재고·쿠폰·배율·포인트 분해·같은 상품인가 판단(기준 상품과 나란히 + AI 참고).
 *   샵 이름에 마우스를 올리면 상품명. 아래 '다른 샵을 고르면…'과 크레딧(글자만 — 네이버 링크 없음, CON-14).
 *   고르면 `selectSourcingComparisonRow`(② 완료).
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
  // 기준 상품을 정하기 전(탐색 모드)에는 표를 그리지 않는다 — 고를 상품은 '상품 고르기' 목록에 있다(D-39·D-47)
  const exploring = !!head?.comparisonPerformed && head.exploreMode;
  const picking = canPickAnchor(head);
  const title = exploring ? PICK_TITLE : SHOP_TITLE;
  const pageTitle = useDocumentTitle(title);
  const demo = useDemo();
  const params = comparisonParams(head);
  const select = useSelectSourcingRow();
  const stockCheck = useRequestStockCheck();
  const update = useUpdateSourcingRow(candidateId);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [foldOpen, setFoldOpen] = useState(false);
  const editable = isComparisonEditable(head);
  const rows = head?.comparisonPerformed ? head.rows : [];
  const verified = rows.filter((r) => r.isVerified);
  // 같은 상품인지 확실하지 않은 행은 접어 둔다(D-47). 서버 순서는 그대로
  const folded = rows.filter(isFoldedRow);
  const unverified = rows.filter((r) => !r.isVerified && !isFoldedRow(r));
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
                {...externalLinkProps(row.itemUrl, demo)}
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
              {row.isVerified && row.stockPass === false ? (
                <>
                  <Chip tone="failed">재고 부족</Chip>
                  <span className={styles.noteWrap}>
                    재고 있는 사이즈 {row.inStockSizeCount ?? 0}개 · {params.minSizeCount}개 이상
                    필요
                  </span>
                </>
              ) : null}
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
      <title>{pageTitle}</title>
      <div className={styles.cmpHead}>
        <div className={styles.titleRow}>
          <h1 id="sourcing-cmp-title" className={styles.title}>
            {title}
          </h1>
          {head && !head.comparisonPerformed ? <Chip tone="outline">비교 안 함</Chip> : null}
        </div>
        {picking ? <Chip tone="outline">관련도 순 · {rows.length}건</Chip> : null}
        {head?.comparisonPerformed && !exploring ? (
          <Checkbox
            label="다른 상품도 보기"
            checked={includeNoMatch}
            onChange={(e) => onIncludeNoMatchChange(e.target.checked)}
          />
        ) : null}
      </div>
      {exploring ? null : <p className={styles.caption}>{comparisonCaption(params.kRank)}</p>}
      {lacksAnchorModelCode(head) ? <Banner tone="info">{NO_MODEL_CODE_NOTE}</Banner> : null}
      {lacksAnchorColorCode(head) ? <Banner tone="info">{NO_COLOR_CODE_NOTE}</Banner> : null}
      {error ? (
        <div className={styles.summary}>
          <span role="alert" className={styles.error}>
            {error}
          </span>
        </div>
      ) : picking && head ? (
        <SearchResultList head={head} />
      ) : !head || !head.comparisonPerformed || rows.length === 0 || exploring ? (
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
              {folded.length > 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className={styles.fold}>
                    <Disclosure
                      look="link"
                      title={foldedGroupText(folded.length)}
                      open={foldOpen}
                      onOpenChange={setFoldOpen}
                    >
                      <p className={styles.foldNote}>{FOLDED_GROUP_NOTE}</p>
                    </Disclosure>
                  </td>
                </tr>
              ) : null}
              {foldOpen ? folded.map(renderRow) : null}
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
        <span className={styles.notice}>
          다른 샵으로 바꿔 ③에서 소싱 확정(G2)을 다시 눌러야 합니다.
        </span>
      ) : null}
      {head ? (
        <div className={styles.footer}>
          <span className={styles.caption}>
            {head.comparisonPerformed && !exploring ? selectionNote(params.minSizeCount) : ''}
          </span>
          <span className={styles.credit}>{head.creditText}</span>
        </div>
      ) : null}
    </section>
  );
}
