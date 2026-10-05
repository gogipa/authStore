import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { AppProviders } from '@/app/providers';
import { routes as appRoutes } from '@/app/routes';
import type { EventSourceFactory } from '@/shared/api/events';
import { DemoContext } from '@/shared/lib/demo';
import { fakeDemoInfo } from './demoInfo';

export interface RenderRouteOptions {
  /** 가짜 EventSource(src/test/fakeEventSource.ts). 주지 않으면 진행 알림에 붙지 않는다(jsdom에 EventSource 없음). */
  EventSourceImpl?: EventSourceFactory;
  /** 경로표를 바꿔 그릴 때(오류 경계 테스트 등). 기본은 앱 경로표 그대로. */
  routes?: RouteObject[];
  /**
   * 체험(`/demo`)으로 그린다. 단계 화면 안내 판과 '지금 여기'는 체험에서만 보인다(D-43)
   * — 그 안내를 시험할 때 켠다. 체험이면 화면 위에 체험 띠도 함께 그려진다.
   */
  demo?: boolean;
}

/** 테스트용 QueryClient: 다시 시도하지 않는다(실패를 바로 본다). */
export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/**
 * 앱 경로표 그대로 메모리 라우터로 한 경로를 그린다. 화면은 lazy라 `await screen.findBy…`로 기다린다.
 * API는 부르는 쪽이 `stubApi()`(src/test/apiStub.ts)로 정한다. 정하지 않은 요청은 실패한다(setup.ts).
 */
export function renderRoute(path: string, options: RenderRouteOptions = {}) {
  const router = createMemoryRouter(options.routes ?? appRoutes, { initialEntries: [path] });
  const queryClient = createTestQueryClient();
  const app = (
    <AppProviders queryClient={queryClient} EventSourceImpl={options.EventSourceImpl}>
      <RouterProvider router={router} />
    </AppProviders>
  );
  const view = render(options.demo ? <DemoContext value={fakeDemoInfo()}>{app}</DemoContext> : app);
  return { router, queryClient, ...view };
}
