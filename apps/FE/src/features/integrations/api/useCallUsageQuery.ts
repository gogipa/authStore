import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';

/** `GET /call-usage`(getCallUsage)의 queryKey. SSE `call-usage.changed`가 이 키를 무효화한다(shared/api/events.ts). */
export const callUsageQueryKey = qk('integrations', 'getCallUsage');

/**
 * 오늘 외부 조회 수·상한·24시간 쉼 상태(대상별). 내비 상태 상자의 '오늘 페이지 조회 n/110'이 쓴다.
 * 값은 SSE 알림으로만 다시 읽는다(폴링하지 않는다). 오류는 `ApiRequestError`(05-3 봉투)다.
 */
export function useCallUsageQuery() {
  return useQuery({
    queryKey: callUsageQueryKey,
    queryFn: ({ signal }) => request(() => api.GET('/call-usage', { signal })),
  });
}
