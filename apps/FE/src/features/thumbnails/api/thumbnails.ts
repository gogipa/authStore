import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import type {
  SourceSection,
  ThumbnailPromptPreviewRequest,
  ThumbnailReferencesRequest,
} from '../model/thumbnails';
import { thumbnailKeys } from './queryKeys';

/**
 * 후보의 라쿠텐 원본 이미지 목록(`GET /candidates/{candidateId}/source-images`, listCandidateSourceImages). ② 선택 전이면
 * 409 `SOURCING_SELECTION_REQUIRED` — 다시 시도하지 않는다. candidateId가 null이면 부르지 않는다. 원본은 ⑤ 실행이 받으므로
 * ⑤가 끝날 때 SSE(`step-run.status-changed` THUMBNAIL)가 이 목록을 다시 읽힌다.
 */
export function useCandidateSourceImagesQuery(
  candidateId: number | null,
  sourceSection?: SourceSection,
) {
  return useQuery({
    queryKey: thumbnailKeys.sourceImages(candidateId ?? 0, sourceSection),
    enabled: candidateId !== null,
    retry: (count, error) => error.code !== 'SOURCING_SELECTION_REQUIRED' && count < 1,
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/source-images', {
          params: {
            path: { candidateId: candidateId ?? 0 },
            query: sourceSection !== undefined ? { sourceSection } : {},
          },
          signal,
        }),
      ),
  });
}

/**
 * 레퍼런스 컷 고르기와 '사람·얼굴 없음' 확인(`PUT /step-runs/{stepRunId}/thumbnail-references`, putThumbnailReferences).
 * 웹 화면에서 오너가 체크한 요청만 보낸다(F-TH-05 — 미리 켜 두거나 자동으로 보내지 않는다). 성공·실패 모두 단계 레일과 ⑤
 * 산출물(P3-02 getCandidateThumbnail)을 다시 읽는다. 실패는 `ApiRequestError`(05-3 봉투).
 */
export function usePutThumbnailReferencesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      stepRunId,
      body,
    }: {
      candidateId: number;
      stepRunId: number;
      body: ThumbnailReferencesRequest;
    }) =>
      request(() =>
        api.PUT('/step-runs/{stepRunId}/thumbnail-references', {
          params: { path: { stepRunId } },
          body,
        }),
      ),
    onSettled: (_data, _error, { candidateId }) =>
      Promise.all(
        [
          qk('step-engine', 'listCandidateSteps', { candidateId }),
          qk('thumbnails', 'getCandidateThumbnail', { candidateId }),
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  });
}

/**
 * 썸네일 프롬프트 미리보기와 실존 인물 차단어 검사(`POST /thumbnail-prompt-previews`, createThumbnailPromptPreview).
 * 처리 리소스라 캐시하지 않는 mutation이다(저장 없음 — 차단어가 있어도 200). 값이 바뀔 때마다 화면이 다시 부른다.
 */
export function useThumbnailPromptPreviewMutation() {
  return useMutation({
    mutationFn: (body: ThumbnailPromptPreviewRequest) =>
      request(() => api.POST('/thumbnail-prompt-previews', { body })),
  });
}
