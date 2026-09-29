import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';

/** `GET /settings`(getSettings)의 queryKey. SSE `settings.reloaded`가 `['settings']`로 무효화한다(shared/api/events.ts). */
export const settingsQueryKey = qk('settings', 'getSettings');

/**
 * 현재 설정과 설정 파일 검사 결과(05-2 SettingsView). 설정 화면(SCR-10)과 대시보드(SCR-01)의
 * '설정 파일 검사' 줄(P1-04)이 쓴다. 통과한 설정 스냅샷이 하나도 없으면 503 `SETTINGS_INVALID`
 * (`error.envelope.fieldErrors`에 검사 오류)다.
 */
export function useSettingsQuery() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: ({ signal }) => request(() => api.GET('/settings', { signal })),
  });
}
