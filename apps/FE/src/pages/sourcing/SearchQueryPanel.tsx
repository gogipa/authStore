import {
  CHILD_FILTER_NOTE,
  RAKUTEN_GENRE_NAME,
  RakutenQueryField,
  type RakutenQueryCheck,
} from '@/features/sourcing';
import { Icon } from '@/shared/ui';
import styles from './SearchQueryPanel.module.css';

export interface SearchQueryPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  check: RakutenQueryCheck;
  /** 검색에 붙는 장르(검사 결과 `genreId`, 없으면 설정 기본값) */
  genreId: number;
  /** 확정된 앵커(型番 · 색상 코드 · 색상). 없으면 줄을 그리지 않는다 */
  anchorText: string | null;
  /** 칸 아래 요청 오류(② 실행 422 등) */
  error?: string;
  placeholder?: string;
}

/**
 * SCR-03 검색 조건(Sourcing.dc.html '검색 조건', F-SO-01·02·04): '라쿠텐 검색어' + '반각 32/128자 · 형식 맞음',
 * '장르 · 고정 靴 558885', 앵커 줄(확정 뒤 — 이 후보에서는 바꿀 수 없다), 아동화 필터 안내. 검색어를 고치고 '다시 실행'하면
 * 그 검색어로 ②를 돌린다(실행 중 오너 입력 `searchKeyword`). 성별 확인 칸은 P2-03(F-SO-18·19)이 더한다.
 */
export function SearchQueryPanel({
  query,
  onQueryChange,
  check,
  genreId,
  anchorText,
  error,
  placeholder,
}: SearchQueryPanelProps) {
  return (
    <section aria-label="검색 조건" className={styles.panel}>
      <div className={styles.row}>
        <div className={styles.query}>
          <RakutenQueryField
            value={query}
            onChange={onQueryChange}
            check={check}
            error={error}
            placeholder={placeholder}
          />
        </div>
        <div className={styles.fixed}>
          <span className={styles.label}>장르 · 고정</span>
          <span className={styles.lockedBox}>
            <Icon name="lock" size={14} />
            {RAKUTEN_GENRE_NAME} <span className={styles.id}>{genreId}</span>
          </span>
        </div>
      </div>
      {anchorText ? (
        <div className={styles.anchorRow}>
          <Icon name="lock" size={14} />
          <span className={styles.label}>앵커</span>
          <span className={styles.anchorChip}>{anchorText}</span>
          <span className={styles.caption}>
            이 후보에서는 바꿀 수 없습니다 · 다른 모델·색상은 새 후보로 만듭니다
          </span>
        </div>
      ) : null}
      <p className={styles.caption}>{CHILD_FILTER_NOTE}</p>
    </section>
  );
}
