import { qk } from '@/shared/api/queryKeys';

/** thumbnails 태그 전체 */
export const THUMBNAILS_TAG_KEY = ['thumbnails'] as const;

/**
 * ⑤ 썸네일 queryKey(03-2 §6.2 `['thumbnails', operationId, params]`, P3-01). 후보 한 건 키의 파라미터는 `{ candidateId }`로
 * 시작한다 — SSE 무효화(`step-run.status-changed`(THUMBNAIL), shared/api/events.ts)가 부분 일치로 닿는다.
 */
export const thumbnailKeys = {
  sourceImagesAll: qk('thumbnails', 'listCandidateSourceImages'),
  sourceImages: (candidateId: number, sourceSection?: 'PRODUCT_IMAGE' | 'DESCRIPTION_IMAGE') =>
    qk('thumbnails', 'listCandidateSourceImages', {
      candidateId,
      ...(sourceSection !== undefined ? { sourceSection } : {}),
    }),
};
