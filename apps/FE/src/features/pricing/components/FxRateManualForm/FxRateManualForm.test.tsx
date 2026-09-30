import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { fxRecord } from '@/test/fixtures/pricing';
import { createTestQueryClient } from '@/test/renderRoute';
import { FxRateManualForm } from './FxRateManualForm';

const NOW = () => new Date('2026-09-28T02:05:00.000Z'); // 11:05 KST

function renderForm() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <FxRateManualForm now={NOW} />
    </QueryClientProvider>,
  );
}

const posts = (api: ReturnType<typeof stubApi>) =>
  api.requests.filter((r) => r.method === 'POST' && new URL(r.url).pathname === '/api/v1/fx-rates');

describe('FxRateManualForm(F-ST-06, P2-04)', () => {
  it('USD를 고르면 단위 100이 꺼지고 1로 바뀐다. 원가 환율이면 USD를 고를 수 없다', async () => {
    stubApi();
    renderForm();
    const currency = screen.getByLabelText('통화');
    expect(screen.getByRole('option', { name: '달러(USD)' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('종류'), 'CUSTOMS');
    await userEvent.selectOptions(currency, 'USD');
    expect(screen.getByRole('radio', { name: '100달러' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '1달러' })).toBeChecked();
  });

  it('제출하면 POST /fx-rates 본문이 입력값과 같다(기준 시각 +09:00, 빈 출처는 null)', async () => {
    const api = stubApi({
      'POST /fx-rates': () => jsonResponse(fxRecord({ id: 9, source: 'MANUAL' }), 201),
    });
    renderForm();
    await userEvent.selectOptions(screen.getByLabelText('종류'), 'CUSTOMS');
    await userEvent.type(screen.getByLabelText('값'), '876.5');
    await userEvent.type(screen.getByLabelText('출처 설명'), '은행 고시');
    await userEvent.click(screen.getByRole('button', { name: '환율 넣기' }));
    await waitFor(() => expect(posts(api)).toHaveLength(1));
    expect(await posts(api)[0]!.json()).toEqual({
      rateKind: 'CUSTOMS',
      currency: 'JPY',
      rateValue: 876.5,
      unit: 100,
      sourceNote: '은행 고시',
      referenceAt: '2026-09-28T11:05:00+09:00',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('넣었습니다 · 원가 환율 8.76원/엔');
    expect(posts(api)[0]!.headers.get('X-AutoStore-Client')).toBe('1');
  });

  it('보내기 전 칸 검사: 값이 비면 요청 없이 칸 옆에 오류', async () => {
    const api = stubApi();
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: '환율 넣기' }));
    expect(screen.getByLabelText('값')).toHaveAccessibleDescription(
      expect.stringContaining('0보다 큰 숫자') as unknown as string,
    );
    expect(posts(api)).toHaveLength(0);
  });

  it('422 fieldErrors를 칸 옆에 보인다', async () => {
    stubApi({
      'POST /fx-rates': () =>
        errorResponse(422, 'VALIDATION_FAILED', '입력값을 확인해 주세요.', {
          fieldErrors: [{ field: 'referenceAt', message: '시각과 시간대까지 넣어 주세요.' }],
        }),
    });
    renderForm();
    await userEvent.type(screen.getByLabelText('값'), '876');
    await userEvent.click(screen.getByRole('button', { name: '환율 넣기' }));
    await waitFor(() =>
      expect(screen.getByLabelText('기준 시각(한국 시간)')).toHaveAccessibleDescription(
        '시각과 시간대까지 넣어 주세요.',
      ),
    );
    expect(screen.getByLabelText('기준 시각(한국 시간)')).toHaveAttribute('aria-invalid', 'true');
  });
});
