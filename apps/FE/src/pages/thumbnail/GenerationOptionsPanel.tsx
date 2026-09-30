import { useEffect, useId, useState } from 'react';
import {
  blockedTermsText,
  DEFAULT_FACE_OPTION,
  FACE_GROUP_LABEL,
  FACE_OPTION_LABEL,
  FACE_OPTIONS,
  GENERATE_LABEL,
  generateDisabledReason,
  GENERATION_OPTIONS_TITLE,
  NO_REAL_PERSON_TEXT,
  PROMPT_ADJUSTED_META,
  PROMPT_ADJUSTMENT_LABEL,
  PROMPT_ADJUSTMENT_MAX,
  PROMPT_DEFAULT_META,
  PROMPT_TITLE,
  REGENERATE_LABEL,
  useThumbnailPromptPreviewMutation,
  type ThumbnailFaceOption,
} from '@/features/thumbnails';
import { cx } from '@/shared/lib/cx';
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue';
import { Banner, Button, Chip, DisabledReason, Disclosure, Panel, Textarea } from '@/shared/ui';
import styles from './ThumbnailPage.module.css';

/** 조정 문구 미리보기 지연(ms, P3-01 Proposed — 입력이 멈춘 뒤 다시 검사) */
export const PROMPT_PREVIEW_DEBOUNCE_MS = 400;

export interface GenerateOptions {
  faceOption: ThumbnailFaceOption;
  promptAdjustment: string | null;
}

export interface GenerationOptionsPanelProps {
  /** ⑤ 현재 실행 id(미리보기 대상). 없으면 미리보기를 부르지 않는다 */
  stepRunId: number | null;
  /** ⑤가 입력 대기인가(생성은 입력 대기에서만) */
  waiting: boolean;
  /** 이 화면에서 레퍼런스 1~3장 + '사람·얼굴 없음' 체크를 저장했는가 */
  referencesConfirmed: boolean;
  /** 레퍼런스를 저장할 때마다 바뀌는 값 — 미리보기(generationAllowed)를 다시 부른다 */
  referencesVersion: number;
  /** 생성(P3-02 — `createThumbnailGenerationRuns`, 번호 1..N 모두) */
  onGenerate?: (options: GenerateOptions) => void;
  /** 후보가 이미 있는가(P3-02): 있으면 버튼이 보드 그대로 보조 '다시 만들기', 없으면 주 버튼 '만들기' */
  hasCandidates?: boolean;
  /** 생성 요청 중이거나 생성 중인 번호가 있으면 끈다(P3-02) */
  busyReason?: string | null;
  /** 옵션·꺼진 이유가 바뀔 때(P3-02 — 후보 칸의 '다시 만들기'·거부 뒤 재시도가 같은 옵션·조건을 쓴다) */
  onStateChange?: (state: { options: GenerateOptions; disabledReason: string | null }) => void;
}

/**
 * '생성 옵션' 패널(SCR-05, Thumbnail.dc.html, F-TH-06·10·11, P3-01).
 * - 얼굴 노출 라디오(전체 / 턱 아래 크롭 / 손·상반신만, 기본 전체)
 * - 프롬프트 펼치기('기본 골격 사용' · '펼치기' → 조정 문구 칸 + 채운 프롬프트 미리보기)
 * - '실존 인물 이름 없음' 칩, 걸리면 걸린 단어와 이유(05-3 REAL_PERSON_NAME_BLOCKED 문구)
 * - 생성 버튼('만들기' — 후보가 생기면 보드 그대로 보조 '다시 만들기', P3-02): ⑤ 입력 대기 + 레퍼런스 확인 + 미리보기
 *   `generationAllowed` + 생성 중 아님. 누르면 `onGenerate`(번호 1..N 모두)
 * 값이 바뀌면 미리보기(`POST /thumbnail-prompt-previews`)를 다시 부른다(조정 문구는 400ms 지연). '생성 순서와 비용'은 M2(IM-09)라
 * 그리지 않는다.
 */
