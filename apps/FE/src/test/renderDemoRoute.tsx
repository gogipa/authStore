import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { onTestFinished } from 'vitest';
import { createDemoApi, type DemoApi } from '@/app/demo/demoApi';
import type { DemoWorldOptions } from '@/app/demo/demoWorld';
import { DemoProviders } from '@/app/demo/DemoProviders';
import { createDemoQueryClient } from '@/app/demo/startDemo';
import { DEMO_BASENAME } from '@/app/router';
import { routes } from '@/app/routes';
import { installApiRuntime, type ApiFetch } from '@/shared/api/client';
import { installMemoryStorage } from '@/shared/lib/browserStorage';

export interface RenderDemoRouteOptions extends DemoWorldOptions {
  /** 이미 몇 단계 걸어 둔 체험 API(`startDemoKit()` + `reach…`). 주지 않으면 빈 상태의 새 모델 */
  demoApi?: DemoApi;
  /**
   * 체험 예시보다 먼저 답할 응답(테스트가 예시와 다른 상태를 만들 때 — 예: 시작 준비에 할 일). undefined를 돌려주면 예시가 답한다.
   * 이 응답도 전역 fetch를 부르지 않는다
   */
  override?: (request: Request) => Response | undefined;
}

/**
 * 체험(`/demo`, D-31) 그대로 한 경로를 그린다: 체험 API 전송(메모리 예시)·체험 QueryClient·체험 표시(DemoProviders)와
 * 앱 경로표를 basename '/demo' 메모리 라우터로. 진행 알림(SSE) 공급자는 없다(체험과 같다). 브라우저 저장소도 체험처럼 메모리다.
 * `path`는 basename 안 경로('/keywords'). 테스트가 끝나면 API 전송·저장소를 되돌린다.
 */
export function renderDemoRoute(
  path: string,
  { override, demoApi: given, ...worldOptions }: RenderDemoRouteOptions = {},
) {
  // 테스트는 지연 없이(0ms) 돌린다 — 결과는 다음 틱에 나온다
  const demoApi =
    given ?? createDemoApi({ delays: { short: 0, medium: 0, long: 0 }, ...worldOptions });
  const fetch: ApiFetch = override
    ? (request) => Promise.resolve(override(request) ?? demoApi.fetch(request))
    : demoApi.fetch;
  onTestFinished(installApiRuntime({ ...demoApi, fetch }));
  onTestFinished(installMemoryStorage());
  const queryClient = createDemoQueryClient();
  const router = createMemoryRouter(routes, {
    basename: DEMO_BASENAME,
    initialEntries: [path === '/' ? DEMO_BASENAME : `${DEMO_BASENAME}${path}`],
  });
  const view = render(
    <DemoProviders queryClient={queryClient} world={demoApi.world}>
      <RouterProvider router={router} />
    </DemoProviders>,
  );
  return { router, queryClient, demoApi, ...view };
}
