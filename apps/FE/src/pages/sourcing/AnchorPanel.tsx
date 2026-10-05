import {
  ANCHOR_LOCKED_NOTE,
  ANCHOR_MEANING_NOTE,
  anchorLabel,
  type SourcingComparisonDetail,
} from '@/features/sourcing';
import { Icon } from '@/shared/ui';
import { ProductPhoto } from './ProductPhoto';
import styles from './AnchorPanel.module.css';

export interface AnchorPanelProps {
  /** 현재 ② 버전 비교표 머리(없으면 — ② 전 — 여정의 확정 기준 상품만 보인다) */
  head: SourcingComparisonDetail | undefined;
  /** 여정에 확정된 기준 상품 글(② 전·URL 여정) */
  fixedText: string | null;
}

/**
 * SCR-03 기준 상품 머리 줄(Sourcing.dc.html '검색 조건' 아래, F-SO-08·11, P2-03 규칙 1·3, D-47): 정한 뒤에만 그린다.
 * 사진·상품 이름(검색 결과 행에서 `anchorItemCode`가 같은 행 — 없으면 그리지 않는다) · 자물쇠 · '기준 상품' · '모델 번호 1201A019 ·
 * 색상 번호 108 · クリーム/ブラック' 칩 · '이 여정에서는 바꿀 수 없습니다 …' + 뜻 한 줄(읽기 전용).
 * 기준 상품을 정하기 전에는 아무것도 그리지 않는다 — 고르기는 비교표 자리의 '상품 고르기' 목록(SearchResultList)이 맡는다
 */
export function AnchorPanel({ head, fixedText }: AnchorPanelProps) {
  const anchored = head && !head.exploreMode ? anchorLabel(head) : fixedText;
  if (!anchored) return null;
  const row = head?.anchorItemCode
    ? head.rows.find((r) => r.itemCode === head.anchorItemCode)
    : undefined;
  return (
    <div className={styles.row} aria-label="기준 상품">
      {row ? <ProductPhoto url={row.imageUrl} size="sm" /> : null}
      <div className={styles.body}>
        <div className={styles.line}>
          <Icon name="lock" size={16} />
          <span className={styles.label}>기준 상품</span>
          {row ? (
            <span className={styles.name} title={row.itemName}>
              {row.itemName}
            </span>
          ) : null}
        </div>
        <div className={styles.line}>
          <span className={styles.chip}>{anchored}</span>
          <span className={styles.caption}>{ANCHOR_LOCKED_NOTE}</span>
        </div>
        <span className={styles.caption}>{ANCHOR_MEANING_NOTE}</span>
      </div>
    </div>
  );
}
