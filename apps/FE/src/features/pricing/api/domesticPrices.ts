import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import type { DomesticPriceCreateRequest } from '../model/judgement';
import { pricingKeys } from './queryKeys';

/** 국내 기준가 입력 이력(`GET …/domestic-prices`, 기본 `enteredAt,desc`). 최신 행이 현재 값이다 */
export function useDomesticPricesQuery(
  candidateId: number | null,
  params: { page?: number; size?: number } = {},
) {
  return useQuery({
    queryKey: pricingKeys.domesticPrices(candidateId ?? 0, params),
    enabled: candidateId !== null,
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/domestic-prices', {
          params: { path: { candidateId: candidateId ?? 0 }, query: params },
          signal,
        }),
      ),
  });
}

/**
 * 국내 기준가 입력(`POST …/domestic-prices`, 201 + `pricingStepStatus`). ③이 기다리면 서버가 이어 계산하고(RUNNING), 완료였으면
 * 값이 바뀔 때 재실행 필요가 된다. 성공하면 판정·입력 이력과 단계 레일·후보·게이트를 다시 읽는다. 실패(409·422)는
 * `ApiRequestError`(fieldErrors는 칸 옆에).
 */
export function useCreateDomesticPriceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      candidateId,
      body,
    }: {
      candidateId: number;
      body: DomesticPriceCreateRequest;
    }) =>
      request(() =>
        api.POST('/candidates/{candidateId}/domestic-prices', {
          params: { path: { candidateId } },
          body,
        }),
      ),
    onSuccess: async (_data, { candidateId }) => {
      await Promise.all(
        [
          qk('pricing', 'getPriceJudgement', { candidateId }),
          qk('pricing', 'listDomesticPrices', { candidateId }),
          qk('step-engine', 'listCandidateSteps', { candidateId }),
          qk('step-engine', 'getCandidate', { candidateId }),
          qk('step-engine', 'listCandidateGates', { candidateId }),
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  });
}
