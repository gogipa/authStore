import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import type { ContinuousRunStartRequest, GatePassRequest } from '../model/types';
import { stepEngineKeys } from './queryKeys';

/**
 * 연속 실행·게이트 훅(P1-06, 05-2 step-engine). 202 연속 실행은 폴링하지 않는다 — SSE `step-run.status-changed`
 * (stepChainId)·`continuous-run.stopped`·`gate.passed`·`gate.invalidated`(shared/api/events.ts)가 묶음·게이트·레일·여정을
 * 무효화하면 다시 읽는다.
 */

/** 게이트 상태 G1~G4(`GET /candidates/{candidateId}/gates`, listCandidateGates). null이면 부르지 않는다 */
export function useCandidateGates(candidateId: number | null) {
  return useQuery({
    queryKey: stepEngineKeys.candidateGates(candidateId ?? 0),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/gates', {
          params: { path: { candidateId: candidateId ?? 0 } },
          signal,
        }),
      ),
    enabled: candidateId !== null,
  });
}

/** 연속 실행 한 번(`GET /continuous-runs/{stepChainId}`, getContinuousRun). null이면 부르지 않는다 */
export function useContinuousRun(stepChainId: number | null) {
  return useQuery({
    queryKey: stepEngineKeys.continuousRun(stepChainId ?? 0),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/continuous-runs/{stepChainId}', {
          params: { path: { stepChainId: stepChainId ?? 0 } },
          signal,
        }),
      ),
    enabled: stepChainId !== null,
  });
}

/** 이 여정의 레일·상세·게이트·목록을 다시 읽는다(요청이 받아들여진 직후 바로 보이게) */
function useInvalidateCandidate() {
  const queryClient = useQueryClient();
  return (candidateId: number) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: stepEngineKeys.candidateSteps(candidateId) }),
      queryClient.invalidateQueries({ queryKey: stepEngineKeys.candidate(candidateId) }),
      queryClient.invalidateQueries({ queryKey: stepEngineKeys.candidateGates(candidateId) }),
      queryClient.invalidateQueries({ queryKey: stepEngineKeys.candidatesAll }),
    ]);
}

/**
 * 연속 실행 시작(`POST /candidates/{candidateId}/continuous-runs`, 202): '여기부터 연속 실행'(FROM_HERE + startStepCode)
 * 또는 '재실행 필요 단계 모두 실행'(RERUN_STALE). 409·422는 `ApiRequestError`(message를 그대로 보인다).
 */
export function useStartContinuousRun() {
  const invalidate = useInvalidateCandidate();
  return useMutation({
    mutationFn: ({ candidateId, body }: { candidateId: number; body: ContinuousRunStartRequest }) =>
      request(() =>
        api.POST('/candidates/{candidateId}/continuous-runs', {
          params: { path: { candidateId } },
          body,
        }),
      ),
    onSuccess: (_data, variables) => invalidate(variables.candidateId),
  });
}

/**
 * G2·G3 통과 기록(`POST /candidates/{candidateId}/gates/{gateCode}/pass`, 201 새 기록 · 200 같은 지문의 기존 기록).
 * G2는 ③ 판정 화면(P2-05), G3은 ⑤ 썸네일 화면(P3-02)이 쓴다. 웹 화면에서만 기록한다.
 */
export function usePassGate() {
  const invalidate = useInvalidateCandidate();
  return useMutation({
    mutationFn: ({
      candidateId,
      gate,
      body,
    }: {
      candidateId: number;
      gate: 'G2' | 'G3';
      body: GatePassRequest;
    }) =>
      request(() =>
        api.POST('/candidates/{candidateId}/gates/{gateCode}/pass', {
          params: { path: { candidateId, gateCode: gate } },
          body,
        }),
      ),
    onSuccess: (_data, variables) => invalidate(variables.candidateId),
  });
}
