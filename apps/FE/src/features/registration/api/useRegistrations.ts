import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { api } from '@/shared/api/client';
import { request, type ApiRequestError } from '@/shared/api/errors';
import { newIdempotencyKey } from '@/shared/api/idempotency';
import { qk } from '@/shared/api/queryKeys';
import type {
  RegistrationCreateRequest,
  RegistrationDetail,
  RegistrationResultCheck,
  RegistrationSummaryPage,
  RegistrationSwitchChanged,
  RegistrationSwitchState,
} from '../model/register';
import { registrationKeys } from './queryKeys';

/** 없음·상태 오류(404·409·422)는 다시 시도하지 않는다 */
const retryServerErrorOnce = (count: number, error: ApiRequestError) =>
  error.status >= 500 && count < 1;

/** 등록 화면이 다시 읽을 것(승인 미리보기·사전 검증·이력·후보·게이트) */
function useInvalidateRegistration() {
  const queryClient = useQueryClient();
  return (candidateId: number) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: registrationKeys.registrations(candidateId) }),
      queryClient.invalidateQueries({
        queryKey: qk('registration', 'getCandidateApproval', { candidateId }),
      }),
      queryClient.invalidateQueries({
        queryKey: qk('registration', 'runCandidatePreValidation', { candidateId }),
      }),
      queryClient.invalidateQueries({
        queryKey: qk('step-engine', 'getCandidate', { candidateId }),
      }),
      queryClient.invalidateQueries({
        queryKey: qk('step-engine', 'listCandidateGates', { candidateId }),
      }),
    ]);
}

/**
 * G4 최종 승인·등록(`POST /candidates/{candidateId}/registrations`, createCandidateRegistration — P4-03 규칙 5). **누를 때 한 번**
 * `Idempotency-Key`(UUID)를 만들고, 그 누름의 재전송(연결 실패 한 번 다시)에는 같은 키를 쓴다. 누르는 동안 다시 눌러도 요청은 1건이다
 * (`approve`가 진행 중이면 무시 — 상태 갱신 전 빠른 두 번 누름도 막으려고 ref로 잠근다). 202 뒤 폴링하지 않는다 — 결과는 SSE
 * `registration.status-changed`가 무효화한다(여기서는 받은 즉시 한 번 무효화).
 */
export function useCreateRegistration(candidateId: number | null) {
  const invalidate = useInvalidateRegistration();
  const locked = useRef(false);
  const mutation = useMutation({
    mutationFn: ({ key, body }: { key: string; body: RegistrationCreateRequest }) =>
      request(() =>
        api.POST('/candidates/{candidateId}/registrations', {
          params: {
            path: { candidateId: candidateId ?? 0 },
            header: { 'Idempotency-Key': key },
          },
          body,
        }),
      ),
    // 응답을 받지 못했을 때(연결 실패)만 같은 키로 한 번 더 — 서버가 첫 응답을 돌려준다
    retry: (count, error: ApiRequestError) => error.status === 0 && count < 1,
    onSuccess: () => (candidateId !== null ? invalidate(candidateId) : undefined),
  });
  const { mutate } = mutation;
  const approve = useCallback(
    (body: RegistrationCreateRequest) => {
      if (locked.current || candidateId === null) return;
      locked.current = true;
      mutate(
        { key: newIdempotencyKey(), body },
        {
          onSettled: () => {
            locked.current = false;
          },
        },
      );
    },
    [candidateId, mutate],
  );
  return { ...mutation, approve };
}

/** 후보의 등록 기록 이력(`GET /candidates/{candidateId}/registrations`, 첫 페이지 approvedAt 내림차순 — 맨 앞이 직전 결과) */
export function useCandidateRegistrations(candidateId: number | null) {
  return useQuery<RegistrationSummaryPage, ApiRequestError>({
    queryKey: registrationKeys.registrations(candidateId ?? 0),
    enabled: candidateId !== null,
    retry: retryServerErrorOnce,
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/registrations', {
          params: { path: { candidateId: candidateId ?? 0 }, query: { size: 20 } },
          signal,
        }),
      ),
  });
}

/** 등록 기록 상세(`GET /registrations/{registrationId}` — 한국어 오류·추적 번호·검증 결과, request_json 없음) */
export function useRegistration(registrationId: number | null) {
  return useQuery<RegistrationDetail, ApiRequestError>({
    queryKey: registrationKeys.registration(registrationId ?? 0),
    enabled: registrationId !== null,
    retry: retryServerErrorOnce,
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/registrations/{registrationId}', {
          params: { path: { registrationId: registrationId ?? 0 } },
          signal,
        }),
      ),
  });
}

/** 결과확인필요 기록을 판매자관리코드로 조회(`POST /registrations/{registrationId}/result-checks`, 동기) */
export function useCheckRegistrationResult(candidateId: number | null) {
  const invalidate = useInvalidateRegistration();
  const queryClient = useQueryClient();
  return useMutation<RegistrationResultCheck, ApiRequestError, number>({
    mutationFn: (registrationId) =>
      request(() =>
        api.POST('/registrations/{registrationId}/result-checks', {
          params: { path: { registrationId } },
        }),
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: registrationKeys.registration(result.registrationId),
      });
      if (candidateId !== null) await invalidate(candidateId);
    },
  });
}

/** 등록 API 차단 스위치(`GET /registration-switch` — 내비 상태 상자·승인 화면 띠의 원본) */
export function useRegistrationSwitch() {
  return useQuery<RegistrationSwitchState, ApiRequestError>({
    queryKey: registrationKeys.registrationSwitch(),
    retry: retryServerErrorOnce,
    queryFn: ({ signal }) => request(() => api.GET('/registration-switch', { signal })),
  });
}

/** 차단 스위치 켜기·끄기(`PUT /registration-switch`). 끄면 검증완료 후보가 승인대기로 돌아간다(`revertedCandidateIds`) */
export function usePutRegistrationSwitch() {
  const queryClient = useQueryClient();
  return useMutation<RegistrationSwitchChanged, ApiRequestError, boolean>({
    mutationFn: (apiBlocked) =>
      request(() => api.PUT('/registration-switch', { body: { apiBlocked } })),
    // 캐시에 직접 쓰지 않고 다시 읽는다(스위치·미리보기의 apiBlocked·이력). 사전 검증은 외부 조회라 여기서 다시 돌리지 않는다
    // (되돌린 후보는 SSE candidate.status-changed가 다시 돌린다)
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: registrationKeys.registrationSwitch() }),
        queryClient.invalidateQueries({ queryKey: qk('registration', 'getCandidateApproval') }),
        queryClient.invalidateQueries({
          queryKey: qk('registration', 'listCandidateRegistrations'),
        }),
      ]),
  });
}
