import { QueryClient } from '@tanstack/react-query';
import type { ApiRequestError } from './errors';

/**
 * 모든 쿼리·변경의 오류 타입은 `ApiRequestError`(05-3 봉투)다. 훅의 queryFn은 `request(() => api.GET(...))`로
 * 부르므로 서버 오류·연결 실패가 모두 이 모양으로 바뀐다. 화면은 `error.code`로 갈라 처리하고 `error.message`를
 * 그대로 보인다(03-2 §6.2). Proposed(06-3 §9).
 */
declare module '@tanstack/react-query' {
  interface Register {
    defaultError: ApiRequestError;
  }
}

/**
 * TanStack Query 기본값.
 * - retry 1: 로컬 BE라 일시 오류는 한 번만 다시 시도한다.
 * - refetchOnWindowFocus false: 창을 오갈 때마다 다시 부르지 않는다(여정 화면이 흔들리지 않게).
 *   서버 값이 바뀌면 SSE 알림이 쿼리를 무효화한다(shared/api/events.ts).
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export const queryClient = createQueryClient();
