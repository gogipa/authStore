import { Navigate } from 'react-router';
import { DEFAULT_STEP, stepRelativePath } from '@/shared/lib/steps';

/**
 * /candidates/:candidateId 로 들어오면 현재 단계 화면으로 보낸다.
 * 후보 API(resumeStepCode)를 붙이기 전에는 첫 단계(② 소싱)로 보낸다.
 */
export function CandidateIndexRedirect() {
  return <Navigate to={stepRelativePath(DEFAULT_STEP)} replace />;
}
