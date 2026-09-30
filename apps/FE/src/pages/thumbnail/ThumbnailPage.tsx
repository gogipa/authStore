import { useState } from 'react';
import { useParams } from 'react-router';
import {
  parseCandidateId,
  railByCode,
  runButtonLabel,
  StepStatusBar,
  useCandidateSteps,
  useStartStepRun,
} from '@/features/step-engine';
import { Button, DisabledReason } from '@/shared/ui';
import { GenerationOptionsPanel } from './GenerationOptionsPanel';
import { SourceImagesPanel } from './SourceImagesPanel';
import styles from './ThumbnailPage.module.css';

const TITLE = '썸네일 스튜디오';

/** ⑤ 상태 줄 입력 출처(보드 그대로) */
export const THUMBNAIL_SOURCE_TEXT = '② 원본 이미지 · 레퍼런스 선택';

/**
 * SCR-05 ⑤ 썸네일(Thumbnail.dc.html, P3-01 준비). 후보 작업 틀(CandidateLayout) 안 단계 본문:
 * - ⑤ 머리: 제목 + 상태 줄(StepStatusBar — '실행'/'다시 실행', 입력 출처 '② 원본 이미지 · 레퍼런스 선택')
 * - '원본 이미지' 패널(`SourceImagesPanel`): 출처 줄 · 이미지마다 번호·해상도·'참조 전용'·'레퍼런스' 체크 · '사람·얼굴 없음'
 * - '생성 옵션' 패널(`GenerationOptionsPanel`): 얼굴 노출 · 프롬프트 펼치기 · 실존 인물 검사 · 생성 버튼 자리(켜짐 조건만)
 * 후보 그리드·나란히 보기·선택 전 확인(G3)은 P3-02가 더한다. '생성 순서와 비용'은 M2(IM-09)라 만들지 않는다.
 * 결과는 폴링하지 않고 SSE(step-run.status-changed THUMBNAIL)가 레일·원본 목록을 다시 읽힌다.
 */
export function ThumbnailPage() {
  const { candidateId: rawId = '' } = useParams();
  const candidateId = parseCandidateId(rawId);
  const rail = useCandidateSteps(candidateId);
  const start = useStartStepRun();
  const [confirmed, setConfirmed] = useState({ runId: 0, ok: false, version: 0 });

  const item = railByCode(rail.data?.items).THUMBNAIL;
  const currentRunId = item?.currentStepRunId ?? null;
  const waitingRunId = item?.status === 'WAITING_INPUT' ? currentRunId : null;
  const runAction = item?.actions.run;
  const runReason =
    runAction && !runAction.enabled ? (runAction.disabledReason?.message ?? null) : null;
  const referencesConfirmed = confirmed.ok && confirmed.runId === waitingRunId;

  const run = () => {
    if (candidateId === null) return;
    start.reset();
    start.mutate({ candidateId, stepCode: 'THUMBNAIL', body: {} });
  };

  return (
    <>
      <title>{`${TITLE} · 신발 자동등록`}</title>
      <h1 className={styles.srOnly}>{TITLE}</h1>
      <section aria-labelledby="step5-title" className={styles.step}>
        <div className={styles.stepHead}>
          <h2 id="step5-title" className={styles.stepTitle}>
            ⑤ 썸네일
          </h2>
          <span className={styles.screenId}>SCR-05</span>
          <div className={styles.bar}>
            {item ? (
              <StepStatusBar
                item={item}
                source={THUMBNAIL_SOURCE_TEXT}
                candidateId={candidateId ?? undefined}
                error={start.error ?? undefined}
                actions={
                  <Button
                    disabled={start.isPending || runReason !== null}
                    aria-describedby={runReason ? 'thumbnail-run-why' : undefined}
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
          <DisabledReason id="thumbnail-run-why" className={styles.reason}>
            {runReason}
          </DisabledReason>
        ) : null}
        {candidateId !== null ? (
          <SourceImagesPanel
            key={waitingRunId ?? 'none'}
            candidateId={candidateId}
            stepRunId={waitingRunId}
            onConfirmedChange={(ok) =>
              setConfirmed((prev) => ({
                runId: waitingRunId ?? 0,
                ok,
                version: prev.version + (ok ? 1 : 0),
              }))
            }
          />
        ) : null}
        <div className={styles.columns}>
          <GenerationOptionsPanel
            stepRunId={currentRunId}
            waiting={waitingRunId !== null}
            referencesConfirmed={referencesConfirmed}
            referencesVersion={confirmed.version}
          />
        </div>
      </section>
    </>
  );
}
