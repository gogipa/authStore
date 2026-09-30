import { qk } from '@/shared/api/queryKeys';

/** content 태그 전체 */
export const CONTENT_TAG_KEY = ['content'] as const;

/**
 * ⑥ 상세 콘텐츠 queryKey(03-2 §6.2 `['content', operationId, params]`, P3-03). 후보 한 건 키의 파라미터는 `{ candidateId }`로
 * 시작한다 — SSE 무효화(`step-run.status-changed`(COPY·NOTICE_RAW·NOTICE_HTML)·`content-field.recheck-flagged`·`gate.passed`,
 * shared/api/events.ts)가 부분 일치로 닿는다.
 */
export const contentKeys = {
  copy: (candidateId: number, stepRunId?: number) =>
    qk('content', 'getCandidateContentCopy', {
      candidateId,
      ...(stepRunId !== undefined ? { stepRunId } : {}),
    }),
  fact: (candidateId: number, stepRunId?: number) =>
    qk('content', 'getCandidateContentFact', {
      candidateId,
      ...(stepRunId !== undefined ? { stepRunId } : {}),
    }),
  /** ⑥-3 조립 결과(P3-04) */
  assembly: (candidateId: number, stepRunId?: number) =>
    qk('content', 'getCandidateContentAssembly', {
      candidateId,
      ...(stepRunId !== undefined ? { stepRunId } : {}),
    }),
};
