import { useId, useState } from 'react';
import {
  MODEL_ENTRY_TOGGLE,
  SEARCH_LIST_EMPTY,
  SEARCH_LIST_NOTE,
  SEARCH_MORE_NOTHING_ADDED,
  useFixSourcingAnchor,
  useLoadMoreSourcingSearchRows,
  type SourcingComparisonDetail,
  type SourcingComparisonRow,
} from '@/features/sourcing';
import { isApiRequestError } from '@/shared/api/errors';
import { formatYen } from '@/shared/lib/format';
import { Button, TextField } from '@/shared/ui';
import { ProductPhoto } from './ProductPhoto';
import styles from './SearchResultList.module.css';

export interface SearchResultListProps {
  /** 기준 상품을 정하기 전(탐색 모드)·입력을 기다리는 현재 검색 버전의 비교표 머리 */
  head: SourcingComparisonDetail;
}

function messageOf(error: unknown, fallback: string): string {
  return isApiRequestError(error) ? error.message : fallback;
}

/**
 * ② '상품 고르기' 목록(D-47): 일반 쇼핑몰처럼 라쿠텐 검색 결과를 관련도 순 목록으로 보이고 하나를 고른다.
 * 한 줄 = 사진 · 상품명(일본어, 2줄까지) · 가격 · 샵 · (뽑았으면) 모델 번호 · [이 상품으로 정하기](`fixSourcingAnchor` SEARCH_PICK).
 * 맨 위 항목을 미리 고르지 않는다. 아래: [더 보기](다음 30건 — `hasMore:false`를 받으면 이 비교 버전에서는 숨긴다) ·
 * '찾는 상품이 없나요? 모델 번호로 직접 찾기'(모델 번호·색상 번호 칸 + [이 모델 번호로 정하기] — CODE_ENTRY).
 * 검색 결과가 0건이면 모델 번호 입력만 보인다. 정하면 비교표가 같은 상품을 파는 샵 표로 바뀐다(`head.exploreMode`가 꺼진다)
 */
export function SearchResultList({ head }: SearchResultListProps) {
  const uid = useId();
  const fix = useFixSourcingAnchor();
  const more = useLoadMoreSourcingSearchRows();
  // 더 불러올 것이 없다고 답받은 비교 버전. `head.id`가 바뀌면 저절로 풀린다
  const [exhaustedId, setExhaustedId] = useState<number | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [modelCode, setModelCode] = useState('');
  const [colorCode, setColorCode] = useState('');

  const rows = head.rows;
  const hasRows = rows.length > 0;
  const noMore = exhaustedId === head.id;
  const entryShown = !hasRows || entryOpen;
  const entryId = `${uid}-entry`;
  const model = modelCode.trim();
  const color = colorCode.trim() === '' ? null : colorCode.trim();
  const variables = fix.variables?.body;
  const pickingItem =
    fix.isPending && variables?.anchorInputMethod === 'SEARCH_PICK'
      ? variables.anchorItemCode
      : null;
  const pickingCode = fix.isPending && variables?.anchorInputMethod === 'CODE_ENTRY';

  const pick = (row: SourcingComparisonRow) => {
    if (fix.isPending) return;
    fix.mutate({
      sourcingComparisonId: head.id,
      body: { anchorInputMethod: 'SEARCH_PICK', anchorItemCode: row.itemCode },
    });
  };
  const submitCode = () => {
    if (model === '' || fix.isPending) return;
    fix.mutate({
      sourcingComparisonId: head.id,
      body: { anchorInputMethod: 'CODE_ENTRY', anchorModelCode: model, anchorColorCode: color },
    });
  };
  const loadMore = () => {
    more.mutate(head.id, {
      onSuccess: (result) => {
        if (!result.hasMore) setExhaustedId(head.id);
      },
    });
  };

  const fixError = fix.error ? messageOf(fix.error, '기준 상품을 정하지 못했습니다.') : null;
  const moreError = more.error
    ? messageOf(more.error, '검색 결과를 더 불러오지 못했습니다.')
    : null;

  return (
    <div className={styles.picker}>
      <p className={styles.note}>{hasRows ? SEARCH_LIST_NOTE : SEARCH_LIST_EMPTY}</p>
      {fixError ? (
        <span role="alert" className={styles.error}>
          {fixError}
        </span>
      ) : null}
      {hasRows ? (
        <ul aria-label="라쿠텐 검색 결과" className={styles.list}>
          {rows.map((row) => {
            const nameId = `${uid}-name-${row.id}`;
            const shop = row.shopName ?? row.shopCode;
            const price = row.apiItemPriceYen ?? null;
            return (
              <li key={row.id} aria-labelledby={nameId} className={styles.item}>
                <ProductPhoto url={row.imageUrl} />
                <div className={styles.info}>
                  <span id={nameId} className={styles.name} title={row.itemName}>
                    {row.itemName}
                  </span>
                  <span className={styles.meta}>
                    <span className={styles.price}>{price === null ? '—' : formatYen(price)}</span>
                    <span>{shop}</span>
                    {row.modelCodeNorm ? <span>모델 번호 {row.modelCodeNorm}</span> : null}
                  </span>
                </div>
                <Button
                  size="sm"
                  disabled={fix.isPending}
                  aria-describedby={nameId}
                  onClick={() => pick(row)}
                >
                  {pickingItem === row.itemCode ? '정하는 중…' : '이 상품으로 정하기'}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {hasRows ? (
        <div className={styles.more}>
          {noMore ? null : (
            <Button disabled={more.isPending || fix.isPending} onClick={loadMore}>
              {more.isPending ? '불러오는 중…' : '더 보기'}
            </Button>
          )}
          {more.isSuccess && more.data.addedRowCount === 0 && !noMore ? (
            <span role="status" className={styles.hint}>
              {SEARCH_MORE_NOTHING_ADDED}
            </span>
          ) : null}
          {moreError ? (
            <span role="alert" className={styles.error}>
              {moreError}
            </span>
          ) : null}
        </div>
      ) : null}
      {hasRows ? (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={entryOpen}
          aria-controls={entryOpen ? entryId : undefined}
          onClick={() => setEntryOpen(!entryOpen)}
        >
          {MODEL_ENTRY_TOGGLE}
        </button>
      ) : null}
      {entryShown ? (
        <div id={entryId} className={styles.entry}>
          <TextField
            label="모델 번호(型番)"
            mono
            value={modelCode}
            placeholder="예: 1201A019"
            onChange={(e) => setModelCode(e.target.value)}
            className={styles.code}
          />
          <TextField
            label="색상 번호(선택)"
            mono
            value={colorCode}
            placeholder="예: 108"
            onChange={(e) => setColorCode(e.target.value)}
            className={styles.code}
          />
          <Button variant="primary" disabled={model === '' || fix.isPending} onClick={submitCode}>
            {pickingCode ? '정하는 중…' : '이 모델 번호로 정하기'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
