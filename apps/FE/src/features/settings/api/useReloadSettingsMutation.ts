import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';

/** settings 태그 전체(GET /settings 등). 다시 읽기 뒤 이 키로 무효화한다. */
export const SETTINGS_TAG_KEY = ['settings'] as const;

/**
 * 설정 파일 다시 읽기(`POST /settings-snapshots`, createSettingsSnapshot). 새 내용이면 201, 같으면 200이고
 * 둘 다 `SettingsReloadResult`다. 형식 오류·안전 기준 완화는 422(`ApiRequestError`, 봉투 message를 보인다).
 * 끝나면(성공·실패 모두) `['settings']`를 무효화한다. 실패해도 서버의 검사 결과(valid·errors)가 바뀌기 때문이다.
 */
export function useReloadSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request(() => api.POST('/settings-snapshots')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SETTINGS_TAG_KEY }),
  });
}
