import { useId } from 'react';
import { dutyFreeLine, sizeTableRows, type PriceJudgementDetail } from '@/features/pricing';
import { cx } from '@/shared/lib/cx';
import { EMPTY_VALUE, formatKrw, formatYen } from '@/shared/lib/format';
import styles from './JudgementPage.module.css';

export interface SizeJudgementTableProps {
  judgement: PriceJudgementDetail;
}

/**
 * '사이즈별 판정'(Judgement.dc.html, F-PJ-08·09·11·15·17): 머리 문장 '면세 한도 US$145 · 1켤레 US$77.37(¥22,490까지 면세) ·
 * 2켤레면 과세' + 표(사이즈 · 재고 · 상품 가격 · 면세 · 최소 판매가 · 판정). 판정 행(재고 있는 목표 사이즈)과 판정하지 않은
 * 목표 사이즈(② 재고 칸 품절·取り寄せ·없음 — `unjudgedSizes`, P2-05 Proposed)를 사이즈 순으로 합친다. 150달러 ±5%면
 * '경계' 칩. 네이버쇼핑 링크는 이 영역에 두지 않는다(CON-14).
 */
export function SizeJudgementTable({ judgement }: SizeJudgementTableProps) {
  const titleId = useId();
  const rows = sizeTableRows(judgement);
  return (
    <section aria-labelledby={titleId} className={styles.sizeSection}>
      <div className={styles.sizeHead}>
        <h3 id={titleId} className={styles.panelTitle}>
          사이즈별 판정
        </h3>
        <span className={styles.caption}>{dutyFreeLine(judgement)}</span>
      </div>
      <div role="table" aria-labelledby={titleId} className={styles.table}>
        <div role="row" className={cx(styles.tr, styles.th)}>
          <span role="columnheader">사이즈</span>
          <span role="columnheader">재고</span>
          <span role="columnheader" className={styles.num}>
            상품 가격
          </span>
          <span role="columnheader">면세</span>
          <span role="columnheader" className={styles.num}>
            최소 판매가
          </span>
          <span role="columnheader">판정</span>
        </div>
        {rows.map((row) => (
          <div role="row" key={row.sizeMm} className={styles.tr}>
            <span role="cell" className={styles.mono}>
              {row.sizeMm}mm
            </span>
            <span role="cell">{row.stock}</span>
            <span role="cell" className={styles.num}>
              {row.skuPriceYen !== null ? formatYen(row.skuPriceYen) : EMPTY_VALUE}
            </span>
            <span role="cell" className={styles.dutyCell}>
              {row.duty ? (
                <span className={row.duty === '면세' ? styles.dutyFree : styles.taxable}>
                  {row.duty}
                </span>
              ) : (
                EMPTY_VALUE
              )}
              {row.boundary ? <span className={styles.boundary}>경계</span> : null}
            </span>
            <span role="cell" className={styles.num}>
              {row.pMinKrw !== null ? formatKrw(row.pMinKrw) : EMPTY_VALUE}
            </span>
            <span role="cell" className={row.sellable ? undefined : styles.muted}>
              {row.verdict}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
