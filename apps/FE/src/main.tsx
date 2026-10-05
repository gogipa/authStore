import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { AppProviders } from '@/app/providers';
import { createAppRouter, isDemoPath } from '@/app/router';
import '@/shared/styles/tokens.css';
import '@/shared/styles/global.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root 요소가 없습니다.');
const root = createRoot(rootElement);

if (isDemoPath(window.location.pathname)) {
  // 체험(`/demo`, D-31): 예시 데이터·화면 표시를 따로 받는다(보통 앱 첫 화면에는 싣지 않는다). 서버를 부르지 않는다.
  void import('@/app/demo/startDemo').then(({ startDemo }) => {
    root.render(<StrictMode>{startDemo()}</StrictMode>);
  });
} else {
  root.render(
    <StrictMode>
      <AppProviders>
        <RouterProvider router={createAppRouter()} />
      </AppProviders>
    </StrictMode>,
  );
}
