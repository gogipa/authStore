import { createBrowserRouter } from 'react-router';
import { routes } from './routes';

/** 전부 CSR(SPA). 운영에서는 BE가 dist를 내보내고 /api 밖 경로는 index.html로 돌린다. */
export const router = createBrowserRouter(routes);
