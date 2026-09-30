import {
  marginText,
  minimumPriceKrw,
  priceRuleLabel,
  summarySize,
  targetMarginPct,
  type PriceJudgementDetail,
} from '@/features/pricing';
import { EMPTY_VALUE, formatKrw } from '@/shared/lib/format';
import styles from './JudgementPage.module.css';

export interface PricingSummaryProps {
  /** 판정 스냅샷(없으면 — 입력 대기·실행 전 — 값 자리에 '—') */
  judgement: PriceJudgementDetail | undefined;
}

/**
 * ③ 가격 요약의 카드 3개(Judgement.dc.html '가격 요약' 오른쪽 셋, F-PJ-05·16·19): '최소 판매가 · 마진 10%'(판매 가능
 * 사이즈 P_min 중 가장 큰 값 — 판매가 하한), '판매가 · 국내가 −1%'(가격 책정 규칙), '순이익 · 마진율'(순이익이 가장 낮은 판매
 * 사이즈, 모드 A). 이 화면에서만 쓰는 조합이다(03-2 §2).
 */
export function PricingSummary({ judgement }: PricingSummaryProps) {
  const size = judgement ? summarySize(judgement) : null;
  const minPrice = judgement ? minimumPriceKrw(judgement) : null;
  return (
    <>
      <div className={styles.cell}>
        <span className={styles.cellLabel}>
          최소 판매가 · 마진 {judgement ? `${targetMarginPct(judgement)}%` : EMPTY_VALUE}
        </span>
        <span className={styles.cellValue}>
          <span className={styles.big}>
            {minPrice !== null ? formatKrw(minPrice) : EMPTY_VALUE}
          </span>
        </span>
      </div>
      <div className={styles.cell}>
        <span className={styles.cellLabel}>
          판매가 · {judgement ? priceRuleLabel(judgement) : '국내가 −1%'}
        </span>
        <span className={styles.cellValue}>
          <span className={styles.big}>
            {judgement?.salePriceKrw != null ? formatKrw(judgement.salePriceKrw) : EMPTY_VALUE}
          </span>
        </span>
      </div>
      <div className={styles.cell}>
        <span className={styles.cellLabel}>순이익 · 마진율</span>
        <span className={styles.cellValue}>
          <span className={styles.big}>
            {size?.profitAKrw != null ? formatKrw(size.profitAKrw) : EMPTY_VALUE}
          </span>
          <span className={styles.small}>{size ? marginText(size.marginRateA) : ''}</span>
        </span>
      </div>
    </>
  );
}
