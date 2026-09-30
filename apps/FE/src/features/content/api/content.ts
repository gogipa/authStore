import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import type { ContentFieldInputRequest } from '../model/content';
import { contentKeys } from './queryKeys';

/** 산출물이 아직 없거나(실행 전) 다른 버전 id면 다시 시도하지 않는다 */
const retryUnlessMissing = (count: number, error: { code: string }) =>
  error.code !== 'STEP_OUTPUT_NOT_FOUND' && error.code !== 'STEP_RUN_NOT_FOUND' && count < 1;

/**
 * ⑥-1 카피 산출물(`GET /candidates/{candidateId}/content-copy`, getCandidateContentCopy). `stepRunId`를 주면 그 버전.
 * 실행 전 404 `STEP_OUTPUT_NOT_FOUND`는 다시 시도하지 않는다. candidateId가 null이면 부르지 않는다.
 */
export function useContentCopyQuery(candidateId: number | null, stepRunId?: number) {
  return useQuery({
    queryKey: contentKeys.copy(candidateId ?? 0, stepRunId),
    enabled: candidateId !== null,
    retry: retryUnlessMissing,
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/content-copy', {
          params: {
            path: { candidateId: candidateId ?? 0 },
            query: stepRunId !== undefined ? { stepRunId } : {},
          },
          signal,
        }),
      ),
  });
}

/**
 * ⑥-2 고시 원자료와 원문 근거(`GET /candidates/{candidateId}/content-fact`, getCandidateContentFact). 입력 대기면
 * `pendingInputs`(예 `fact.origin`).
 */
export function useContentFactQuery(candidateId: number | null, stepRunId?: number) {
  return useQuery({
    queryKey: contentKeys.fact(candidateId ?? 0, stepRunId),
    enabled: candidateId !== null,
    retry: retryUnlessMissing,
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/content-fact', {
          params: {
            path: { candidateId: candidateId ?? 0 },
            query: stepRunId !== undefined ? { stepRunId } : {},
          },
          signal,
        }),
      ),
  });
}

/**
 * 열린 ⑥-2 실행에 필드 오너 입력(`PUT /step-runs/{stepRunId}/content-fields/{fieldKey}`, putContentFieldInput) — 원산지 직접
 * 넣기(웹 화면 전용). 대기 입력이 다 차면 서버가 ⑥-2를 끝낸다. 성공·실패 모두 단계 레일과 ⑥-2 산출물을 다시 읽는다.
 */
export function usePutContentFieldMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      stepRunId,
      fieldKey,
      body,
    }: {
      candidateId: number;
      stepRunId: number;
      fieldKey: string;
      body: ContentFieldInputRequest;
    }) =>
      request(() =>
        api.PUT('/step-runs/{stepRunId}/content-fields/{fieldKey}', {
          params: { path: { stepRunId, fieldKey } },
          body,
        }),
      ),
    onSettled: (_data, _error, { candidateId }) =>
      Promise.all(
        [
          qk('step-engine', 'listCandidateSteps', { candidateId }),
          contentKeys.fact(candidateId),
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  });
}
