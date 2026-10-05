import { qk } from '@/shared/api/queryKeys';

/** category 태그 전체 */
export const CATEGORY_TAG_KEY = ['category'] as const;

/**
 * ④ 카테고리 queryKey(03-2 §6.2, P2-06). 여정 한 건 키의 파라미터는 `{ candidateId }`로 시작한다 — SSE 무효화
 * (`step-run.status-changed`(CATEGORY)·`candidate-step.changed`, shared/api/events.ts)가 부분 일치로 닿는다.
 */
export const categoryKeys = {
  decisionAll: qk('category', 'getCategoryDecision'),
  decision: (candidateId: number, stepRunId?: number) =>
    qk('category', 'getCategoryDecision', {
      candidateId,
      ...(stepRunId !== undefined ? { stepRunId } : {}),
    }),
};
