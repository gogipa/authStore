import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from './AppLayout';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { stubApi } from '@/test/apiStub';
import { renderRoute } from '@/test/renderRoute';

// 앱 경로표 그대로 두고 대시보드 화면만 오류를 던지게 바꾼다(lazy import도 이 가짜를 받는다).
const control = vi.hoisted(() => ({ fail: true }));
vi.mock('@/pages/dashboard/DashboardPage', async () => {
  const react = await import('react');
  const { ApiRequestError } = await import('@/shared/api/errors');
  return {
    DashboardPage() {
      if (control.fail) {
        throw new ApiRequestError({
          code: 'CANDIDATE_NOT_FOUND',
          message: '후보를 찾을 수 없습니다.',
          status: 404,
          timestamp: '2026-09-27T14:02:11+09:00',
          path: '/api/v1/candidates/7',
        });
      }
      return react.createElement('h1', null, '대시보드 다시 그림');
    },
  };
});

beforeEach(() => {
  control.fail = true;
  stubApi();
  // React·React Router가 잡은 렌더 오류를 console.error로 찍는다. 테스트 출력만 조용히 한다.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  control.fail = true;
});

describe('RouteErrorBoundary', () => {
  it('화면이 오류를 던져도 주 메뉴는 남고, 본문에 오류 message와 다시 시도 버튼을 보인다', async () => {
    const { container } = renderRoute('/');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('후보를 찾을 수 없습니다.');
    expect(alert).toHaveTextContent('CANDIDATE_NOT_FOUND');
    expect(container.querySelector('nav[aria-label="주 메뉴"]')).not.toBeNull();
    expect(within(screen.getByRole('main')).getByRole('alert')).toBe(alert);
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeEnabled();
  });

  it("'다시 시도'를 누르면 오류가 풀리고 화면을 다시 그린다", async () => {
    const user = userEvent.setup();
    renderRoute('/');
    await screen.findByRole('alert');

    control.fail = false;
    await user.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(await screen.findByRole('heading', { name: '대시보드 다시 그림' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('다른 화면으로 옮기면 오류가 풀린다', async () => {
    const { router } = renderRoute('/');
    await screen.findByRole('alert');
    await router.navigate('/keywords');
    expect(await screen.findByRole('heading', { level: 1, name: '키워드' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('봉투가 아닌 오류도 message를 보인다', async () => {
    function Broken(): never {
      throw new Error('화면 코드가 깨졌습니다.');
    }
    renderRoute('/broken', {
      routes: [
        {
          path: '/',
          element: createElement(AppLayout),
          children: [
            {
              ErrorBoundary: RouteErrorBoundary,
              children: [{ path: 'broken', Component: Broken }],
            },
          ],
        },
      ],
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('화면 코드가 깨졌습니다.');
    expect(screen.getByRole('navigation', { name: '주 메뉴' })).toBeInTheDocument();
  });
});
