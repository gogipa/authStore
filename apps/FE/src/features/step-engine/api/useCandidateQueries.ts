import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import type {
  ListAttentionStepsParams,
  ListCandidatesParams,
  ListStatusHistoryParams,
} from '../model/types';
import { stepEngineKeys } from './queryKeys';

/**
 * 여정 목록(`GET /candidates`, listCandidates). status를 주지 않으면 EXCLUDED·REGISTERED를 뺀다.
 * `runnableStep`이면 그 단계를 지금 실행할 수 있는 여정만(입력 고르기). SSE `candidate.status-changed`로 다시 읽는다.
 */
export function useCandidates(params: ListCandidatesParams = {}) {
  return useQuery({
    queryKey: stepEngineKeys.candidates(params),
    queryFn: ({ signal }) =>
      request(() => api.GET('/candidates', { params: { query: params }, signal })),
    placeholderData: keepPreviousData,
  });
}

/**
 * 여정 상세(`GET /candidates/{candidateId}`, getCandidate). `candidateId`가 null이면 부르지 않는다
 * (경로 값이 정수가 아닐 때). 없는 여정은 404 `CANDIDATE_NOT_FOUND`(`error.code`).
 */
export function useCandidate(candidateId: number | null) {
  return useQuery({
    queryKey: stepEngineKeys.candidate(candidateId ?? 0),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}', {
          params: { path: { candidateId: candidateId ?? 0 } },
          signal,
        }),
      ),
    enabled: candidateId !== null,
  });
}

/** 상태별 여정 수(`GET /candidates/status-counts`). 목록 필터 배지가 쓴다 */
export function useCandidateStatusCounts() {
  return useQuery({
    queryKey: stepEngineKeys.statusCounts,
    queryFn: ({ signal }) => request(() => api.GET('/candidates/status-counts', { signal })),
  });
}

/** 이어서 할 곳 한 건(`GET /candidates/resume-target`). 204(없음)면 `null` */
export function useResumeTarget() {
  return useQuery({
    queryKey: stepEngineKeys.resumeTarget,
    queryFn: async ({ signal }) =>
      (await request(() => api.GET('/candidates/resume-target', { signal }))) ?? null,
  });
}

/** 재실행 필요·멈춘 여정 단계(`GET /candidate-steps`, listAttentionCandidateSteps). 기본 RERUN_REQUIRED·FAILED·WAITING_INPUT */
export function useAttentionSteps(params: ListAttentionStepsParams = {}) {
  return useQuery({
    queryKey: stepEngineKeys.attentionSteps(params),
    queryFn: ({ signal }) =>
      request(() => api.GET('/candidate-steps', { params: { query: params }, signal })),
  });
}

/** 여정 상태 전이 이력(`GET /candidates/{candidateId}/status-history`) */
export function useCandidateStatusHistory(
  candidateId: number | null,
  params: ListStatusHistoryParams = {},
) {
  return useQuery({
    queryKey: stepEngineKeys.statusHistory(candidateId ?? 0, params),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/status-history', {
          params: { path: { candidateId: candidateId ?? 0 }, query: params },
          signal,
        }),
      ),
    enabled: candidateId !== null,
  });
}
