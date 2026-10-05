import { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { installApiRuntime } from '@/shared/api/client';
import { installMemoryStorage } from '@/shared/lib/browserStorage';
import { DEMO_BASENAME } from '../router';
import { routes } from '../routes';
import { createDemoApi } from './demoApi';
import { DemoProviders } from './DemoProviders';

/**
 * 체험 QueryClient: 모델이 바뀔 때마다 DemoProviders가 모두 무효화하므로 그 밖에는 다시 읽지 않고(staleTime 무한) 실패를 다시
 * 시도하지 않는다. 따라 하기 밖 동작은 '체험에서는 이 동작을 실행하지 않습니다'로 실패한다(demoApi).
 */
export function createDemoQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  });
}

/**
 * 체험 앱을 켠다(F-GD-05, D-31·D-32 — 앱이 `/demo`·`/demo/…`로 켜졌을 때 main.tsx가 한 번 부른다):
 * 1. 화면이 그리기 전에 API 전송·이미지 주소를 메모리 안 따라 하기 모델로 바꾼다 — `/api`·EventSource·서비스 워커 없음
 *    브라우저 저장소도 메모리로 바꾼다 — 체험에서 한 일이 보통 앱의 localStorage·sessionStorage 키에 남지 않는다
 * 2. 같은 경로표를 basename `/demo` 아래 브라우저 라우터로 그린다(링크·이동이 `/demo` 안에 머문다)
 * 3. 따로 만든 QueryClient와 체험 표시(DemoProviders)
 */
export function startDemo(): ReactNode {
  const demoApi = createDemoApi();
  installApiRuntime(demoApi);
  installMemoryStorage();
  const router = createBrowserRouter(routes, { basename: DEMO_BASENAME });
  return (
    <DemoProviders queryClient={createDemoQueryClient()} world={demoApi.world}>
      <RouterProvider router={router} />
    </DemoProviders>
  );
}
