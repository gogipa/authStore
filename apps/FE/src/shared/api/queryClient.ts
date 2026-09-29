import { QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query 기본값.
 * - retry 1: 로컬 BE라 일시 오류는 한 번만 다시 시도한다.
 * - refetchOnWindowFocus false: 창을 오갈 때마다 다시 부르지 않는다(작업 화면이 흔들리지 않게).
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
