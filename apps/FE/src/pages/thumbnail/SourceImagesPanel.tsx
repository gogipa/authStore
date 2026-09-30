import { useId, useState } from 'react';
import {
  imageCaption,
  NO_PERSON_CAPTION,
  NO_PERSON_LABEL,
  NOT_WAITING_REFERENCE_REASON,
  PICK_REFERENCE_FIRST_REASON,
  REFERENCE_CHECKBOX_LABEL,
  REFERENCE_LIMIT_REASON,
  REFERENCE_MAX,
  REFERENCE_ONLY_LABEL,
  referencesRequest,
  SOURCE_IMAGES_EMPTY_TEXT,
  SOURCE_IMAGES_LOADING_TEXT,
  SOURCE_IMAGES_NOTE,
  SOURCE_IMAGES_TITLE,
  sourceLineText,
  toggleReference,
  useCandidateSourceImagesQuery,
  usePutThumbnailReferencesMutation,
  type ThumbnailReferencesResult,
} from '@/features/thumbnails';
import { Banner, Checkbox, Chip, DisabledReason, Panel } from '@/shared/ui';
import { cx } from '@/shared/lib/cx';
import styles from './ThumbnailPage.module.css';

export interface SourceImagesPanelProps {
  candidateId: number;
  /** 입력 대기 중인 ⑤ 실행 id. 없으면(미실행·완료·실패) 레퍼런스를 고를 수 없다 */
  stepRunId: number | null;
  /**
   * 레퍼런스 확인 상태가 바뀔 때. 오너가 1~3장을 고르고 '사람·얼굴 없음'을 체크해 저장하면 `true`와 저장 결과,
   * 고른 것을 바꾸거나 체크를 풀면 `false`
   */
  onConfirmedChange?: (confirmed: boolean, result: ThumbnailReferencesResult | null) => void;
}

/**
 * '원본 이미지' 패널(SCR-05, Thumbnail.dc.html, F-TH-03·04·05, P3-01).
 * - 머리: 출처 줄('라쿠텐 shop-a 상품 페이지 · 14:02 받음 · 6장') · '레퍼런스에 사람·얼굴 없음' 체크 · '체크해야 생성할 수 있습니다'
 * - 이미지마다: 번호·해상도, '참조 전용' 칩, '레퍼런스' 체크(3장이면 더 못 고른다 — 고른 순서가 sortOrder)
 * - '사람·얼굴 없음'은 미리 켜 두지 않는다. 오너가 체크할 때만 저장(PUT, noPersonConfirmed=true)을 부르고, 고른 것을 바꾸면
 *   체크가 풀린다(새 선택에 대해 다시 확인). 저장 실패는 05-3 문구를 막힘 띠로 보이고 체크를 푼다(F-TH-05, 05-1 §1.2)
 * - 아래 안내: 보드 문구 그대로('레퍼런스를 바꾸면 ⑤를 다시 실행해야 합니다' — P3-01 규칙 10)
 */
export function SourceImagesPanel({
  candidateId,
  stepRunId,
  onConfirmedChange,
}: SourceImagesPanelProps) {
  const reasonId = useId();
  const query = useCandidateSourceImagesQuery(candidateId, 'PRODUCT_IMAGE');
  const save = usePutThumbnailReferencesMutation();
  const [selection, setSelection] = useState<number[]>([]);
  const [noPerson, setNoPerson] = useState(false);
  const editable = stepRunId !== null;
  const images = query.data?.items ?? [];
  const full = selection.length >= REFERENCE_MAX;

  const unconfirm = () => {
    if (noPerson) setNoPerson(false);
    save.reset();
    onConfirmedChange?.(false, null);
  };

  const toggle = (imageAssetId: number) => {
    setSelection((current) => toggleReference(current, imageAssetId));
    unconfirm();
  };

  const confirm = (checked: boolean) => {
    if (!checked) {
      unconfirm();
      return;
    }
    if (stepRunId === null || selection.length === 0) return;
    setNoPerson(true);
    save.mutate(
      { candidateId, stepRunId, body: referencesRequest(selection, true) },
      {
        onSuccess: (result) => onConfirmedChange?.(true, result),
        onError: () => {
          setNoPerson(false);
          onConfirmedChange?.(false, null);
        },
      },
    );
  };

  const confirmReason = !editable
    ? NOT_WAITING_REFERENCE_REASON
    : selection.length === 0
      ? PICK_REFERENCE_FIRST_REASON
      : null;
  const listError =
    query.error && query.error.code !== 'STEP_OUTPUT_NOT_FOUND' ? query.error.message : null;

  return (
    <Panel
      title={SOURCE_IMAGES_TITLE}
      caption={sourceLineText(images) || undefined}
      actions={
        <span className={styles.noPerson}>
          <Checkbox
            label={NO_PERSON_LABEL}
            checked={noPerson}
            disabled={confirmReason !== null || save.isPending}
            aria-describedby={confirmReason ? reasonId : undefined}
            onChange={(e) => confirm(e.target.checked)}
          />
          <span className={styles.caption}>{NO_PERSON_CAPTION}</span>
        </span>
      }
    >
      {listError ? <Banner tone="warning">{listError}</Banner> : null}
      {query.isPending && !listError ? (
        <p className={styles.placeholder}>{SOURCE_IMAGES_LOADING_TEXT}</p>
      ) : null}
      {!query.isPending && !listError && images.length === 0 ? (
        <p className={styles.placeholder}>{SOURCE_IMAGES_EMPTY_TEXT}</p>
      ) : null}
      {images.length > 0 ? (
        <ul className={styles.imageGrid} aria-label="라쿠텐 원본 이미지">
          {images.map((image, index) => {
            const selected = selection.includes(image.imageAssetId);
            const locked = !editable || (!selected && full);
            return (
              <li
                key={image.imageAssetId}
                className={cx(styles.imageCard, selected && styles.imageCardSelected)}
              >
                <div className={styles.imageFrame}>
                  <img
                    className={styles.image}
                    src={image.fileUrl}
                    alt={`원본 ${index + 1}`}
                    loading="lazy"
                  />
                  <span className={styles.usageChip}>
                    <Chip tone="outline">{REFERENCE_ONLY_LABEL}</Chip>
                  </span>
                </div>
                <span className={styles.imageMeta}>{imageCaption(index, image)}</span>
                <Checkbox
                  label={REFERENCE_CHECKBOX_LABEL}
                  aria-label={`원본 ${index + 1} ${REFERENCE_CHECKBOX_LABEL}`}
                  checked={selected}
                  disabled={locked || save.isPending}
                  onChange={() => toggle(image.imageAssetId)}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
      {confirmReason && images.length > 0 ? (
        <DisabledReason id={reasonId}>{confirmReason}</DisabledReason>
      ) : null}
      {editable && full ? (
        <DisabledReason tone="muted">{REFERENCE_LIMIT_REASON}</DisabledReason>
      ) : null}
      {save.error ? <Banner tone="blocked">{save.error.message}</Banner> : null}
      <p className={styles.note}>{SOURCE_IMAGES_NOTE}</p>
    </Panel>
  );
}
