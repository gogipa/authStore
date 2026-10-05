import { qk } from '@/shared/api/queryKeys';

/** tags 태그 전체 */
export const TAGS_TAG_KEY = ['tags'] as const;

/**
 * ⑦ 태그 queryKey(03-2 §6.2 `['tags', operationId, params]`, P3-05). 여정 한 건 키의 파라미터는 `{ candidateId }`로 시작한다 —
 * SSE 무효화(`step-run.status-changed`(TAGS), shared/api/events.ts)가 부분 일치로 닿는다.
 */
export const tagsKeys = {
  /** ⑦ 산출물(현재 버전 또는 `stepRunId` 버전) */
  tagSet: (candidateId: number, stepRunId?: number) =>
    qk('tags', 'getCandidateTagSet', {
      candidateId,
      ...(stepRunId !== undefined ? { stepRunId } : {}),
    }),
  /** 경쟁 태그 입력 목록(활성) */
  competitorInputs: (candidateId: number) => qk('tags', 'listTagCompetitorInputs', { candidateId }),
};
