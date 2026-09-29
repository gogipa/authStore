import { qk } from '@/shared/api/queryKeys';
import type {
  ListAttentionStepsParams,
  ListCandidatesParams,
  ListStatusHistoryParams,
} from '../model/types';

/** step-engine 태그 전체. 후보를 바꾸는 요청(만들기·제외·다시 작업·성별)이 끝나면 이 키로 무효화한다. */
export const STEP_ENGINE_TAG_KEY = ['step-engine'] as const;

/**
 * step-engine queryKey(03-2 §6.2: `['step-engine', operationId, params]`). 파라미터 없는 키는 그 연산 전체다
 * (SSE 무효화가 쓴다). 후보 한 건 키의 파라미터는 `{ candidateId }` 하나로 고정한다.
 */
export const stepEngineKeys = {
  candidatesAll: qk('step-engine', 'listCandidates'),
  candidates: (params: ListCandidatesParams) => qk('step-engine', 'listCandidates', params),
  candidateAll: qk('step-engine', 'getCandidate'),
  candidate: (candidateId: number) => qk('step-engine', 'getCandidate', { candidateId }),
  statusCounts: qk('step-engine', 'getCandidateStatusCounts'),
  resumeTarget: qk('step-engine', 'getCandidateResumeTarget'),
  attentionStepsAll: qk('step-engine', 'listAttentionCandidateSteps'),
  attentionSteps: (params: ListAttentionStepsParams) =>
    qk('step-engine', 'listAttentionCandidateSteps', params),
  statusHistoryAll: qk('step-engine', 'listCandidateStatusHistory'),
  statusHistory: (candidateId: number, params: ListStatusHistoryParams = {}) =>
    qk('step-engine', 'listCandidateStatusHistory', { candidateId, ...params }),
};
