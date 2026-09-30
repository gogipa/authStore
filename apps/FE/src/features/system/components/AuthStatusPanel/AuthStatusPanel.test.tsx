import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { authStatus, failedAuthStatus } from '@/test/fixtures/system';
import { createTestQueryClient } from '@/test/renderRoute';
import { AuthStatusPanel } from './AuthStatusPanel';

function renderPanel(onReenterSecret?: (key: string) => void) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthStatusPanel onReenterSecret={onReenterSecret} />
    </QueryClientProvider>,
  );
}

const panel = () => within(screen.getByRole('region', { name: '인증 상태' }));
const causeRow = (term: string) => panel().getByText(term).parentElement!;

describe('AuthStatusPanel — 인증 상태(SCR-11, P1-07)', () => {
  it("tokenValid=true → '정상'과 '14:00 발급 · 16:30에 새로 받음', 원인 네 가지 안내(보드 문구)", async () => {
    stubApi({ 'GET /auth-status': () => jsonResponse(authStatus()) });
    renderPanel();
    expect(await panel().findByText('정상')).toBeInTheDocument();
    expect(panel().getByText('커머스API 토큰')).toBeInTheDocument();
    expect(panel().getByText(/발급 ·/).textContent).toBe('14:00 발급 · 16:30에 새로 받음');
    expect(
      panel().getByText('다시 받기도 실패하면 원인별로 이렇게 안내합니다'),
    ).toBeInTheDocument();
    const terms = panel()
      .getAllByRole('term')
      .map((t) => t.textContent);
    expect(terms).toEqual([
      '통합매니저 인증 휴면',
      '시크릿 변경',
      '스토어 이용정지',
      '호출 IP 불일치',
    ]);
    expect(panel().getByText('커머스API센터에서 다시 인증')).toBeInTheDocument();
    expect(panel().getByText('스마트스토어센터에서 확인')).toBeInTheDocument();
    expect(panel().getByText('등록 IP 확인 · 공인 IP 칸')).toBeInTheDocument();
    expect(panel().queryByText('지금 원인')).toBeNull();
  });

  it("causeCategory=SECRET_CHANGED → 그 줄을 강조('지금 원인'), 'client_secret 다시 넣기'는 키 입력으로 잇는다", async () => {
    stubApi({ 'GET /auth-status': () => jsonResponse(failedAuthStatus('SECRET_CHANGED')) });
    const onReenter = vi.fn();
    renderPanel(onReenter);
    expect(await panel().findByText('실패')).toBeInTheDocument();
    const row = causeRow('시크릿 변경');
    expect(row).toHaveAttribute('data-state', 'current');
    expect(within(row).getByText('지금 원인')).toBeInTheDocument();
    expect(causeRow('호출 IP 불일치')).not.toHaveAttribute('data-state');
    const link = panel().getByRole('link', { name: 'client_secret 다시 넣기' });
    expect(link).toHaveAttribute('href', '#secret-COMMERCE_CLIENT_SECRET');
    await userEvent.click(link);
    expect(onReenter).toHaveBeenCalledWith('COMMERCE_CLIENT_SECRET');
  });

  it.each([
    ['DORMANT_AUTH', '통합매니저 인증 휴면'],
    ['STORE_SUSPENDED', '스토어 이용정지'],
    ['IP_NOT_ALLOWED', '호출 IP 불일치'],
  ] as const)('causeCategory=%s → %s 줄 강조', async (cause, term) => {
    stubApi({ 'GET /auth-status': () => jsonResponse(failedAuthStatus(cause)) });
    renderPanel();
    await panel().findByText('실패');
    expect(causeRow(term)).toHaveAttribute('data-state', 'current');
    expect(panel().getAllByText('지금 원인')).toHaveLength(1);
  });

  it('UNKNOWN이면 강조 없이 오류 코드·추적 번호를 보인다', async () => {
    stubApi({
      'GET /auth-status': () => jsonResponse(failedAuthStatus('UNKNOWN', 'BadRequest')),
    });
    renderPanel();
    expect(await panel().findByText(/네 가지에 들지 않는 실패입니다/)).toBeInTheDocument();
    expect(panel().getAllByText('BadRequest').length).toBeGreaterThan(0);
    expect(panel().getByText('fixture-trace-401-authn')).toBeInTheDocument();
    expect(panel().queryByText('지금 원인')).toBeNull();
  });

  it("키가 없으면 '키 없음'", async () => {
    stubApi({
      'GET /auth-status': () =>
        jsonResponse(
          authStatus({
            secretsConfigured: false,
            tokenValid: false,
            tokenExpiresAt: null,
            lastCheckedAt: null,
            lastSucceeded: null,
            lastHttpStatus: null,
            lastTraceId: null,
          }),
        ),
    });
    renderPanel();
    expect(await panel().findByText('키 없음')).toBeInTheDocument();
    expect(panel().getByText('client_id·client_secret을 먼저 넣어 주세요')).toBeInTheDocument();
  });

  it("'토큰 다시 받기' → POST /auth-checks 1회(X-AutoStore-Client), 502면 봉투 message를 보인다", async () => {
    const api = stubApi({ 'GET /auth-status': () => jsonResponse(authStatus()) });
    const message =
      '네이버 커머스API 인증에 실패했습니다(호출 IP 불일치). 시스템 상태 화면의 안내를 따라 주세요.';
    api.on('POST /auth-checks', () =>
      errorResponse(502, 'COMMERCE_AUTH_FAILED', message, {
        details: { causeCategory: 'IP_NOT_ALLOWED' },
      }),
    );
    renderPanel();
    await panel().findByText('정상');
    await userEvent.click(panel().getByRole('button', { name: '토큰 다시 받기' }));
    expect(await panel().findByRole('alert')).toHaveTextContent(message);
    const posts = api.requests.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(new URL(posts[0]!.url).pathname).toBe('/api/v1/auth-checks');
    expect(posts[0]!.headers.get('X-AutoStore-Client')).toBe('1');
    // 실패해도 인증 상태를 다시 읽는다
    await waitFor(() => expect(api.requests.filter((r) => r.method === 'GET')).toHaveLength(2));
  });

  it("'토큰 다시 받기' 성공 → '토큰을 새로 받았습니다'", async () => {
    const api = stubApi({ 'GET /auth-status': () => jsonResponse(authStatus()) });
    api.on('POST /auth-checks', () => jsonResponse(authStatus()));
    renderPanel();
    await panel().findByText('정상');
    await userEvent.click(panel().getByRole('button', { name: '토큰 다시 받기' }));
    expect(await panel().findByRole('status')).toHaveTextContent('토큰을 새로 받았습니다.');
  });
});
