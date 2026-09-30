import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import type { operations } from '@/shared/api/schema';
import type { FxRateManualInput } from '../model/fx';

/** `GET /fx-rates` 쿼리(05-2 listFxRates) */
export type FxRatesParams = NonNullable<operations['listFxRates']['parameters']['query']>;

/** pricing 태그 환율 queryKey(03-2 §6.2). `fx-rate.updated` SSE가 최신값·이력을 무효화한다(shared/api/events.ts) */
export const fxRatesKeys = {
  latest: qk('pricing', 'getLatestFxRates'),
  all: qk('pricing', 'listFxRates'),
  list: (params: FxRatesParams = {}) => qk('pricing', 'listFxRates', params),
};

/** 종류·통화별 최신 환율과 경고(`GET /fx-rates/latest`). SCR-10 환율 탭·요약, SCR-04 ③(P2-05)이 쓴다 */
export function useLatestFxRatesQuery() {
  return useQuery({
    queryKey: fxRatesKeys.latest,
    queryFn: ({ signal }) => request(() => api.GET('/fx-rates/latest', { signal })),
  });
}

/** 환율 기록 이력(`GET /fx-rates`, 페이징·필터) */
export function useFxRatesQuery(params: FxRatesParams = {}) {
  return useQuery({
    queryKey: fxRatesKeys.list(params),
    queryFn: ({ signal }) =>
      request(() => api.GET('/fx-rates', { params: { query: params }, signal })),
  });
}

/**
 * 환율 직접 입력(`POST /fx-rates`, 201). 성공하면 최신값·이력을 다시 읽는다. 새 최신값이 ③을 재실행 필요로 만들면
 * 서버가 SSE(`candidate-step.changed`)로 알린다. 실패: 422 `VALIDATION_FAILED`(fieldErrors — 칸 옆에 보인다).
 */
export function useCreateManualFxRateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: FxRateManualInput) => request(() => api.POST('/fx-rates', { body })),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: fxRatesKeys.latest }),
        queryClient.invalidateQueries({ queryKey: fxRatesKeys.all }),
      ]);
    },
  });
}
