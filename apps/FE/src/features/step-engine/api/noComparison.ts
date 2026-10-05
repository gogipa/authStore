import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { stepEngineKeys } from './queryKeys';

/**
 * '비교 없이 확정' 체크·해제(`PUT`·`DELETE /candidates/{candidateId}/no-comparison-confirmation`, P2-05). 웹 화면 전용 기록.
 * 성공하면 여정 상세·게이트를 다시 읽는다(G2 막힌 이유 NO_COMPARISON_NOT_CONFIRMED가 바뀐다). 실패: 409
 * CONFIRMATION_NOT_APPLICABLE(비교한 여정)·GATE_ALREADY_PASSED(G2 뒤 해제)·CANDIDATE_LOCKED·CANDIDATE_EXCLUDED.
 */
function useInvalidateNoComparison() {
  const queryClient = useQueryClient();
  return (candidateId: number) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: stepEngineKeys.candidate(candidateId) }),
      queryClient.invalidateQueries({ queryKey: stepEngineKeys.candidateGates(candidateId) }),
    ]);
}

export function useConfirmNoComparisonMutation() {
  const invalidate = useInvalidateNoComparison();
  return useMutation({
    mutationFn: (candidateId: number) =>
      request(() =>
        api.PUT('/candidates/{candidateId}/no-comparison-confirmation', {
          params: { path: { candidateId } },
        }),
      ),
    onSuccess: (_data, candidateId) => invalidate(candidateId),
  });
}

export function useRevokeNoComparisonMutation() {
  const invalidate = useInvalidateNoComparison();
  return useMutation({
    mutationFn: (candidateId: number) =>
      request(() =>
        api.DELETE('/candidates/{candidateId}/no-comparison-confirmation', {
          params: { path: { candidateId } },
        }),
      ),
    onSuccess: (_data, candidateId) => invalidate(candidateId),
  });
}
