import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import type { CompetitorInputSubmit, TagCompetitorFileInputRequest } from '../model/tags';
import { tagsKeys } from './queryKeys';

/** 산출물이 아직 없거나(실행 전·실행 중) 다른 버전 id면 다시 시도하지 않는다 */
const retryUnlessMissing = (count: number, error: { code: string }) =>
  error.code !== 'STEP_OUTPUT_NOT_FOUND' && error.code !== 'STEP_RUN_NOT_FOUND' && count < 1;

/**
 * ⑦ 태그 후보표·최종 태그·뺀 태그(`GET /candidates/{candidateId}/tag-set`, getCandidateTagSet). `stepRunId`를 주면 그 버전.
 * 실행 전·실행 중(새 버전에 산출물이 아직 없음) 404 `STEP_OUTPUT_NOT_FOUND`는 다시 시도하지 않는다 — 그동안 화면은 마지막으로
 * 받은 값을 그대로 보인다(React Query는 오류에도 이전 data를 둔다). candidateId가 null이면 부르지 않는다.
 */
export function useTagSetQuery(candidateId: number | null, stepRunId?: number) {
  return useQuery({
    queryKey: tagsKeys.tagSet(candidateId ?? 0, stepRunId),
    enabled: candidateId !== null,
    retry: retryUnlessMissing,
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/tag-set', {
          params: {
            path: { candidateId: candidateId ?? 0 },
            query: stepRunId !== undefined ? { stepRunId } : {},
          },
          signal,
        }),
      ),
  });
}

/** 경쟁 태그 입력 목록(`GET /candidates/{candidateId}/tag-competitor-inputs`, listTagCompetitorInputs — 활성 입력만) */
export function useTagCompetitorInputsQuery(candidateId: number | null) {
  return useQuery({
    queryKey: tagsKeys.competitorInputs(candidateId ?? 0),
    enabled: candidateId !== null,
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/tag-competitor-inputs', {
          params: { path: { candidateId: candidateId ?? 0 } },
          signal,
        }),
      ),
  });
}

/**
 * 경쟁 태그 입력 읽어 저장(`POST /candidates/{candidateId}/tag-competitor-inputs`, createTagCompetitorInput, 201). 붙여 넣은 글은
 * JSON(`{ sourceType, text }`), 셀라파인더 엑셀·CSV 파일은 FormData(`sourceType=SELLERFINDER` + `file`). 원본은 서버가 파싱한 뒤
 * 버린다(TG-01). 성공하면 입력 목록·단계 레일(완료된 ⑦이 재실행 필요가 된다)을 다시 읽는다.
 */
export function useCreateTagCompetitorInputMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ candidateId, input }: { candidateId: number; input: CompetitorInputSubmit }) => {
      if (input.kind === 'FILE') {
        const form = new FormData();
        form.append('sourceType', 'SELLERFINDER');
        form.append('file', input.file);
        return request(() =>
          api.POST('/candidates/{candidateId}/tag-competitor-inputs', {
            params: { path: { candidateId } },
            // FormData는 openapi-fetch가 그대로 보낸다(Content-Type·경계는 브라우저가 붙인다)
            body: form as unknown as TagCompetitorFileInputRequest,
          }),
        );
      }
      return request(() =>
        api.POST('/candidates/{candidateId}/tag-competitor-inputs', {
          params: { path: { candidateId } },
          body: { sourceType: input.sourceType, text: input.text },
        }),
      );
    },
    onSuccess: (_data, { candidateId }) =>
      Promise.all(
        [
          tagsKeys.competitorInputs(candidateId),
          qk('step-engine', 'listCandidateSteps', { candidateId }),
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  });
}

/** 경쟁 태그 입력 빼기(`DELETE /tag-competitor-inputs/{inputId}`, removeTagCompetitorInput, 204 — removed_at만 채운다) */
export function useRemoveTagCompetitorInputMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ inputId }: { candidateId: number; inputId: number }) =>
      request(() =>
        api.DELETE('/tag-competitor-inputs/{inputId}', { params: { path: { inputId } } }),
      ),
    onSuccess: (_data, { candidateId }) =>
      Promise.all(
        [
          tagsKeys.competitorInputs(candidateId),
          qk('step-engine', 'listCandidateSteps', { candidateId }),
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  });
}
