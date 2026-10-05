import { useCallback, useId, useRef, useState } from 'react';
import { Outlet, useLocation, useMatch, useParams } from 'react-router';
import { ScreenHelp } from '@/features/guide';
import {
  CandidateDetailHeader,
  CandidateHeader,
  CONTENT_GROUP_CODES,
  contentGroupStatus,
  EXCLUDED_NOTICE,
  EXCLUDED_NOTICE_NEXT,
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
import { Banner, ButtonLink, Chip, HelpButton, HelpPanel, Icon, PageHeader } from '@/shared/ui';
import { StepRail, type RailStepStatus } from './StepRail';
import styles from './CandidateLayout.module.css';

function BackToList() {
  // 왼쪽 화살표: 이 여정을 떠나 목록으로 나가는 버튼이지 작업 순서의 첫 단계가 아니다(D-36)
  return (
    <ButtonLink to="/candidates">
      <Icon name="arrow-left" size={16} />
      여정 목록
    </ButtonLink>
  );
}

/**
 * 여정(SCR-12): 여정 머리 + [단계 레일 | 단계 본문(<Outlet/>)].
 * 단계 화면(SCR-03~08)은 자식 경로로 이 틀 안에 그려진다. 틀은 eager(05-4 §4).
 * 여정 머리는 `getCandidate`로 채운다(P1-04). 없는 여정(404 CANDIDATE_NOT_FOUND·정수 아닌 id)은 틀 안에
 * '여정을 찾을 수 없습니다' + '여정 목록'(05-1 route맵 §3-3).
 * 레일(P1-05): 단계 상태·실패(중단됨)·재실행 사유는 `listCandidateSteps`, ⑥ 줄은 하위 단계 묶음 규칙, URL 여정은
 * '수동'·'비교 안 함' 배지. 게이트는 여정 머리와 같은 표시(`listCandidateGates`, P1-06). 레일 아래
 * '재실행 필요 단계 모두 실행'은 RERUN_STALE 연속 실행(P1-06)이다.
 * D-29(F-GD-02): 단계 화면은 제목이 여정 머리라 '?' 도움말 버튼을 여정 머리 오른쪽('여정 목록' 앞)에 두고, 도움말 판은
 * 여정 머리 바로 아래에 연다. 내용은 지금 단계 화면(②·③④·⑤·⑥·⑦·⑧⑨)의 도움말이다. 이 틀은 단계를 옮겨도 그대로 있으므로
 * 주소(경로)가 바뀌면 판을 닫는다 — 열림 상태는 기억하지 않고 화면을 옮기면 닫힌 채로 연다(화면시안_명세 §8.5).
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
  const { pathname } = useLocation();
  const helpId = `step-help-${useId()}`;
  const [helpOpen, setHelpOpen] = useState(false);
  // 다른 단계·다른 여정으로 옮기면 닫는다(그리는 중에 맞추는 React 방식 — effect 뒤 한 번 더 그리지 않는다)
  const [helpPath, setHelpPath] = useState(pathname);
  if (helpPath !== pathname) {
    setHelpPath(pathname);
    setHelpOpen(false);
  }
  const helpButton = useRef<HTMLButtonElement>(null);
  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    helpButton.current?.focus();
  }, []);

  const notFound = candidateId === null || candidate.error?.code === 'CANDIDATE_NOT_FOUND';
  if (notFound) {
    return (
      <PageHeader
        title="여정을 찾을 수 없습니다"
        description="지워졌거나 주소가 잘못되었습니다. 여정 목록에서 다시 고르세요."
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
  const headerActions = (
    <>
      {currentScreen ? (
        <HelpButton
          ref={helpButton}
          expanded={helpOpen}
          controls={helpId}
          onToggle={() => setHelpOpen((open) => !open)}
        />
      ) : null}
      <BackToList />
    </>
  );

  return (
    <>
      {candidate.data ? (
        <CandidateDetailHeader detail={candidate.data} actions={headerActions} />
      ) : (
        <CandidateHeader
          title={`여정 #${candidateId}`}
          caption={candidate.isError ? undefined : '여정 정보를 불러오는 중입니다.'}
          actions={headerActions}
        />
      )}
      {candidate.isError ? <Banner tone="warning">{candidate.error.message}</Banner> : null}
      {candidate.data?.status === 'EXCLUDED' ? (
        <Banner
          tone="blocked"
          actions={
            <ButtonLink to={`/candidates?status=EXCLUDED&candidateId=${candidateId}`} size="sm">
              여정 목록에서 다시 작업
            </ButtonLink>
          }
        >
          {candidate.data.excludedReason
            ? `${EXCLUDED_NOTICE[candidate.data.excludedReason]} `
            : ''}
          {EXCLUDED_NOTICE_NEXT}
        </Banner>
      ) : null}
      {currentScreen ? (
        <HelpPanel id={helpId} open={helpOpen} onClose={closeHelp}>
          <ScreenHelp screen={currentScreen} />
        </HelpPanel>
      ) : null}
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
