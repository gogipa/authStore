import {
  EXCLUDED_CAPTION,
  EXCLUDED_EMPTY_TEXT,
  EXCLUDED_TITLE,
  excludedReasonText,
  excludedSourceText,
  excludedTags,
  type TagCandidateItem,
} from '@/features/tags';
import styles from './TagsPage.module.css';

export interface ExcludedTagsTableProps {
  candidates: readonly TagCandidateItem[];
}

/**
 * '뺀 태그와 사유' 패널(Tags.dc.html, F-TG-13): '규칙 사전 판정 · AI 판정 꺼짐'. 줄마다 태그 · 출처·빈도('경쟁 11') · 사유
 * (규칙 필터 사유 글, 제한 태그는 '제한 태그 · 네이버 확인', 오너가 뺀 태그는 '직접 뺌'). 1차 검증 통과를 등록 성공으로 약속하는
 * 글은 쓰지 않는다(카테고리별 제한은 등록해 봐야 안다, TG-05).
 */
export function ExcludedTagsTable({ candidates }: ExcludedTagsTableProps) {
  const rows = excludedTags(candidates);
  return (
    <section aria-labelledby="drop-title" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 id="drop-title" className={styles.panelTitle}>
          {EXCLUDED_TITLE}
        </h2>
        <span className={styles.caption}>{EXCLUDED_CAPTION}</span>
      </div>
      {rows.length > 0 ? (
        <ul aria-label={EXCLUDED_TITLE} className={styles.plainList}>
          {rows.map((c) => (
            <li key={c.id} className={styles.excludedItem}>
              <span className={styles.excludedText}>{c.text}</span>
              <span className={styles.caption}>{excludedSourceText(c)}</span>
              <span className={styles.spacer} />
              <span className={styles.excludedReason}>{excludedReasonText(c)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.placeholder}>{EXCLUDED_EMPTY_TEXT}</p>
      )}
    </section>
  );
}
