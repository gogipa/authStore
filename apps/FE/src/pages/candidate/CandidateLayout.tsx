import { Outlet, useMatch, useParams } from 'react-router';
import {
  CandidateDetailHeader,
  CandidateHeader,
  parseCandidateId,
  useCandidate,
} from '@/features/step-engine';
import { isStepScreen } from '@/shared/lib/steps';
import { Banner, ButtonLink, PageHeader } from '@/shared/ui';
import { StepRail } from './StepRail';
import styles from './CandidateLayout.module.css';

function BackToList() {
  return <ButtonLink to="/candidates">후보 목록</ButtonLink>;
}

/**
 * 후보 작업(SCR-12): 후보 머리 + [단계 레일 | 단계 본문(<Outlet/>)].
 * 단계 화면(SCR-03~08)은 자식 경로로 이 틀 안에 그려진다. 틀은 eager(05-4 §4).
 * 후보 머리는 `getCandidate`로 채운다(P1-04). 없는 후보(404 CANDIDATE_NOT_FOUND·정수 아닌 id)는 틀 안에
 * '후보를 찾을 수 없습니다' + '후보 목록'(05-1 route맵 §3-3). 레일의 단계 상태·게이트는 P1-05·P1-06이 채운다.
 */
export function CandidateLayout() {
  const { candidateId: rawId = '' } = useParams();
  const candidateId = parseCandidateId(rawId);
  const candidate = useCandidate(candidateId);
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
        <StepRail candidateId={String(candidateId)} currentScreen={currentScreen} />
        <div className={styles.stepBody}>
          <Outlet />
        </div>
      </div>
    </>
  );
}
