import { qk } from '@/shared/api/queryKeys';

/**
 * ③ 판정 queryKey(03-2 §6.2, P2-05). 여정 한 건 키의 파라미터는 `{ candidateId }`로 시작한다 — SSE 무효화
 * (`step-run.status-changed`(PRICING)·`gate.passed`·`gate.invalidated`, shared/api/events.ts)가 부분 일치로 닿는다.
 */
export const pricingKeys = {
  priceJudgementAll: qk('pricing', 'getPriceJudgement'),
  priceJudgement: (candidateId: number, stepRunId?: number) =>
    qk('pricing', 'getPriceJudgement', {
      candidateId,
      ...(stepRunId !== undefined ? { stepRunId } : {}),
    }),
  domesticPricesAll: qk('pricing', 'listDomesticPrices'),
  domesticPrices: (candidateId: number, params: { page?: number; size?: number } = {}) =>
    qk('pricing', 'listDomesticPrices', { candidateId, ...params }),
  naverShoppingLinks: (candidateId: number) =>
    qk('pricing', 'listNaverShoppingLinks', { candidateId }),
};
