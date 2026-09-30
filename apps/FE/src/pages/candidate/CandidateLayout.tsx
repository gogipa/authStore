import { Outlet, useMatch, useParams } from 'react-router';
import {
  CandidateDetailHeader,
  CandidateHeader,
  CONTENT_GROUP_CODES,
  contentGroupStatus,
  gateStateMap,
  gateViewsFromList,
  parseCandidateId,
  railByCode,
  RerunAllButton,
  useCandidate,
  useCandidateGates,
  useCandidateSteps,
} from '@/features/step-engine';
import { isStepScreen, type StepCode } from '@/shared/lib/steps';
import { Banner, ButtonLink, Chip, PageHeader } from '@/shared/ui';
import { StepRail, type RailStepStatus } from './StepRail';
import styles from './CandidateLayout.module.css';

function BackToList() {
  return <ButtonLink to="/candidates">후보 목록</ButtonLink>;
}

/**
 * 후보 작업(SCR-12): 후보 머리 + [단계 레일 | 단계 본문(<Outlet/>)].
 * 단계 화면(SCR-03~08)은 자식 경로로 이 틀 안에 그려진다. 틀은 eager(05-4 §4).
 * 후보 머리는 `getCandidate`로 채운다(P1-04). 없는 후보(404 CANDIDATE_NOT_FOUND·정수 아닌 id)는 틀 안에
 * '후보를 찾을 수 없습니다' + '후보 목록'(05-1 route맵 §3-3).
 * 레일(P1-05): 단계 상태·실패(중단됨)·재실행 사유는 `listCandidateSteps`, ⑥ 줄은 하위 단계 묶음 규칙, URL 후보는
 * '수동'·'비교 안 함' 배지. 게이트는 후보 머리와 같은 표시(`listCandidateGates`, P1-06). 레일 아래
 * '재실행 필요 단계 모두 실행'은 RERUN_STALE 연속 실행(P1-06)이다.
 */
export function CandidateLayout() {
  const { candidateId: rawId = '' } = useParams();
  const candidateId = parseCandidateId(rawId);
  const candidate = useCandidate(candidateId);
  const rail = useCandidateSteps(candidateId);
  const gateList = useCandidateGates(candidateId);
  const match = useMatch('/candidates/:candidateId/:screen');
  const screen = match?.params.screen;
  const currentScreen = isStepScreen(screen) ? screen : undefined;

  const notFound = candidateId === null || candidate.error?.code === 'CANDIDATE_NOT_FOUND';
  if (notFound) {
    return (
      <PageHeader
        title="후보를 찾을 수 없습니다"
        description="지워졌거나 주소가 잘못되었습니다. 후보 목록에서 다시 고르세요."
        actions={<BackToList />}
      />
    );
  }

  const items = rail.data?.items ?? [];
  const byCode = railByCode(items);
  const statuses: Partial<Record<StepCode, RailStepStatus>> = {};
  const staleInputs: Partial<Record<StepCode, readonly string[]>> = {};
  for (const item of items) {
    statuses[item.stepCode] = {
      status: item.status,
      failureKind: item.currentRun?.failureKind ?? null,
    };
    if (item.status === 'RERUN_REQUIRED') staleInputs[item.stepCode] = item.staleInputs;
  }
  const groupStatuses = rail.data
    ? { content: { status: contentGroupStatus(CONTENT_GROUP_CODES.map((c) => byCode[c])) } }
    : undefined;
  const gates = candidate.data
    ? gateStateMap(gateViewsFromList(gateList.data?.items, candidate.data))
    : undefined;
  const rerunCount = items.filter((item) => item.status === 'RERUN_REQUIRED').length;

  return (
    <>
      {candidate.data ? (
        <CandidateDetailHeader detail={candidate.data} actions={<BackToList />} />
      ) : (
        <CandidateHeader
          title={`후보 #${candidateId}`}
          caption={candidate.isError ? undefined : '후보 정보를 불러오는 중입니다.'}
          actions={<BackToList />}
        />
      )}
      {candidate.isError ? <Banner tone="warning">{candidate.error.message}</Banner> : null}
      <div className={styles.body}>
        <StepRail
          candidateId={String(candidateId)}
          currentScreen={currentScreen}
          statuses={rail.data ? statuses : undefined}
          groupStatuses={groupStatuses}
          staleInputs={staleInputs}
          gates={gates}
          badges={
            candidate.data?.creationPath === 'RAKUTEN_URL' ? (
              <>
                <Chip tone="neutral">수동</Chip>
                <Chip tone="outline">비교 안 함</Chip>
              </>
            ) : undefined
          }
          footer={
            <RerunAllButton
              id="rail-rerun-why"
              size="sm"
              reasonPosition="after"
              candidateId={candidateId}
              rerunCount={rerunCount}
              chainOpen={!!candidate.data?.openContinuousRun}
              locked={!!candidate.data?.locked || candidate.data?.status === 'EXCLUDED'}
            />
          }
        />
        <div className={styles.stepBody}>
          <Outlet />
        </div>
      </div>
    </>
  );
}
