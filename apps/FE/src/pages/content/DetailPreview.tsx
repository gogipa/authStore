import { useState } from 'react';
import {
  PREVIEW_CAPTION,
  PREVIEW_ENLARGE_LABEL,
  PREVIEW_SHRINK_LABEL,
  PREVIEW_TITLE,
} from '@/features/content';
import { Button } from '@/shared/ui';
import styles from './ContentPage.module.css';

export interface DetailPreviewProps {
  /** 미리보기 경로(05-2 ContentAssemblyOutput.previewUrl — 같은 출처 `/api/v1/…`) */
  previewUrl: string;
  /**
   * 다시 불러오기 표식(조립 결과 조회를 다시 받은 시각). SSE(`step-run.status-changed` NOTICE_HTML·`content-field.recheck-flagged`·
   * `gate.passed` G3)가 조회를 무효화하면 바뀌어 iframe을 새로 연다 — 썸네일만 다시 골라도 새 선택본으로 채운 미리보기가 보인다
   */
  reloadKey: number;
}

/**
 * ⑥-3 HTML 미리보기(SCR-06 Content.dc.html 'HTML 미리보기', F-CT-31, P3-04 규칙 12). 미리보기 HTML은 fetch하지 않고
 * `<iframe sandbox>`의 `src`로 연다 — `sandbox` 값이 비어 있어(`allow-scripts`·`allow-same-origin` 없음) 스크립트가 돌지 않고, 서버도
 * `Content-Security-Policy: sandbox; img-src 'self'`를 건다. '크게 보기'는 칸 높이를 키운다(새 창을 열지 않는다 — Proposed).
 */
export function DetailPreview({ previewUrl, reloadKey }: DetailPreviewProps) {
  const [large, setLarge] = useState(false);
  return (
    <section aria-labelledby="detail-preview-title" className={styles.previewPanel}>
      <div className={styles.subHead}>
        <h3 id="detail-preview-title" className={styles.blockTitle}>
          {PREVIEW_TITLE}
        </h3>
        <span className={styles.spacer} />
        <Button size="sm" aria-pressed={large} onClick={() => setLarge((v) => !v)}>
          {large ? PREVIEW_SHRINK_LABEL : PREVIEW_ENLARGE_LABEL}
        </Button>
      </div>
      <iframe
        key={reloadKey}
        title="상세페이지 미리보기"
        src={previewUrl}
        sandbox=""
        referrerPolicy="no-referrer"
        className={large ? styles.previewFrameLarge : styles.previewFrame}
      />
      <span className={styles.caption}>{PREVIEW_CAPTION}</span>
    </section>
  );
}
