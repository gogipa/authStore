import type { RouteObject } from 'react-router';
import { AiEnginePage } from '@/pages/ai-engine/AiEnginePage';
import { ApprovalPage } from '@/pages/approval/ApprovalPage';
import { CandidateIndexRedirect } from '@/pages/candidate/CandidateIndexRedirect';
import { CandidateLayout } from '@/pages/candidate/CandidateLayout';
import { CandidatesPage } from '@/pages/candidates/CandidatesPage';
import { ContentPage } from '@/pages/content/ContentPage';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { JudgementPage } from '@/pages/judgement/JudgementPage';
import { KeywordsPage } from '@/pages/keywords/KeywordsPage';
import { NotFoundPage } from '@/pages/not-found/NotFoundPage';
import { ProductsPage } from '@/pages/products/ProductsPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { SourcingPage } from '@/pages/sourcing/SourcingPage';
import { SystemPage } from '@/pages/system/SystemPage';
import { TagsPage } from '@/pages/tags/TagsPage';
import { ThumbnailPage } from '@/pages/thumbnail/ThumbnailPage';
import { AppLayout } from './AppLayout';

/**
 * 경로표. FE 설계 문서 docs/dev/FE/05_라우팅/ 과 06-3_FE스캐폴딩.md의 경로표와 같아야 한다.
 * 단계 화면 경로 조각(sourcing…approval)은 shared/lib/steps.ts의 StepScreen과 같다.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'keywords', element: <KeywordsPage /> },
      { path: 'candidates', element: <CandidatesPage /> },
      {
        path: 'candidates/:candidateId',
        element: <CandidateLayout />,
        children: [
          { index: true, element: <CandidateIndexRedirect /> },
          { path: 'sourcing', element: <SourcingPage /> },
          { path: 'judgement', element: <JudgementPage /> },
          { path: 'thumbnail', element: <ThumbnailPage /> },
          { path: 'content', element: <ContentPage /> },
          { path: 'tags', element: <TagsPage /> },
          { path: 'approval', element: <ApprovalPage /> },
        ],
      },
      { path: 'products', element: <ProductsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'settings/ai-engine', element: <AiEnginePage /> },
      { path: 'system', element: <SystemPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
