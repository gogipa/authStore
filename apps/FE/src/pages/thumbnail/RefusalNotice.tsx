import { useId } from 'react';
import {
  LOWEST_FACE_TEXT,
  lowerFaceLabel,
  lowerFaceOption,
  SLOT_REFUSED_TITLE,
  type ThumbnailFaceOption,
} from '@/features/thumbnails';
import { Banner, Button, DisabledReason } from '@/shared/ui';
import styles from './ThumbnailPage.module.css';

export interface RefusalNoticeProps {
  /** 이미지 모델이 밝힌 거부 사유(generation_run.refusal_reason) */
  reason: string;
  /** 거부된 시도의 얼굴 노출 수준 */
  faceOption: ThumbnailFaceOption;
  /** 다시 만들 수 없는 이유(생성 옵션 패널과 같은 조건). 없으면 null */
  disabledReason: string | null;
  /** 오너가 받아들이면 낮춘 얼굴 노출로 같은 번호를 다시 만든다(F-TH-09) */
  onRetry: (next: ThumbnailFaceOption) => void;
}

/**
 * 콘텐츠 필터 거부 안내(SCR-05, F-TH-09, P3-02 규칙 6): warning 띠에 거부 사유 + '얼굴 노출을 낮춰 다시 만들기 · {다음 단계}'
 * (전체 → 턱 아래 크롭 → 손·상반신만). 더 낮출 수 없으면 프롬프트를 고치라는 안내만 보인다. 누르면 같은 API에 낮춘
 * `faceOption`을 보낸다 — 자동으로 다시 만들지 않는다(오너가 받아들일 때만).
 */
export function RefusalNotice({ reason, faceOption, disabledReason, onRetry }: RefusalNoticeProps) {
  const reasonId = useId();
  const next = lowerFaceOption(faceOption);
  return (
    <Banner tone="warning" className={styles.refusal}>
      <span className={styles.refusalBody}>
        <strong>{SLOT_REFUSED_TITLE}</strong> {reason}
      </span>
      {next ? (
        <span className={styles.refusalAction}>
          <Button
            size="sm"
            disabled={disabledReason !== null}
            aria-describedby={disabledReason ? reasonId : undefined}
            onClick={() => onRetry(next)}
          >
            {lowerFaceLabel(next)}
          </Button>
          {disabledReason ? (
            <DisabledReason id={reasonId} tone="muted">
              {disabledReason}
            </DisabledReason>
          ) : null}
        </span>
      ) : (
        <span className={styles.refusalBody}>{LOWEST_FACE_TEXT}</span>
      )}
    </Banner>
  );
}
