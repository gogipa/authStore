import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useParams } from 'react-router';
import { NowMark, ScreenGuidePanel, STEP_GUIDE_COMMON, THUMBNAIL_GUIDE } from '@/features/guide';
import {
  parseCandidateId,
  railByCode,
  runButtonLabel,
  StepStatusBar,
  useCandidate,
  useCandidateSteps,
  usePassGate,
  useStartStepRun,
} from '@/features/step-engine';
import {
  allSlots,
  chooseRepresentative,
  EMPTY_PICK,
  G3_GENERATING_REASON,
  g3PassBody,
  hasRunning,
  pickFromSelection,
  samePick,
  thumbnailKeys,
  toggleAdditional,
  useCandidateSourceImagesQuery,
  useCandidateThumbnailQuery,
  useCreateGenerationRunsMutation,
  type G3ChecklistState,
  type ThumbnailFaceOption,
  type ThumbnailPick,
} from '@/features/thumbnails';
import { isApiRequestError } from '@/shared/api/errors';
import { useDocumentTitle } from '@/shared/lib/appName';
import { Banner, Button, DisabledReason } from '@/shared/ui';
import { CandidateGrid } from './CandidateGrid';
import { G3Checklist } from './G3Checklist';
import { GenerationOptionsPanel, type GenerateOptions } from './GenerationOptionsPanel';
import { SideBySide } from './SideBySide';
import { SourceImagesPanel } from './SourceImagesPanel';
import { thumbnailNowKey, type ThumbnailNowKey } from './thumbnailNow';
import styles from './ThumbnailPage.module.css';

const TITLE = '썸네일 스튜디오';

/** ⑤ 상태 줄 입력 출처(보드 그대로) */
export const THUMBNAIL_SOURCE_TEXT = '② 원본 이미지 · 레퍼런스 선택';

/** 생성 옵션 패널이 알려 주는 지금 옵션·꺼진 이유(후보 칸의 '다시 만들기'가 같이 쓴다) */
interface GenerateState {
  options: GenerateOptions;
  disabledReason: string | null;
}

/**
 * SCR-05 ⑤ 썸네일(Thumbnail.dc.html, P3-01 준비 + P3-02 생성·비교·선택). 여정 틀(CandidateLayout) 안 단계 본문:
 * - ⑤ 머리: 제목 + 상태 줄(StepStatusBar — '실행'/'다시 실행', 입력 출처 '② 원본 이미지 · 레퍼런스 선택')
 * - '원본 이미지'(`SourceImagesPanel`) — 저장된 레퍼런스를 미리 체크해 보인다(`getCandidateThumbnail`)
 * - [생성 옵션(`GenerationOptionsPanel` — '만들기'/'다시 만들기' = 번호 1..N 생성) | 썸네일 후보(`CandidateGrid`)]
 * - [레퍼런스와 나란히 보기(`SideBySide`) | 선택 전 확인(`G3Checklist` — G3 통과 = `usePassGate`)]
 * - 맨 위 안내(`ScreenGuidePanel` — 하는 일 · 지금 할 일 · 낯선 말 풀이, D-41)와 지금 할 일이 있는 자리의 '지금 여기' 표시(`NowMark`)
 * 생성 진행·G3 결과는 폴링하지 않고 SSE(generation-run.updated·gate.*·step-run.status-changed)가 ⑤ 산출물을 다시 읽힌다.
 * '생성 순서와 비용'·신발 비중·디테일 검사·'AI 생성' 표시는 M2라 만들지 않는다.
 */
