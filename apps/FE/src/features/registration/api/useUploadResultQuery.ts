import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { registrationKeys } from './queryKeys';

/** 산출물이 아직 없거나(실행 전·실행 중·실패) 다른 버전 id면 다시 시도하지 않는다 */
const retryUnlessMissing = (count: number, error: { code: string }) =>
  error.code !== 'STEP_OUTPUT_NOT_FOUND' && error.code !== 'STEP_RUN_NOT_FOUND' && count < 1;

/**
 * ⑧ 업로드 산출물(`GET /candidates/{candidateId}/upload-result`, getCandidateUploadResult — P4-01). `stepRunId`를 주면 그 버전.
 * 실행 전·실행 중·실패(산출물 없음) 404 `STEP_OUTPUT_NOT_FOUND`는 다시 시도하지 않는다 — 그동안 화면은 마지막으로 받은 값을
 * 그대로 보인다. candidateId가 null이면 부르지 않는다. 업로드 이미지 미리보기는 응답의 `imageAssetId`로
 * `/api/v1/image-assets/{id}/file`을 쓴다(브라우저가 shop-phinf를 부르지 않는다).
 */
export function useUploadResultQuery(candidateId: number | null, stepRunId?: number) {
  return useQuery({
    queryKey: registrationKeys.uploadResult(candidateId ?? 0, stepRunId),
    enabled: candidateId !== null,
    retry: retryUnlessMissing,
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/upload-result', {
          params: {
            path: { candidateId: candidateId ?? 0 },
            query: stepRunId !== undefined ? { stepRunId } : {},
          },
          signal,
        }),
      ),
  });
}
