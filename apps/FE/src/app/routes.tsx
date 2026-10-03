import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router';
import { CandidateIndexRedirect } from '@/pages/candidate/CandidateIndexRedirect';
import { CandidateLayout } from '@/pages/candidate/CandidateLayout';
import { NotFoundPage } from '@/pages/not-found/NotFoundPage';
import { AppLayout } from './AppLayout';
import { RouteErrorBoundary } from './RouteErrorBoundary';

/**
 * 화면 하나 = lazy 청크 하나(05-4 §1). 페이지는 이름 있는 export를 유지하고 `pick`이 이름을 고른다.
 * 앱 틀(AppLayout·AppNav)·후보 작업 틀(CandidateLayout·StepRail)·NotFoundPage·shared는 나누지 않는다(eager).
 */
function page<M>(load: () => Promise<M>, pick: (module: M) => ComponentType) {
  return async () => ({ Component: pick(await load()) });
}

/**
 * 경로표. FE 설계 문서 docs/dev/FE/05_라우팅/ 과 06-3_FE스캐폴딩.md의 경로표와 같아야 한다.
 * 단계 화면 경로 조각(sourcing…approval)은 shared/lib/steps.ts의 StepScreen과 같다.
 *
 * `AppLayout` 아래 경로 없는 layout route 하나에 `ErrorBoundary`를 둔다(05-2 §4-2 옵션 B).
 * 화면이 오류를 던져도 왼쪽 내비는 남고 본문에만 오류가 보인다. URL은 바뀌지 않는다.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        ErrorBoundary: RouteErrorBoundary,
        // 첫 진입 때 화면 청크를 받는 동안: 앱 틀 + 빈 본문(05-2 §6). 빈 fragment라 아무것도 그리지 않는다.
        hydrateFallbackElement: <></>,
        children: [
          {
            index: true,
            lazy: page(
              () => import('@/pages/dashboard/DashboardPage'),
              (m) => m.DashboardPage,
            ),
          },
          {
            path: 'keywords',
            lazy: page(
              () => import('@/pages/keywords/KeywordsPage'),
              (m) => m.KeywordsPage,
            ),
          },
          {
            path: 'candidates',
            lazy: page(
              () => import('@/pages/candidates/CandidatesPage'),
              (m) => m.CandidatesPage,
            ),
          },
          {
            path: 'candidates/:candidateId',
            // 단계 화면 6개가 모두 쓰는 틀이라 eager. 단계 화면끼리 오갈 때 틀을 다시 받지 않는다(05-4 §4).
            element: <CandidateLayout />,
            children: [
              { index: true, element: <CandidateIndexRedirect /> },
              {
                path: 'sourcing',
                lazy: page(
                  () => import('@/pages/sourcing/SourcingPage'),
                  (m) => m.SourcingPage,
                ),
              },
              {
                path: 'judgement',
                lazy: page(
                  () => import('@/pages/judgement/JudgementPage'),
                  (m) => m.JudgementPage,
                ),
              },
              {
                path: 'thumbnail',
                lazy: page(
                  () => import('@/pages/thumbnail/ThumbnailPage'),
                  (m) => m.ThumbnailPage,
                ),
              },
              {
                path: 'content',
                lazy: page(
                  () => import('@/pages/content/ContentPage'),
                  (m) => m.ContentPage,
                ),
              },
              {
                path: 'tags',
                lazy: page(
                  () => import('@/pages/tags/TagsPage'),
                  (m) => m.TagsPage,
                ),
              },
              {
                path: 'approval',
                lazy: page(
                  () => import('@/pages/approval/ApprovalPage'),
                  (m) => m.ApprovalPage,
                ),
              },
            ],
          },
          {
            path: 'products',
            lazy: page(
              () => import('@/pages/products/ProductsPage'),
              (m) => m.ProductsPage,
            ),
          },
          {
            path: 'settings',
            lazy: page(
              () => import('@/pages/settings/SettingsPage'),
              (m) => m.SettingsPage,
            ),
          },
          {
            path: 'settings/ai-engine',
            lazy: page(
              () => import('@/pages/ai-engine/AiEnginePage'),
              (m) => m.AiEnginePage,
            ),
          },
          {
            path: 'system',
            lazy: page(
              () => import('@/pages/system/SystemPage'),
              (m) => m.SystemPage,
            ),
          },
          {
            // SCR-14 사용 안내(D-29). 보드 없음 — 화면시안_명세 §8
            path: 'guide',
            lazy: page(
              () => import('@/pages/guide/GuidePage'),
              (m) => m.GuidePage,
            ),
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