export function ThumbnailPage() {
  const pageTitle = useDocumentTitle(TITLE);
  const { candidateId: rawId = '' } = useParams();
  const candidateId = parseCandidateId(rawId);
  const queryClient = useQueryClient();
  const rail = useCandidateSteps(candidateId);
  const candidate = useCandidate(candidateId);
  const start = useStartStepRun();
  const create = useCreateGenerationRunsMutation();
  const pass = usePassGate();
  const sources = useCandidateSourceImagesQuery(candidateId, 'PRODUCT_IMAGE');
  const [confirmed, setConfirmed] = useState({ runId: 0, ok: false, version: 0 });
  const [genState, setGenState] = useState<GenerateState | null>(null);
  const [picked, setPicked] = useState<{ runId: number; pick: ThumbnailPick } | null>(null);

  const item = railByCode(rail.data?.items).THUMBNAIL;
  const currentRunId = item?.currentStepRunId ?? null;
  const waitingRunId = item?.status === 'WAITING_INPUT' ? currentRunId : null;
  const runAction = item?.actions.run;
  const runReason =
    runAction && !runAction.enabled ? (runAction.disabledReason?.message ?? null) : null;
  const referencesConfirmed = confirmed.ok && confirmed.runId === waitingRunId;

  const thumbnail = useCandidateThumbnailQuery(currentRunId !== null ? candidateId : null);
  const output =
    thumbnail.data && thumbnail.data.stepRunId === currentRunId ? thumbnail.data : undefined;
  const runs = output?.generationRuns ?? [];
  const running = hasRunning(runs);
  const saved = pickFromSelection(output?.selection);
  const pick =
    output && picked?.runId === output.stepRunId ? picked.pick : output ? saved : EMPTY_PICK;
  const setPick = (next: ThumbnailPick) => {
    if (output) setPicked({ runId: output.stepRunId, pick: next });
  };
  const passedSame = output?.g3.valid === true && !!output.selection && samePick(pick, saved);
  const selectable =
    output?.isCurrent === true &&
    (output.stepRunStatus === 'WAITING_INPUT' || output.stepRunStatus === 'COMPLETED');
  const representativeRun = runs.find(
    (run) => run.resultImageAssetId !== null && run.resultImageAssetId === pick.representative,
  );
  const candidateCount = output?.candidateCount ?? 2;
  const savedReferences =
    output && output.stepRunId === waitingRunId
      ? [...output.references].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.imageAssetId)
      : null;
  const onGenState = useCallback((state: GenerateState) => setGenState(state), []);

  const run = () => {
    if (candidateId === null) return;
    start.reset();
    start.mutate({ candidateId, stepCode: 'THUMBNAIL', body: {} });
  };

  const generate = (slotNos: number[], options: GenerateOptions) => {
    if (candidateId === null || waitingRunId === null) return;
    create.reset();
    create.mutate({
      candidateId,
      stepRunId: waitingRunId,
      body: {
        slotNos,
        faceOption: options.faceOption,
        promptAdjustment: options.promptAdjustment,
      },
    });
  };

  const regenerate = (slotNo: number, faceOption?: ThumbnailFaceOption) => {
    if (!genState) return;
    generate([slotNo], {
      faceOption: faceOption ?? genState.options.faceOption,
      promptAdjustment: genState.options.promptAdjustment,
    });
  };

  const passG3 = (checklist: G3ChecklistState, sameProduct: boolean) => {
    if (candidateId === null || !output || pick.representative === null) return;
    pass.reset();
    pass.mutate(
      {
        candidateId,
        gate: 'G3',
        body: g3PassBody(output.stepRunId, pick, checklist, sameProduct),
      },
      {
        onSuccess: () =>
          void queryClient.invalidateQueries({ queryKey: thumbnailKeys.thumbnail(candidateId) }),
      },
    );
  };

  const generating = create.isPending || running;
  const busyReason = generating ? G3_GENERATING_REASON : null;
  const regenerateReason = genState?.disabledReason ?? busyReason;
  const createError = create.error
    ? isApiRequestError(create.error)
      ? create.error.message
      : '요청을 처리하지 못했습니다.'
    : null;

  // 맨 위 안내(D-41): 화면에 이미 있는 값만 읽어 위에서부터 첫 번째로 막힌 일을 말하고, 그 일이 있는 자리에 '지금 여기'를 붙인다
  const nowKey = thumbnailNowKey({
    stepStatus: item?.status,
    runBlocked: runReason !== null,
    output,
    referencesConfirmed,
    generating,
    representative: pick.representative,
    passedSame,
  });
  const marked = (...keys: ThumbnailNowKey[]) => nowKey !== null && keys.includes(nowKey);

  return (
    <>
      <title>{pageTitle}</title>
      <h1 className={styles.srOnly}>{TITLE}</h1>
      <ScreenGuidePanel guide={THUMBNAIL_GUIDE} nowKey={nowKey} />
      <section aria-labelledby="step5-title" className={styles.step}>
        <div className={styles.stepHead}>
          <h2 id="step5-title" className={styles.stepTitle}>
            ⑤ 썸네일
          </h2>
          <div className={styles.bar}>
            {item ? (
              <StepStatusBar
                item={item}
                source={THUMBNAIL_SOURCE_TEXT}
                candidateId={candidateId ?? undefined}
                error={start.error ?? undefined}
                actions={
                  <NowMark
                    inline
                    label={STEP_GUIDE_COMMON.nowMark}
                    active={marked('start', 'blocked', 'rerun', 'failed')}
                  >
                    <Button
                      disabled={start.isPending || runReason !== null}
                      aria-describedby={runReason ? 'thumbnail-run-why' : undefined}
                      onClick={run}
                    >
                      {runButtonLabel(item.status)}
                    </Button>
                  </NowMark>
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
        <NowMark label={STEP_GUIDE_COMMON.nowMark} active={marked('pickReferences')}>
          {candidateId !== null ? (
            <SourceImagesPanel
              key={waitingRunId ?? 'none'}
              candidateId={candidateId}
              stepRunId={waitingRunId}
              savedSelection={savedReferences}
              onConfirmedChange={(ok) =>
                setConfirmed((prev) => ({
                  runId: waitingRunId ?? 0,
                  ok,
                  version: prev.version + (ok ? 1 : 0),
                }))
              }
            />
          ) : null}
        </NowMark>
        <div className={styles.columns}>
          <div className={styles.optionsSlot}>
            <NowMark label={STEP_GUIDE_COMMON.nowMark} active={marked('generate')}>
              <GenerationOptionsPanel
                stepRunId={currentRunId}
                waiting={waitingRunId !== null}
                referencesConfirmed={referencesConfirmed}
                referencesVersion={confirmed.version}
                hasCandidates={runs.length > 0}
                busyReason={busyReason}
                onStateChange={onGenState}
                onGenerate={(options) => generate(allSlots(candidateCount), options)}
              />
            </NowMark>
          </div>
          <div className={styles.growSlot}>
            <NowMark label={STEP_GUIDE_COMMON.nowMark} active={marked('pickCandidate', 'retry')}>
              <CandidateGrid
                runs={runs}
                candidateCount={candidateCount}
                selectable={selectable}
                pick={pick}
                onChooseRepresentative={(id) => setPick(chooseRepresentative(pick, id))}
                onToggleAdditional={(id) => setPick(toggleAdditional(pick, id))}
                canRegenerate={waitingRunId !== null}
                regenerateDisabledReason={regenerateReason}
                onRegenerate={regenerate}
              />
            </NowMark>
          </div>
        </div>
        {createError ? (
          <Banner tone="blocked" role="alert">
            {createError}
          </Banner>
        ) : null}
        <div className={styles.columns}>
          <SideBySide
            references={output?.references ?? []}
            sourceImages={sources.data?.items ?? []}
            selected={
              pick.representative !== null && representativeRun
                ? { imageAssetId: pick.representative, slotNo: representativeRun.slotNo }
                : null
            }
          />
          <div className={styles.growSlot}>
            <NowMark label={STEP_GUIDE_COMMON.nowMark} active={marked('passG3', 'done')}>
              {candidateId !== null ? (
                <G3Checklist
                  candidateId={candidateId}
                  output={output}
                  selectedColor={candidate.data?.selectedColor}
                  pick={pick}
                  representativeSlotNo={representativeRun?.slotNo ?? null}
                  running={running}
                  passedSame={passedSame}
                  pending={pass.isPending}
                  error={pass.error}
                  onPass={passG3}
                />
              ) : null}
            </NowMark>
          </div>
        </div>
      </section>
    </>
  );
}
