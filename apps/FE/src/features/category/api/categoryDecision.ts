import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import type { CategorySelectionRequest } from '../model/category';
import { categoryKeys } from './queryKeys';

/**
 * ④ 카테고리 결정(`GET /candidates/{candidateId}/category-decision`, getCategoryDecision). `stepRunId`를 주면 그 버전, 없으면
 * 현재 버전. 실행 전·실패면 404 `STEP_OUTPUT_NOT_FOUND` — 다시 시도하지 않는다. candidateId가 null이면 부르지 않는다.
 */
export function useCategoryDecisionQuery(candidateId: number | null, stepRunId?: number) {
  return useQuery({
    queryKey: categoryKeys.decision(candidateId ?? 0, stepRunId),
    enabled: candidateId !== null,
    retry: (count, error) => error.code !== 'STEP_OUTPUT_NOT_FOUND' && count < 1,
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/category-decision', {
          params: {
            path: { candidateId: candidateId ?? 0 },
            query: stepRunId !== undefined ? { stepRunId } : {},
          },
          signal,
        }),
      ),
  });
}

/** 결정·단계 레일·후보 머리(리프 카테고리)·게이트를 다시 읽는다 */
function useInvalidateCategory() {
  const queryClient = useQueryClient();
  return (candidateId: number) =>
    Promise.all(
      [
        qk('category', 'getCategoryDecision', { candidateId }),
        qk('step-engine', 'listCandidateSteps', { candidateId }),
        qk('step-engine', 'getCandidate', { candidateId }),
        qk('step-engine', 'listCandidateGates', { candidateId }),
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
}

/**
 * 리프 카테고리 고르기(`PUT /category-decisions/{id}/selection`, ④ 완료). 'KC 면제 성인용 확인'은 웹 화면에서 누른 것만
 * 보낸다(05-1 §1.2). 성공하면 결정·단계 레일·후보 머리를 다시 읽고, 409(막힘·KC 확인 없음 등)여도 결정을 다시 읽는다(캐시 예외가
 * 바뀌었을 수 있다). 실패는 `ApiRequestError`(05-3 봉투).
 */
export function useSelectCategoryLeafMutation() {
  const invalidate = useInvalidateCategory();
  return useMutation({
    mutationFn: ({
      categoryDecisionId,
      body,
    }: {
      candidateId: number;
      categoryDecisionId: number;
      body: CategorySelectionRequest;
    }) =>
      request(() =>
        api.PUT('/category-decisions/{categoryDecisionId}/selection', {
          params: { path: { categoryDecisionId } },
          body,
        }),
      ),
    onSettled: (_data, _error, { candidateId }) => invalidate(candidateId),
  });
}
