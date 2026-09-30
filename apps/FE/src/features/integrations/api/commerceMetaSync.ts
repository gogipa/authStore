import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import type { CommerceMetaSyncTarget } from '../model/metaSyncRows';

/** `GET /commerce-meta-sync-runs/latest`(getLatestCommerceMetaSyncRuns)의 queryKey. SSE `commerce-meta-sync.completed`가 무효화한다 */
export const commerceMetaSyncStatusQueryKey = qk('integrations', 'getLatestCommerceMetaSyncRuns');

/** 메타데이터 대상 8개의 최신 동기화 상태(05-2 CommerceMetaSyncStatusList, 페이징 없음) */
export function useCommerceMetaSyncStatusQuery() {
  return useQuery({
    queryKey: commerceMetaSyncStatusQueryKey,
    queryFn: ({ signal }) => request(() => api.GET('/commerce-meta-sync-runs/latest', { signal })),
  });
}

/**
 * 지금 동기화(`POST /commerce-meta-sync-runs`, 202). `targets`를 주지 않으면 8개 전부.
 * 성공·실패 모두 상태를 다시 읽는다(성공이면 줄이 '동기화 중'으로 바뀐다). 끝은 SSE로 알게 된다.
 * 실패: 409 `ALREADY_IN_PROGRESS`(details.job=META_SYNC)·`SECRET_NOT_CONFIGURED`(details.secretKeys), 503 `KEYCHAIN_UNAVAILABLE`.
 */
export function useStartCommerceMetaSyncMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (targets?: readonly CommerceMetaSyncTarget[]) =>
      request(() =>
        api.POST('/commerce-meta-sync-runs', {
          body: targets ? { targets: [...targets] } : {},
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: commerceMetaSyncStatusQueryKey }),
  });
}
