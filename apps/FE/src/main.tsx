import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { AppProviders } from '@/app/providers';
import { router } from '@/app/router';
import '@/shared/styles/tokens.css';
import '@/shared/styles/global.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root 요소가 없습니다.');

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
