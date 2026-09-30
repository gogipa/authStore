import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { FakeEventSource } from '@/test/fakeEventSource';
import { callUsageList } from '@/test/fixtures/callUsage';
import { metaSyncStatusList } from '@/test/fixtures/commerceMeta';
import { authStatus, failedAuthStatus, secretStatusList } from '@/test/fixtures/system';
import { renderRoute } from '@/test/renderRoute';

function stubSystem(status = authStatus()) {
  return stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList()),
    'GET /secrets': () => jsonResponse(secretStatusList()),
    'GET /auth-status': () => jsonResponse(status),
    'GET /commerce-meta-sync-runs/latest': () => jsonResponse(metaSyncStatusList()),
  });
}

async function renderSystem(path = '/system', options: Parameters<typeof renderRoute>[1] = {}) {
  const view = renderRoute(path, options);
  await screen.findByRole('heading', { level: 1, name: '시스템 상태' });
  return view;
}

const authStatusGets = (api: ReturnType<typeof stubApi>) =>
  api.requests.filter((r) => new URL(r.url).pathname === '/api/v1/auth-status');
const metaLatestGets = (api: ReturnType<typeof stubApi>) =>
  api.requests.filter((r) => new URL(r.url).pathname === '/api/v1/commerce-meta-sync-runs/latest');

describe('시스템 상태 화면(SCR-11, P1-07)', () => {
  it('머리(SCR-11)와 3열 틀, 열 A에 키 입력·인증 상태', async () => {
    stubSystem();
    const { container } = await renderSystem();
    expect(screen.getByText('SCR-11')).toBeInTheDocument();
    expect(
      screen.getByText(
        '키·인증·동기화·AI 도구가 준비됐는지 봅니다. 막힌 곳은 할 일을 함께 알려 드립니다.',
      ),
    ).toBeInTheDocument();
    const columns = container.querySelectorAll('[data-column]');
    expect([...columns].map((c) => c.getAttribute('data-column'))).toEqual(['A', 'B', 'C']);
    const columnA = within(columns[0] as HTMLElement);
    expect(columnA.getByRole('region', { name: '키 입력' })).toBeInTheDocument();
    expect(columnA.getByRole('region', { name: '인증 상태' })).toBeInTheDocument();
    // M2 패널은 만들지 않는다
    expect(screen.queryByRole('region', { name: '외부 호출 기록' })).toBeNull();
    // 열 B: (3) 메타데이터 동기화(P1-08)
    const columnB = within(columns[1] as HTMLElement);
    expect(columnB.getByRole('region', { name: '메타데이터 동기화' })).toBeInTheDocument();
  });

  it('SSE commerce-meta-sync.completed를 받으면 메타 동기화 상태를 다시 읽는다(P1-08)', async () => {
    const api = stubSystem();
    await renderSystem('/system', { EventSourceImpl: FakeEventSource });
    await waitFor(() => expect(metaLatestGets(api)).toHaveLength(1));
    const es = FakeEventSource.latest();
    act(() => {
      es.open();
      es.emit('commerce-meta-sync.completed', {
        runId: 9,
        target: 'CATEGORY',
        status: 'SUCCEEDED',
        finishedAt: '2026-09-28T09:10:00+09:00',
        itemCount: 8,
        errorMessage: null,
      });
    });
    await waitFor(() => expect(metaLatestGets(api)).toHaveLength(2));
  });

  it("'지금 동기화'가 키 없음(409)이면 '키 입력으로 가기' → 그 키 행 입력칸으로 초점(P1-08)", async () => {
    const api = stubSystem();
    api.on('POST /commerce-meta-sync-runs', () =>
      errorResponse(
        409,
        'SECRET_NOT_CONFIGURED',
        '커머스API client_id·client_secret 키가 아직 없습니다. 시스템 상태 화면에서 넣어 주세요.',
        { details: { secretKeys: ['COMMERCE_CLIENT_ID', 'COMMERCE_CLIENT_SECRET'] } },
      ),
    );
    await renderSystem();
    const meta = within(screen.getByRole('region', { name: '메타데이터 동기화' }));
    await userEvent.click(await meta.findByRole('button', { name: '지금 동기화' }));
    const link = await meta.findByRole('link', { name: '키 입력으로 가기' });
    expect(link).toHaveAttribute('href', '/system#secret-COMMERCE_CLIENT_ID');
    await userEvent.click(link);
    const input = await screen.findByLabelText('커머스API client_id 새 값');
    await waitFor(() => expect(input).toHaveFocus());
  });

  it("시크릿 변경 안내의 'client_secret 다시 넣기' → COMMERCE_CLIENT_SECRET 행 입력칸으로 초점", async () => {
    stubSystem(failedAuthStatus('SECRET_CHANGED'));
    await renderSystem();
    const auth = within(screen.getByRole('region', { name: '인증 상태' }));
    await userEvent.click(await auth.findByRole('link', { name: 'client_secret 다시 넣기' }));
    const input = await screen.findByLabelText('커머스API client_secret 새 값');
    expect(input).toHaveAttribute('type', 'password');
    await waitFor(() => expect(input).toHaveFocus());
    expect(
      screen.getByRole('button', { name: '커머스API client_secret 다시 넣기' }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('다른 화면이 /system#secret-COMMERCE_CLIENT_SECRET로 보내면 그 행 입력칸이 열리고 초점', async () => {
    stubSystem();
    await renderSystem('/system#secret-COMMERCE_CLIENT_SECRET');
    const input = await screen.findByLabelText('커머스API client_secret 새 값');
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('SSE auth.failed를 받으면 인증 상태를 다시 읽는다', async () => {
    const api = stubSystem();
    await renderSystem('/system', { EventSourceImpl: FakeEventSource });
    await waitFor(() => expect(authStatusGets(api)).toHaveLength(1));
    const es = FakeEventSource.latest();
    act(() => {
      es.open();
      es.emit('auth.failed', {
        target: 'COMMERCE_API',
        errorCode: 'GW.IP_NOT_ALLOWED',
        causeCategory: 'IP_NOT_ALLOWED',
        occurredAt: '2026-09-28T09:00:00+09:00',
      });
    });
    await waitFor(() => expect(authStatusGets(api)).toHaveLength(2));
  });
});
