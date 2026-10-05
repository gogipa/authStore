import { Navigate, useLocation } from 'react-router';
import { SETUP_WIZARD_PATH } from '@/features/guide';

/**
 * 예전 주소 `/welcome`(D-29 5번 '첫 실행 안내') → `/setup`(D-30 설정 마법사). 단계(`?step`)·조각(`#`)은 그대로 넘기고,
 * 뒤로 가기가 `/welcome`에 머물지 않게 replace로 보낸다.
 */
export function WelcomeRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: SETUP_WIZARD_PATH, search, hash }} replace />;
}
