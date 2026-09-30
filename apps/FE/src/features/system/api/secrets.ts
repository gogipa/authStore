import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import type { SecretKey } from '../model/secretLabels';
import { authStatusQueryKey } from './commerceAuth';

/** `GET /secrets`(listSecrets)의 queryKey */
export const secretsQueryKey = qk('system', 'listSecrets');

/** 비밀 키 6개의 저장 여부(값·가림값 없음). 키체인을 못 열면 503 `KEYCHAIN_UNAVAILABLE` */
export function useSecretsQuery() {
  return useQuery({
    queryKey: secretsQueryKey,
    queryFn: ({ signal }) => request(() => api.GET('/secrets', { signal })),
  });
}

export interface SaveSecretInput {
  secretKey: SecretKey;
  value: string;
}

/**
 * 비밀값 넣기·바꾸기(`PUT /secrets/{secretKey}`, 204). 성공하면 `secrets`·`auth-status`를 다시 읽는다
 * (커머스 키를 바꾸면 BE가 토큰 캐시를 비운다).
 * 값이 메모리에 오래 남지 않게 mutation 기록을 바로 버린다(`gcTime: 0`). 화면도 성공 뒤 `reset()`한다.
 */
export function useSaveSecretMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ secretKey, value }: SaveSecretInput) =>
      request(() =>
        api.PUT('/secrets/{secretKey}', {
          params: { path: { secretKey } },
          body: { value },
        }),
      ),
    gcTime: 0,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: secretsQueryKey }),
        queryClient.invalidateQueries({ queryKey: authStatusQueryKey }),
      ]),
  });
}
