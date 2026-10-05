import { createBrowserRouter } from 'react-router';
import { DEMO_PATH } from '@/features/guide';
import { routes } from './routes';

/** 체험(`/demo`, F-GD-05, D-31) 주소 바탕. 체험은 같은 경로표를 이 아래에 그린다(app/demo) */
export const DEMO_BASENAME = DEMO_PATH;

/** 앱을 켠 주소가 체험인지(`/demo`·`/demo/…`). 켤 때 한 번만 본다(체험과 보통 앱은 한 페이지에 섞이지 않는다) */
export function isDemoPath(pathname: string): boolean {
  return pathname === DEMO_BASENAME || pathname.startsWith(`${DEMO_BASENAME}/`);
}

/**
 * 보통 앱 라우터. 전부 CSR(SPA). 운영에서는 BE가 dist를 내보내고 /api 밖 경로(`/demo/…` 포함)는 index.html로 돌린다.
 * 모듈을 불러올 때 만들지 않는다 — 체험으로 켤 때 보통 라우터가 history를 함께 듣지 않게(main.tsx).
 */
export function createAppRouter() {
  return createBrowserRouter(routes);
}
