import { Outlet, useMatch, useParams } from 'react-router';
import { isStepScreen } from '@/shared/lib/steps';
import { ButtonLink } from '@/shared/ui';
import { CandidateHeader } from './CandidateHeader';
import { StepRail } from './StepRail';
import styles from './CandidateLayout.module.css';

/**
 * 후보 작업(SCR-12): 후보 머리 + [단계 레일 | 단계 본문(<Outlet/>)].
 * 단계 화면(SCR-03~08)은 자식 경로로 이 틀 안에 그려진다. 틀은 eager(05-4 §4).
 * 후보 이름·게이트·단계 상태는 후보·단계 API를 붙이는 P1-04·P1-05가 채운다(값이 없으면 칩을 그리지 않는다).
 */
export function CandidateLayout() {
  const { candidateId = '' } = useParams();
  const match = useMatch('/candidates/:candidateId/:screen');
  const screen = match?.params.screen;
  const currentScreen = isStepScreen(screen) ? screen : undefined;

  return (
    <>
      <CandidateHeader
        title={`후보 ${candidateId}`}
        caption="후보 정보는 아직 불러오지 않습니다."
        actions={<ButtonLink to="/candidates">후보 목록</ButtonLink>}
      />
      <div className={styles.body}>
        <StepRail candidateId={candidateId} currentScreen={currentScreen} />
        <div className={styles.stepBody}>
          <Outlet />
        </div>
      </div>
    </>
  );
}
