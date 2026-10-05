import { useParams } from 'react-router';
import { NowMark, ScreenGuidePanel, STEP_GUIDE_COMMON, TAGS_GUIDE } from '@/features/guide';
import {
  parseCandidateId,
  railByCode,
  runButtonLabel,
  StepStatusBar,
  useCandidate,
  useCandidateSteps,
  useStartStepRun,
} from '@/features/step-engine';
import {
  CATEGORY_UNDECIDED_LABEL,
  tagsSourceText,
  useTagCompetitorInputsQuery,
  useTagSetQuery,
} from '@/features/tags';
import { useDocumentTitle } from '@/shared/lib/appName';
import { Button, Chip, DisabledReason } from '@/shared/ui';
import { CandidateTagsPanel } from './CandidateTagsPanel';
import { CompetitorInputPanel } from './CompetitorInputPanel';
import { ExcludedTagsTable } from './ExcludedTagsTable';
import { FinalTagsPanel } from './FinalTagsPanel';
import { tagsNowKey } from './tagsNow';
import styles from './TagsPage.module.css';

const TITLE = '태그';

/**
 * SCR-07 ⑦ 태그(Tags.dc.html, P3-05). 여정 틀(CandidateLayout) 안 단계 본문:
 * - ⑦ 머리: 제목 + ('카테고리 미확정' 칩 — ④ 전에 뽑은 버전) + 상태 줄(StepStatusBar — '실행'/'다시 실행', 입력 출처
 *   "시드 키워드 '…' · 경쟁 태그 …", '여기부터 연속 실행')
 * - '최종 태그'(FinalTagsPanel — n/10, RemovableTag 삭제·'태그 추가' = owner-edits TAGS EDIT 202, '다음: 최종 승인')
 * - [후보 태그(CandidateTagsPanel — 거르기·표·선정 순서·요약) | 경쟁 태그 입력(CompetitorInputPanel) + 뺀 태그와 사유
 *   (ExcludedTagsTable)]
 * - 맨 위 안내(D-41, `ScreenGuidePanel`): 하는 일 · 지금 할 일 · 낯선 말 풀이. '지금 여기'는 [실행] 자리(실행할 차례)나 '최종 태그'(확인할 차례)에 붙는다
 * 결과는 폴링하지 않고 SSE `step-run.status-changed`(TAGS)가 산출물·입력 목록을 다시 읽힌다. ⑦이 실행 중(편집 재검증 포함)이면
 * 새 버전 산출물이 아직 없어(404) 마지막으로 받은 값을 그대로 보인다. 시안의 '점수' 열은 M2라 만들지 않는다.
 */
export function TagsPage() {
  const pageTitle = useDocumentTitle(TITLE);
  const { candidateId: rawId = '' } = useParams();
  const candidateId = parseCandidateId(rawId);
  const rail = useCandidateSteps(candidateId);
  const candidate = useCandidate(candidateId);
  const start = useStartStepRun();
  const item = railByCode(rail.data?.items).TAGS;
  const currentRunId = item?.currentStepRunId ?? null;
  const tagSet = useTagSetQuery(currentRunId !== null ? candidateId : null);
  const inputs = useTagCompetitorInputsQuery(candidateId);
  const set = tagSet.data;
  const running = item?.status === 'RUNNING';
  const editable =
    set !== undefined &&
    set.isCurrent &&
    set.stepRunId === currentRunId &&
    (item?.status === 'COMPLETED' || item?.status === 'RERUN_REQUIRED');
  const runAction = item?.actions.run;
  const runReason =
    runAction && !runAction.enabled ? (runAction.disabledReason?.message ?? null) : null;
  const inputItems = inputs.data?.items ?? [];
  // 맨 위 안내(D-41): 화면에 이미 있는 값만 읽어 지금 할 일 한 가지를 고른다. 최종 태그 수는 현재 버전 산출물일 때만 센다
  const currentSet =
    set !== undefined && set.isCurrent && set.stepRunId === currentRunId ? set : undefined;
  const finalTagCount = currentSet?.finalTags.length;
  const nowKey = tagsNowKey({
    stepStatus: item?.status,
    runBlocked: runReason !== null,
    competitorInputCount: inputs.data ? inputs.data.items.length : undefined,
    finalTagCount,
  });
  const runNow =
    nowKey === 'blocked' ||
    nowKey === 'start' ||
    nowKey === 'startWithCompetitor' ||
    nowKey === 'rerun' ||
    nowKey === 'failed';

  const run = () => {
    if (candidateId === null) return;
    start.reset();
    start.mutate({ candidateId, stepCode: 'TAGS', body: {} });
  };

  return (
    <>
      <title>{pageTitle}</title>
      <h1 className={styles.srOnly}>{TITLE}</h1>
      <ScreenGuidePanel
        guide={TAGS_GUIDE}
        nowKey={nowKey}
        values={finalTagCount !== undefined ? { count: finalTagCount } : {}}
      />
      <section aria-labelledby="step7-title" className={styles.step}>
        <div className={styles.stepHead}>
          <h2 id="step7-title" className={styles.stepTitle}>
            ⑦ 태그
          </h2>
          {set && set.leafCategoryId === null ? (
            <Chip tone="waiting">{CATEGORY_UNDECIDED_LABEL}</Chip>
          ) : null}
          <div className={styles.bar}>
            {item ? (
              <StepStatusBar
                item={item}
                source={tagsSourceText(set, inputItems)}
                candidateId={candidateId ?? undefined}
                error={start.error ?? undefined}
                actions={
                  <NowMark inline label={STEP_GUIDE_COMMON.nowMark} active={runNow}>
                    <Button
                      disabled={start.isPending || runReason !== null}
                      aria-describedby={runReason ? 'tags-run-why' : undefined}
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
          <DisabledReason id="tags-run-why" className={styles.reason}>
            {runReason}
          </DisabledReason>
        ) : null}
        {candidateId !== null ? (
          <>
            <NowMark
              label={STEP_GUIDE_COMMON.nowMark}
              active={nowKey === 'done' || nowKey === 'noTags'}
            >
              <FinalTagsPanel
                key={set?.stepRunId ?? 'none'}
                candidateId={candidateId}
                set={set}
                editable={editable}
                running={running}
              />
            </NowMark>
            <div className={styles.columns}>
              <CandidateTagsPanel
                set={set}
                candidateLeaf={
                  candidate.data
                    ? {
                        leafCategoryId: candidate.data.leafCategoryId ?? null,
                        wholeCategoryName: candidate.data.wholeCategoryName ?? null,
                      }
                    : null
                }
              />
              <div className={styles.side}>
                <CompetitorInputPanel
                  candidateId={candidateId}
                  inputs={inputItems}
                  running={running}
                />
                <ExcludedTagsTable candidates={set?.candidates ?? []} />
              </div>
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}