export function GenerationOptionsPanel({
  stepRunId,
  waiting,
  referencesConfirmed,
  referencesVersion,
  onGenerate,
  hasCandidates = false,
  busyReason = null,
  onStateChange,
}: GenerationOptionsPanelProps) {
  const faceLabelId = useId();
  const reasonId = useId();
  const radioName = useId();
  const [faceOption, setFaceOption] = useState<ThumbnailFaceOption>(DEFAULT_FACE_OPTION);
  const [adjustment, setAdjustment] = useState('');
  const debounced = useDebouncedValue(adjustment, PROMPT_PREVIEW_DEBOUNCE_MS);
  const { mutate, data: preview, error, reset } = useThumbnailPromptPreviewMutation();

  useEffect(() => {
    if (stepRunId === null) {
      reset();
      return;
    }
    mutate({
      stepRunId,
      faceOption,
      promptAdjustment: debounced.trim() === '' ? null : debounced,
    });
  }, [stepRunId, faceOption, debounced, referencesVersion, mutate, reset]);

  const detected = preview?.realPersonNameDetected === true;
  const reason =
    generateDisabledReason({
      hasRun: stepRunId !== null,
      waiting,
      referencesConfirmed,
      preview,
    }) ?? busyReason;
  const adjusted = adjustment.trim() !== '';
  const promptAdjustment = adjusted ? adjustment.trim() : null;

  useEffect(() => {
    onStateChange?.({ options: { faceOption, promptAdjustment }, disabledReason: reason });
  }, [onStateChange, faceOption, promptAdjustment, reason]);

  return (
    <Panel
      title={GENERATION_OPTIONS_TITLE}
      className={styles.optionsPanel}
      actions={
        <Button
          variant={hasCandidates ? 'secondary' : 'primary'}
          size="sm"
          disabled={reason !== null}
          aria-describedby={reason ? reasonId : undefined}
          onClick={() => onGenerate?.({ faceOption, promptAdjustment })}
        >
          {hasCandidates ? REGENERATE_LABEL : GENERATE_LABEL}
        </Button>
      }
    >
      <div role="radiogroup" aria-labelledby={faceLabelId} className={styles.faceGroup}>
        <span id={faceLabelId} className={styles.label}>
          {FACE_GROUP_LABEL}
        </span>
        <div className={styles.segmented}>
          {FACE_OPTIONS.map((option) => {
            const id = `${radioName}-${option}`;
            const checked = option === faceOption;
            return (
              <span key={option} className={styles.segment}>
                <input
                  id={id}
                  type="radio"
                  name={radioName}
                  value={option}
                  checked={checked}
                  className={styles.srOnly}
                  onChange={() => setFaceOption(option)}
                />
                <label
                  htmlFor={id}
                  className={cx(styles.segmentLabel, checked && styles.segmentLabelChecked)}
                >
                  {FACE_OPTION_LABEL[option]}
                </label>
              </span>
            );
          })}
        </div>
      </div>
      <Disclosure title={PROMPT_TITLE} meta={adjusted ? PROMPT_ADJUSTED_META : PROMPT_DEFAULT_META}>
        <div className={styles.promptBody}>
          <Textarea
            label={PROMPT_ADJUSTMENT_LABEL}
            value={adjustment}
            maxLength={PROMPT_ADJUSTMENT_MAX}
            rows={3}
            onChange={(e) => setAdjustment(e.target.value)}
          />
          {preview ? (
            <pre className={styles.promptPreview} aria-label="채운 프롬프트">
              {preview.prompt}
            </pre>
          ) : null}
        </div>
      </Disclosure>
      <div className={styles.personCheck}>
        {detected ? (
          <Chip tone="failed" icon="alert">
            실존 인물 이름: {preview.blockedTerms.join(', ')}
          </Chip>
        ) : preview ? (
          <Chip tone="done" icon="check">
            {NO_REAL_PERSON_TEXT}
          </Chip>
        ) : null}
      </div>
      {error ? <Banner tone="warning">{error.message}</Banner> : null}
      {reason ? (
        <DisabledReason id={reasonId}>
          {detected ? blockedTermsText(preview.blockedTerms) : reason}
        </DisabledReason>
      ) : null}
    </Panel>
  );
}
