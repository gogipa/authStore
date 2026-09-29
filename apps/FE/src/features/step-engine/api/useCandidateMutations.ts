import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import type { CandidateCreateRequest, CandidateGender } from '../model/types';
import { STEP_ENGINE_TAG_KEY } from './queryKeys';

/**
 * 후보를 바꾸는 요청. 성공하면 step-engine 태그 전체(목록·상세·상태별 수·이어서 할 곳·이력)를 무효화한다.
 * 실패는 `ApiRequestError`(05-3 봉투) — 화면은 `message`를 그대로 보인다(409 CANDIDATE_LOCKED 등).
 */
function useInvalidateStepEngine() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: STEP_ENGINE_TAG_KEY });
}

/** 후보 만들기(`POST /candidates`). 201 CandidateDetail. 진행 중 중복은 409 `CANDIDATE_DUPLICATE`(`details.existingCandidateId`) */
export function useCreateCandidate() {
  const invalidate = useInvalidateStepEngine();
  return useMutation({
    mutationFn: (body: CandidateCreateRequest) => request(() => api.POST('/candidates', { body })),
    onSuccess: invalidate,
  });
}

/** 후보 제외(`POST /candidates/{candidateId}/exclude`) */
export function useExcludeCandidate() {
  const invalidate = useInvalidateStepEngine();
  return useMutation({
    mutationFn: (candidateId: number) =>
      request(() =>
        api.POST('/candidates/{candidateId}/exclude', { params: { path: { candidateId } } }),
      ),
    onSuccess: invalidate,
  });
}

/** 제외된 후보 다시 작업(`POST /candidates/{candidateId}/reopen`). 앵커 키만 같으면 `warnings`에 ANCHOR_KEY_DUPLICATE */
export function useReopenCandidate() {
  const invalidate = useInvalidateStepEngine();
  return useMutation({
    mutationFn: (candidateId: number) =>
      request(() =>
        api.POST('/candidates/{candidateId}/reopen', { params: { path: { candidateId } } }),
      ),
    onSuccess: invalidate,
  });
}

/** 후보 성별 직접 입력(`PUT /candidates/{candidateId}/gender`). 바뀌면 `affectedSteps`가 재실행 필요가 된다 */
export function useSetCandidateGender() {
  const invalidate = useInvalidateStepEngine();
  return useMutation({
    mutationFn: ({ candidateId, gender }: { candidateId: number; gender: CandidateGender }) =>
      request(() =>
        api.PUT('/candidates/{candidateId}/gender', {
          params: { path: { candidateId } },
          body: { gender },
        }),
      ),
    onSuccess: invalidate,
  });
}
