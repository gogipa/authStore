import { useState } from 'react';
import {
  REFERENCE_ONLY_LABEL,
  SIDE_BY_SIDE_EMPTY_TEXT,
  SIDE_BY_SIDE_TITLE,
  type ThumbnailOutput,
  type ThumbnailSourceImage,
} from '@/features/thumbnails';
import { cx } from '@/shared/lib/cx';
import { Panel } from '@/shared/ui';
import styles from './ThumbnailPage.module.css';

type ReferenceItem = ThumbnailOutput['references'][number];

export interface SideBySideProps {
  /** ⑤ 버전이 쓴 레퍼런스(순서대로) */
  references: readonly ReferenceItem[];
  /** 원본 목록(레퍼런스가 '원본 몇 번'인지 — 원본 패널과 같은 번호) */
  sourceImages: readonly ThumbnailSourceImage[];
  /** 대표로 고른 후보(없으면 null) */
  selected: { imageAssetId: number; slotNo: number } | null;
}

function imageUrl(imageAssetId: number): string {
  return `/api/v1/image-assets/${imageAssetId}/file`;
}

/**
 * '레퍼런스와 나란히 보기'(SCR-05, Thumbnail.dc.html, F-TH-12, P3-02). 왼쪽 레퍼런스('원본 2번 · 참조 전용'), 오른쪽 대표로 고른
 * 선택본('후보 4'). 레퍼런스가 여럿이면 아래 번호 버튼으로 바꿔 본다(보드에 없음 — Proposed). 보드의 'AI 생성' 칩·'AI 생성 이미지 ·
 * 가상인물' 표시는 AI 라벨(M2 F-TH-28) 몫이라 그리지 않는다. '같은 상품·색상' 안내·확인은 '선택 전 확인' 패널에 둔다.
 */
export function SideBySide({ references, sourceImages, selected }: SideBySideProps) {
  const [index, setIndex] = useState(0);
  const reference = references[Math.min(index, Math.max(references.length - 1, 0))] ?? null;
  const originalNo = reference
    ? sourceImages.findIndex((image) => image.imageAssetId === reference.imageAssetId) + 1
    : 0;
  return (
    <Panel title={SIDE_BY_SIDE_TITLE} className={styles.comparePanel}>
      <div className={styles.compareGrid}>
        <figure className={styles.compareFigure}>
          <div className={styles.compareFrame}>
            {reference ? (
              <img
                className={styles.image}
                src={imageUrl(reference.imageAssetId)}
                alt="레퍼런스 원본"
              />
            ) : null}
          </div>
          <figcaption className={styles.compareCaption}>
            <span className={styles.compareLabel}>레퍼런스</span>
            {reference
              ? `${originalNo > 0 ? `원본 ${originalNo}번` : `레퍼런스 ${reference.sortOrder}`} · ${REFERENCE_ONLY_LABEL}`
              : '없음'}
          </figcaption>
        </figure>
        <figure className={styles.compareFigure}>
          <div className={styles.compareFrame}>
            {selected ? (
              <img
                className={styles.image}
                src={imageUrl(selected.imageAssetId)}
                alt={`선택본 후보 ${selected.slotNo}`}
              />
            ) : (
              <span className={styles.placeholder}>{SIDE_BY_SIDE_EMPTY_TEXT}</span>
            )}
          </div>
          <figcaption className={styles.compareCaption}>
            <span className={styles.compareLabel}>선택본</span>
            {selected ? `후보 ${selected.slotNo}` : '고르기 전'}
          </figcaption>
        </figure>
      </div>
      {references.length > 1 ? (
        <div className={styles.referenceSwitch} role="group" aria-label="볼 레퍼런스">
          {references.map((ref, i) => (
            <button
              key={ref.id}
              type="button"
              aria-pressed={i === index}
              className={cx(styles.switchButton, i === index && styles.switchButtonOn)}
              onClick={() => setIndex(i)}
            >
              레퍼런스 {ref.sortOrder}
            </button>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}
