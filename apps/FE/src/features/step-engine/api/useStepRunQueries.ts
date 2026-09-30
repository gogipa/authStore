import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import type { StepCode } from '@/shared/lib/steps';
import type { ListStepRunsParams, StepOwnerEditRequest, StepRunStartRequest } from '../model/types';
import { stepEngineKeys } from './queryKeys';

/**
 * 단계 실행 훅(P1-05, 05-2 step-engine). 202 작업 결과는 폴링하지 않는다 — SSE `step-run.status-changed`·
 * `candidate-step.changed`(shared/api/events.ts)가 레일·이력·실행 한 건·후보를 무효화하면 다시 읽는다.
 */

/** 단계 레일 10칸(`GET /candidates/{candidateId}/steps`, listCandidateSteps). null이면 부르지 않는다 */
export function useCandidateSteps(candidateId: number | null) {
  return useQuery({
    queryKey: stepEngineKeys.candidateSteps(candidateId ?? 0),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/steps', {
          params: { path: { candidateId: candidateId ?? 0 } },
          signal,
        }),
      ),
    enabled: candidateId !== null,
  });
}

/** 단계별 버전 이력(`GET …/steps/{stepCode}/runs`, 기본 version,desc) */
export function useStepRuns(
  candidateId: number,
  stepCode: StepCode,
  params: ListStepRunsParams = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: stepEngineKeys.stepRuns(candidateId, stepCode, params),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/steps/{stepCode}/runs', {
          params: { path: { candidateId, stepCode }, query: params },
          signal,
        }),
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

/** 단계 실행 한 건(`GET /step-runs/{stepRunId}`). SSE를 놓쳤을 때 확인한다 */
export function useStepRun(stepRunId: number | null) {
  return useQuery({
    queryKey: stepEngineKeys.stepRun(stepRunId ?? 0),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/step-runs/{stepRunId}', {
          params: { path: { stepRunId: stepRunId ?? 0 } },
          signal,
        }),
      ),
    enabled: stepRunId !== null,
  });
}

/** 재실행 필요 단계의 바뀐 입력(`GET …/steps/{stepCode}/stale-diff`). 재실행 필요가 아니면 409 */
export function useStaleDiff(
  candidateId: number,
  stepCode: StepCode,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: stepEngineKeys.staleDiff(candidateId, stepCode),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/steps/{stepCode}/stale-diff', {
          params: { path: { candidateId, stepCode } },
          signal,
        }),
      ),
    enabled: options.enabled ?? true,
  });
}

/** 이 후보의 레일·이력·상세를 다시 읽는다(요청이 받아들여진 직후 RUNNING을 바로 보이게) */
function useInvalidateCandidateSteps() {
  const queryClient = useQueryClient();
  return (candidateId: number) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: stepEngineKeys.candidateSteps(candidateId) }),
      queryClient.invalidateQueries({
        queryKey: [...stepEngineKeys.stepRunsAll, { candidateId }],
      }),
      queryClient.invalidateQueries({ queryKey: stepEngineKeys.candidate(candidateId) }),
    ]);
}

/**
 * 단계 하나 실행·다시 실행(`POST …/steps/{stepCode}/runs`, 202). 다음 단계는 자동으로 시작하지 않는다.
 * ⑥ 묶음은 stepCode=COPY + body.throughStepCode=NOTICE_HTML. 409·422는 `ApiRequestError`(message를 그대로 보인다).
 */
export function useStartStepRun() {
  const invalidate = useInvalidateCandidateSteps();
  return useMutation({
    mutationFn: ({
      candidateId,
      stepCode,
      body,
    }: {
      candidateId: number;
      stepCode: StepCode;
      body?: StepRunStartRequest;
    }) =>
      request(() =>
        api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
          params: { path: { candidateId, stepCode } },
          body: body ?? {},
        }),
      ),
    onSuccess: (_data, variables) => invalidate(variables.candidateId),
  });
}

/**
 * 오너 수정 새 버전(`POST …/steps/{stepCode}/owner-edits`): 값 편집·그대로 유지(⑥-1만)·이전 버전 다시 고르기.
 * 201 StepOwnerEditResult, ⑦ 태그 편집만 202 StepRunAccepted.
 */
export function useOwnerEdit() {
  const invalidate = useInvalidateCandidateSteps();
  return useMutation({
    mutationFn: ({
      candidateId,
      stepCode,
      body,
    }: {
      candidateId: number;
      stepCode: StepCode;
      body: StepOwnerEditRequest;
    }) =>
      request(() =>
        api.POST('/candidates/{candidateId}/steps/{stepCode}/owner-edits', {
          params: { path: { candidateId, stepCode } },
          body,
        }),
      ),
    onSuccess: (_data, variables) => invalidate(variables.candidateId),
  });
}
