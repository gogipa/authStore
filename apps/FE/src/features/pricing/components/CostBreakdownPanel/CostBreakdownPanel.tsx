import { useId } from 'react';
import { formatKrw } from '@/shared/lib/format';
import { Chip } from '@/shared/ui';
import {
  breakdownCaption,
  breakdownLines,
  marginText,
  modeBSentence,
  pointsSentence,
  summarySize,
  type PriceJudgementDetail,
} from '../../model/judgement';
import styles from './CostBreakdownPanel.module.css';

export interface CostBreakdownPanelProps {
  judgement: PriceJudgementDetail;
  /** 배대지 줄 캡션(예 '요금표 v2026-09 · 1.2kg', 요금표가 없으면 '요금표 없음') */
  forwarderNote: string;
}

/**
 * '비용 분해' 패널(SCR-04, F-PJ-19, P2-05): 판매 사이즈 공통(다르면 순이익이 가장 낮은 사이즈) 1켤레의 물품가(¥ × 원가 환율)·
 * 카드 가산·배대지·관부가세·기타비용·판매수수료·Npay 수수료·부가세(모드 A), 순이익·마진율, 포인트 참고 문장, 모드 B 문장.
 * 가정값(기본 배대지비·기타비용)에는 '가정값' 칩(`Chip`), 추정 송료에는 '송료 추정' 칩. '판매가를 바꿔 계산해 보기'는 M2.
 */
export function CostBreakdownPanel({ judgement, forwarderNote }: CostBreakdownPanelProps) {
  const titleId = useId();
  const size = summarySize(judgement);
  const points = pointsSentence(size, judgement);
  return (
    <section aria-labelledby={titleId} className={styles.panel}>
      <div className={styles.head}>
        <h3 id={titleId} className={styles.title}>
          비용 분해
        </h3>
        <span className={styles.caption}>{breakdownCaption(judgement)}</span>
      </div>
      {judgement.shippingEstimated ? (
        <p className={styles.chips}>
          <Chip tone="outline">송료 추정</Chip>
          <span className={styles.caption}>일본 내 송료를 모를 때 기본 송료로 계산했습니다.</span>
        </p>
      ) : null}
      {size ? (
        <>
          <dl className={styles.lines}>
            {breakdownLines(judgement, size, forwarderNote).map((line) => (
              <div key={line.key} className={styles.line}>
                <dt className={styles.term}>
                  {line.label}
                  {line.note ? <span className={styles.note}>{line.note}</span> : null}
                  {line.assumed ? <Chip tone="outline">가정값</Chip> : null}
                </dt>
                <dd className={styles.value}>{formatKrw(line.valueKrw)}</dd>
              </div>
            ))}
          </dl>
          <div className={styles.total}>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>순이익 · 마진율</span>
              <span className={styles.totalValue}>
                {typeof size.profitAKrw === 'number' ? formatKrw(size.profitAKrw) : '—'} ·{' '}
                {marginText(size.marginRateA)}
              </span>
            </div>
            {points ? <span className={styles.caption}>{points}</span> : null}
          </div>
        </>
      ) : (
        <p className={styles.empty}>
          판매 가능 사이즈가 없어 비용을 나눠 보일 판매가가 없습니다. 사이즈별 판정을 확인해 주세요.
        </p>
      )}
      <p className={styles.modeB}>{modeBSentence(judgement, size)}</p>
    </section>
  );
}
