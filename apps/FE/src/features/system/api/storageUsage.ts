import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';

/** `GET /storage-usage`(getStorageUsage, D-25)의 queryKey. SSE·폴링으로 다시 읽지 않는다 */
export const storageUsageQueryKey = qk('system', 'getStorageUsage');

/**
 * 저장 공간(05-2 StorageUsage): agy 기록·앱 이미지 폴더 크기, 디스크 남은 공간. 화면을 열 때 한 번 읽는다.
 * BE가 1분 동안 같은 값을 주고, 처음 재기는 최대 5초 걸린다.
 */
export function useStorageUsageQuery() {
  return useQuery({
    queryKey: storageUsageQueryKey,
    queryFn: ({ signal }) => request(() => api.GET('/storage-usage', { signal })),
  });
}

/**
 * [다시 재기]: `GET /storage-usage?refresh=true`(1분 캐시 없이 새로 잰다). 받은 값으로 위 쿼리를 바꾼다.
 * 실패: 422 `INVALID_QUERY_PARAMETER`(오지 않는다)·500.
 */
export function useRefreshStorageUsageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request(() => api.GET('/storage-usage', { params: { query: { refresh: true } } })),
    onSuccess: (data) => queryClient.setQueryData(storageUsageQueryKey, data),
  });
}
