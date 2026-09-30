import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';

/** `GET /auth-status`(getAuthStatus)의 queryKey. SSE `auth.failed`가 무효화한다(shared/api/events.ts) */
export const authStatusQueryKey = qk('system', 'getAuthStatus');

/** 커머스API 토큰·인증 상태(토큰 값 없음, 05-2 CommerceAuthStatus) */
export function useAuthStatusQuery() {
  return useQuery({
    queryKey: authStatusQueryKey,
    queryFn: ({ signal }) => request(() => api.GET('/auth-status', { signal })),
  });
}

/**
 * 토큰 다시 받기(`POST /auth-checks`). 성공·실패 모두 인증 상태를 다시 읽는다(실패도 call_log에 남아 원인이 바뀐다).
 * 실패: 409 `SECRET_NOT_CONFIGURED`, 502 `COMMERCE_AUTH_FAILED`·`EXTERNAL_API_ERROR`, 503 `KEYCHAIN_UNAVAILABLE`.
 */
export function useAuthCheckMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request(() => api.POST('/auth-checks')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: authStatusQueryKey }),
  });
}
