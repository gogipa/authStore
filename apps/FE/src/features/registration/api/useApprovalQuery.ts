import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request, type ApiRequestError } from '@/shared/api/errors';
import { registrationKeys, type RegistrationOptionType } from './queryKeys';

/** 상태·산출물 없음(409·404)은 다시 시도하지 않는다 */
const retryUnlessClientError = (count: number, error: ApiRequestError) =>
  error.status >= 500 && count < 1;

/**
 * G4 승인 미리보기(`GET /candidates/{candidateId}/approval`, getCandidateApproval — P4-02). 저장된 산출물만 읽는다(외부 호출 없음).
 * 승인대기가 아니면 409 `CANDIDATE_STATUS_INVALID`, 산출물이 없으면 404 — 다시 시도하지 않고 화면이 문구를 보인다. candidateId가
 * null이면 부르지 않는다. SSE `candidate-step.changed`·`gate.invalidated`·`candidate.status-changed`가 다시 읽힌다.
 */
export function useApprovalQuery(
  candidateId: number | null,
  optionType: RegistrationOptionType = 'COMBINATION',
) {
  return useQuery({
    queryKey: registrationKeys.approval(candidateId ?? 0, optionType),
    enabled: candidateId !== null,
    retry: retryUnlessClientError,
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/approval', {
          params: { path: { candidateId: candidateId ?? 0 }, query: { optionType } },
          signal,
        }),
      ),
  });
}
