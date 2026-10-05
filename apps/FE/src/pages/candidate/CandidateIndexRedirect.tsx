import { Navigate, useParams } from 'react-router';
import { parseCandidateId, resumeRelativePath, useCandidate } from '@/features/step-engine';

/**
 * /candidates/:candidateId 로 들어오면 이어 할 단계 화면으로 `replace` 이동한다(05-1 route맵 §3-2).
 * 이어 할 단계는 서버가 목록·상세에 같은 흐름 순서 함수로 계산한 `resumeStepCode`다. 없으면(모두 완료) 최종 승인.
 * 이어 하기는 화면만 연다(아무것도 다시 만들지 않는다). 여정을 못 읽으면 틀(CandidateLayout)이 이유를 보인다.
 */
export function CandidateIndexRedirect() {
  const { candidateId: rawId } = useParams();
  const candidate = useCandidate(parseCandidateId(rawId));
  if (!candidate.data) return null;
  return <Navigate to={resumeRelativePath(candidate.data.resumeStepCode)} replace />;
}
