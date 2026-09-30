import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { secretStatusList } from '@/test/fixtures/system';
import { createTestQueryClient } from '@/test/renderRoute';
import { SecretKeysPanel } from './SecretKeysPanel';

const SECRET_VALUE = 'fake-client-secret-typed-in-test';

function renderPanel() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <SecretKeysPanel />
    </QueryClientProvider>,
  );
}

const panel = () => within(screen.getByRole('region', { name: '키 입력' }));
const requestsOf = (api: ReturnType<typeof stubApi>, method: string, path: string) =>
  api.requests.filter((r) => r.method === method && new URL(r.url).pathname === `/api/v1${path}`);

describe('SecretKeysPanel — 키 입력(SCR-11, P1-07)', () => {
  it('6행: 보드 라벨(+관세청 과세환율 키)과 저장 칩·다시 넣기, 값이 없으면 저장 안 됨·넣기', async () => {
    stubApi({
      'GET /secrets': () =>
        jsonResponse(
          secretStatusList([
            'COMMERCE_CLIENT_ID',
            'COMMERCE_CLIENT_SECRET',
            'RAKUTEN_APPLICATION_ID',
            'RAKUTEN_ACCESS_KEY',
            'KOREAEXIM_API_KEY',
          ]),
        ),
    });
    renderPanel();
    expect(
      await panel().findByText('값은 보여 주지 않습니다 · macOS 키체인에만 저장합니다'),
    ).toBeInTheDocument();
    const rows = await waitFor(() => {
      const items = panel().getAllByRole('listitem');
      expect(items).toHaveLength(6);
      return items;
    });
    expect(rows.map((r) => r.querySelector('span')?.textContent)).toEqual([
      '커머스API client_id',
      '커머스API client_secret',
      '라쿠텐 applicationId',
      '라쿠텐 accessKey',
      '환율 API 키',
      '관세청 과세환율 키',
    ]);
    await waitFor(() => expect(panel().getAllByText('키체인에 저장됨')).toHaveLength(5));
    expect(
      panel().getByRole('button', { name: '커머스API client_id 다시 넣기' }),
    ).toBeInTheDocument();
    expect(within(rows[5]!).getByText('저장 안 됨')).toBeInTheDocument();
    expect(panel().getByRole('button', { name: '관세청 과세환율 키 넣기' })).toHaveTextContent(
      '넣기',
    );
  });

  it("'다시 넣기' → type=password·autocomplete=off 칸, 저장 → PUT 1회({ value }, X-AutoStore-Client: 1), 성공 뒤 칸이 닫히고 DOM에 값이 없다", async () => {
    const api = stubApi({ 'GET /secrets': () => jsonResponse(secretStatusList()) });
    const bodies: unknown[] = [];
    api.on('PUT /secrets/COMMERCE_CLIENT_SECRET', async (req) => {
      bodies.push(await req.json());
      return new Response(null, { status: 204 });
    });
    const { container } = renderPanel();
    await userEvent.click(
      await panel().findByRole('button', { name: '커머스API client_secret 다시 넣기' }),
    );
    const input = panel().getByLabelText('커머스API client_secret 새 값');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveFocus();
    await userEvent.type(input, SECRET_VALUE);
    await userEvent.click(panel().getByRole('button', { name: '저장' }));

    expect(await panel().findByRole('status')).toHaveTextContent('키체인에 저장했습니다');
    const puts = requestsOf(api, 'PUT', '/secrets/COMMERCE_CLIENT_SECRET');
    expect(puts).toHaveLength(1);
    expect(puts[0]!.headers.get('X-AutoStore-Client')).toBe('1');
    expect(bodies).toEqual([{ value: SECRET_VALUE }]);
    expect(panel().queryByLabelText('커머스API client_secret 새 값')).toBeNull();
    expect(container.innerHTML).not.toContain(SECRET_VALUE);
    expect(document.body.innerHTML).not.toContain(SECRET_VALUE);
    // 저장 뒤 목록을 다시 읽는다
    await waitFor(() => expect(requestsOf(api, 'GET', '/secrets')).toHaveLength(2));
  });

  it('422면 칸 아래에 오류 문구(값은 되돌려 보이지 않는다)', async () => {
    const api = stubApi({ 'GET /secrets': () => jsonResponse(secretStatusList([])) });
    api.on('PUT /secrets/RAKUTEN_ACCESS_KEY', () =>
      errorResponse(422, 'VALIDATION_FAILED', '입력값을 확인해 주세요.', {
        fieldErrors: [{ field: 'value', message: '1자 이상 4096자 이하여야 합니다.' }],
      }),
    );
    renderPanel();
    await userEvent.click(await panel().findByRole('button', { name: '라쿠텐 accessKey 넣기' }));
    const input = panel().getByLabelText('라쿠텐 accessKey 새 값');
    await userEvent.type(input, 'x');
    await userEvent.click(panel().getByRole('button', { name: '저장' }));
    expect(await panel().findByText('1자 이상 4096자 이하여야 합니다.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('빈 값은 보내지 않고 칸 아래에 알린다', async () => {
    const api = stubApi({ 'GET /secrets': () => jsonResponse(secretStatusList([])) });
    renderPanel();
    await userEvent.click(await panel().findByRole('button', { name: '환율 API 키 넣기' }));
    await userEvent.click(panel().getByRole('button', { name: '저장' }));
    expect(panel().getByText('값을 넣어 주세요.')).toBeInTheDocument();
    expect(requestsOf(api, 'PUT', '/secrets/KOREAEXIM_API_KEY')).toHaveLength(0);
  });

  it('취소하면 칸을 닫는다', async () => {
    stubApi({ 'GET /secrets': () => jsonResponse(secretStatusList()) });
    renderPanel();
    const button = await panel().findByRole('button', { name: '라쿠텐 applicationId 다시 넣기' });
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(panel().getByRole('button', { name: '취소' }));
    expect(panel().queryByLabelText('라쿠텐 applicationId 새 값')).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('키체인을 못 열면(503) 차단 띠에 봉투 message', async () => {
    stubApi({
      'GET /secrets': () =>
        errorResponse(
          503,
          'KEYCHAIN_UNAVAILABLE',
          'macOS 키체인을 열 수 없습니다. 키체인 접근을 허용한 뒤 다시 해 주세요.',
        ),
    });
    renderPanel();
    expect(
      await panel().findByText(
        'macOS 키체인을 열 수 없습니다. 키체인 접근을 허용한 뒤 다시 해 주세요.',
      ),
    ).toBeInTheDocument();
  });
});
