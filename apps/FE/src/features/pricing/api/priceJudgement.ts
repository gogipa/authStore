import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { pricingKeys } from './queryKeys';

/**
 * ③ 판정 결과와 사이즈별 비용 분해(`GET /candidates/{candidateId}/price-judgement`, getPriceJudgement). `stepRunId`를 주면
 * 그 버전, 없으면 현재 버전. 판정 스냅샷이 없으면(실행 전·입력 대기·실패) 404 `STEP_OUTPUT_NOT_FOUND` — 다시 시도하지 않는다.
 * candidateId가 null이면 부르지 않는다.
 */
export function usePriceJudgementQuery(candidateId: number | null, stepRunId?: number) {
  return useQuery({
    queryKey: pricingKeys.priceJudgement(candidateId ?? 0, stepRunId),
    enabled: candidateId !== null,
    retry: (count, error) => error.code !== 'STEP_OUTPUT_NOT_FOUND' && count < 1,
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/price-judgement', {
          params: {
            path: { candidateId: candidateId ?? 0 },
            query: stepRunId !== undefined ? { stepRunId } : {},
          },
          signal,
        }),
      ),
  });
}
