import {
  railByCode,
  runButtonLabel,
  StepStatusBar,
  useCandidateSteps,
  useStartStepRun,
} from '@/features/step-engine';
import {
  UPLOAD_EMPTY_TEXT,
  UPLOAD_NOTE,
  UPLOAD_ROLE_LABEL,
  UPLOAD_SOURCE_TEXT,
  UPLOAD_TITLE,
  UPLOADED_IMAGES_TITLE,
  uploadImageAlt,
  uploadImageFileUrl,
  uploadImagesCaption,
  useUploadResultQuery,
} from '@/features/registration';
import { Button, Chip, DisabledReason } from '@/shared/ui';
import styles from './UploadSection.module.css';

export interface UploadSectionProps {
  candidateId: number;
}

/**
 * SCR-08 ⑧ 이미지 업로드 영역(Approval.dc.html 맨 위 줄, P4-01 §5 FE):
 * - 머리: '⑧ 이미지 업로드' + 상태 줄(StepStatusBar — 상태 칩 · '마지막 실행 14:42 · 버전 v1' · '입력 출처: ⑤ 선택본 · ⑥-3 상세
 *   HTML' · 재실행 필요면 바뀐 입력 이름 · 실패면 한국어 문구) + '다시 실행'(P1-05 단계 실행 `stepCode=UPLOAD`) + 꺼진 이유
 *   (DisabledReason — G3 없음·키 없음 등 레일 `actions.run`)
 * - '업로드한 이미지': 정규화본(1000×1000 JPEG) 미리보기. 주소는 `/api/v1/image-assets/{imageAssetId}/file`(로컬 파일 — 브라우저가
 *   shop-phinf를 부르지 않는다). 역할(대표·추가)과 다시 쓴 주소면 '다시 씀' 칩
 * 결과는 폴링하지 않고 SSE `step-run.status-changed`(UPLOAD)·`candidate-step.changed`가 산출물·단계 레일을 다시 읽힌다. ⑧이 실행
 * 중이면(새 버전 산출물이 아직 없어 404) 마지막으로 받은 값을 그대로 보인다. 전체 미리보기·사전 검증·⑨는 P4-02·P4-03이 채운다.
 */
export function UploadSection({ candidateId }: UploadSectionProps) {
  const rail = useCandidateSteps(candidateId);
  const start = useStartStepRun();
  const item = railByCode(rail.data?.items).UPLOAD;
  const currentRunId = item?.currentStepRunId ?? null;
  const result = useUploadResultQuery(currentRunId !== null ? candidateId : null);
  const upload = result.data;
  const runAction = item?.actions.run;
  const runReason =
    runAction && !runAction.enabled ? (runAction.disabledReason?.message ?? null) : null;

  const run = () => {
    start.reset();
    start.mutate({ candidateId, stepCode: 'UPLOAD', body: {} });
  };

  return (
    <section aria-labelledby="step8-title" className={styles.section}>
      <div className={styles.head}>
        <h2 id="step8-title" className={styles.title}>
          {UPLOAD_TITLE}
        </h2>
        <span className={styles.screenId}>SCR-08</span>
        <div className={styles.bar}>
          {item ? (
            <StepStatusBar
              item={item}
              source={UPLOAD_SOURCE_TEXT}
              error={start.error ?? undefined}
              actions={
                <Button
                  variant="secondary"
                  disabled={start.isPending || runReason !== null}
                  aria-describedby={runReason ? 'upload-run-why' : undefined}
                  onClick={run}
                >
                  {runButtonLabel(item.status)}
                </Button>
              }
            />
          ) : null}
        </div>
      </div>
      {runReason ? (
        <DisabledReason id="upload-run-why" className={styles.reason}>
          {runReason}
        </DisabledReason>
      ) : null}
      <section aria-labelledby="upload-images-title" className={styles.panel}>
        <div className={styles.panelHead}>
          <h3 id="upload-images-title" className={styles.panelTitle}>
            {UPLOADED_IMAGES_TITLE}
          </h3>
          {upload ? (
            <span className={styles.caption}>{uploadImagesCaption(upload.images)}</span>
          ) : null}
        </div>
        {upload && upload.images.length > 0 ? (
          <>
            <ul className={styles.images} aria-label={UPLOADED_IMAGES_TITLE}>
              {upload.images.map((image) => (
                <li key={image.id}>
                  <figure className={styles.image}>
                    <img
                      className={styles.thumb}
                      src={uploadImageFileUrl(image.imageAssetId)}
                      alt={uploadImageAlt(image)}
                      width={96}
                      height={96}
                      loading="lazy"
                    />
                    <figcaption className={styles.imageMeta}>
                      {UPLOAD_ROLE_LABEL[image.role]}
                      {image.reused ? <Chip tone="neutral">다시 씀</Chip> : null}
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
            <p className={styles.placeholder}>{UPLOAD_NOTE}</p>
          </>
        ) : (
          <p className={styles.placeholder}>{UPLOAD_EMPTY_TEXT}</p>
        )}
      </section>
    </section>
  );
}
