import type { ReactNode } from 'react';
import {
  CHILD_FILTER_NOTE,
  hasHangul,
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
  /** 기준 상품 머리 줄(AnchorPanel — 정한 뒤 읽기 전용, D-47). 없으면 그리지 않는다 */
  anchor?: ReactNode;
  /** '성별 확인 · 자동'(P2-03 GenderPanel) — 장르 칸 오른쪽 */
  gender?: ReactNode;
  /** 키워드에서 만든 여정의 한국어 원문(출처 키워드). 일본어 검색어와 함께 보이려고 칸 아래에 적는다. 없으면 그리지 않는다 */
  sourceKeyword?: string | null;
  /** 칸 아래 요청 오류(② 실행 422 등) */
  error?: string;
  placeholder?: string;
}

/**
 * SCR-03 검색 조건(Sourcing.dc.html '검색 조건', F-SO-01·02·04): '라쿠텐 검색어' + '반각 32/128자 · 형식 맞음',
 * '장르 · 고정 靴 558885', '성별 확인 · 자동'(P2-03 F-SO-18·19), 기준 상품 머리 줄(정한 뒤 '이 여정에서는 바꿀 수 없다' — 고르기는 비교 칸의 '상품 고르기' 목록),
 * 아동화 필터 안내. 검색어를 고치고 '다시 실행'하면 그 검색어로 ②를 돌린다(실행 중 오너 입력 `searchKeyword`).
 * 키워드에서 만든 여정은 한국어 원문(출처 키워드)과 지금 검색어(일본어)를 함께 보인다 — 키워드 화면에서 [이 검색어로 소싱]을 누를 때
 * 한글 키워드를 AI가 일본어 검색어로 바꿔 여정을 만든다(F-BS-70). 검색어가 아직 한글이면 칸의 한글 안내가 대신 보인다.
 */
export function SearchQueryPanel({
  query,
  onQueryChange,
  check,
  genreId,
  anchor,
  gender,
  sourceKeyword,
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
          <span className={styles.label}>검색 분류 · 고정</span>
          <span className={styles.lockedBox}>
            <Icon name="lock" size={14} />
            {RAKUTEN_GENRE_NAME} <span className={styles.id}>{genreId}</span>
          </span>
        </div>
        {gender}
      </div>
      {sourceKeyword &&
      query.trim() !== '' &&
      query.trim() !== sourceKeyword &&
      !hasHangul(query) ? (
        <p className={styles.origin}>
          <span className={styles.originLabel}>한국어 원문</span>
          <span className={styles.originText}>{sourceKeyword}</span>
          <span className={styles.caption}>
            → 위 일본어 검색어로 검색합니다 · 칸에서 고칠 수 있습니다
          </span>
        </p>
      ) : null}
      {anchor}
      <p className={styles.caption}>{CHILD_FILTER_NOTE}</p>
    </section>
  );
}
