import { Outlet, useMatch, useParams } from 'react-router';
import { isStepScreen } from '@/shared/lib/steps';
import { ButtonLink } from '@/shared/ui';
import { StepRail } from './StepRail';
import styles from './CandidateLayout.module.css';

/**
 * 후보 작업(SCR-12): 후보 머리 + [단계 레일 | 단계 본문(<Outlet/>)].
 * 단계 화면(SCR-03~08)은 자식 경로로 이 틀 안에 그려진다.
 */
export function CandidateLayout() {
  const { candidateId = '' } = useParams();
  const match = useMatch('/candidates/:candidateId/:screen');
  const screen = match?.params.screen;
  const currentScreen = isStepScreen(screen) ? screen : undefined;

  return (
    <>
      {/* 후보 머리(공통부품_마크업.md §F): 후보 API를 붙이는 단계에서 상품명·앵커 키·게이트 상태를 채운다. */}
      <section aria-label="후보 정보" className={styles.candidateHeader}>
        <div className={styles.candidateText}>
          <span className={styles.candidateName}>후보 {candidateId}</span>
          <span className={styles.caption}>후보 정보는 아직 불러오지 않습니다.</span>
        </div>
        <ButtonLink to="/candidates">후보 목록</ButtonLink>
      </section>
      <div className={styles.body}>
        <StepRail candidateId={candidateId} currentScreen={currentScreen} />
        <div className={styles.stepBody}>
          <Outlet />
        </div>
      </div>
    </>
  );
}
