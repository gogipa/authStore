import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import {
  rateTableDetail,
  rateTableImportResult,
  rateTablePage,
  rateTableSummary,
  rateTier,
} from '@/test/fixtures/pricing';
import { createTestQueryClient } from '@/test/renderRoute';
import { ForwarderRateTablePanel } from './ForwarderRateTablePanel';

const LIST = 'GET /forwarder-rate-tables';
const IMPORT = 'POST /forwarder-rate-tables';

function renderPanel() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ForwarderRateTablePanel defaultFeeKrw={15000} />
    </QueryClientProvider>,
  );
}

const csv = (name = 'rate-table-v2026-10.csv') =>
  new File(
    ['weight_max_kg,fee,currency,volumetric_divisor,volumetric_applies_when\n1.5,1500,JPY,5000,\n'],
    name,
    {
      type: 'text/csv',
    },
  );
const tierRows = () =>
  within(screen.getByRole('table', { name: '무게 구간' }))
    .getAllByRole('row')
    .slice(1)
    .map((tr) =>
      within(tr)
        .getAllByRole('cell')
        .map((td) => td.textContent),
    );

describe('ForwarderRateTablePanel(F-ST-04, P2-04 — SCR-10 비용·요금표 탭)', () => {
  it('활성 버전과 구간 표(무게 오름차순), CSV 열 안내(보드 문구)', async () => {
    const active = rateTableDetail();
    stubApi({
      [LIST]: () => jsonResponse(rateTablePage([rateTableSummary()])),
      'GET /forwarder-rate-tables/1': () => jsonResponse(active),
    });
    renderPanel();
    expect(await screen.findByRole('table', { name: '무게 구간' })).toBeInTheDocument();
    expect(
      screen.getByText('CSV 열: 무게 상한 · 요금 · 통화(엔/원) · 부피무게 나눗수 · 적용 조건'),
    ).toBeInTheDocument();
    expect(screen.getByText('활성 v2026-09 · #1')).toBeInTheDocument();
    expect(tierRows()).toEqual([
      ['0.5kg', '9,000원', '원', '—', '부피무게 안 봄'],
      ['1.2kg', '15,000원', '원', '—', '부피무게 안 봄'],
      ['2kg', '18,000원', '원', '6,000', '세 변 합 160cm 초과일 때'],
    ]);
  });

  it('활성 요금표가 없으면 기본 배대지 비용(가정값) 안내', async () => {
    stubApi({ [LIST]: () => jsonResponse(rateTablePage([])) });
    renderPanel();
    expect(
      await screen.findByText(
        '활성 요금표가 없어 판정은 배대지 비용 15,000원(가정값)으로 계산합니다.',
      ),
    ).toBeInTheDocument();
  });

  it('가져오기 성공 뒤 활성 버전과 구간 표가 바뀐다(multipart POST)', async () => {
    const before = rateTableDetail();
    const after = rateTableDetail(
      { id: 2, sourceFileName: 'rate-table-v2026-10.csv', importedAt: '2026-10-01T00:00:00.000Z' },
      [rateTier({ id: 7, weightMaxKg: 1.5, fee: 1500, currency: 'JPY', volumetricDivisor: 5000 })],
    );
    let current = before;
    const api = stubApi({
      [LIST]: (req) =>
        jsonResponse(
          rateTablePage(
            new URL(req.url).searchParams.get('active') === 'true'
              ? [current]
              : current.id === before.id
                ? [before]
                : [after, { ...before, isActive: false }],
          ),
        ),
      'GET /forwarder-rate-tables/1': () => jsonResponse(before),
      'GET /forwarder-rate-tables/2': () => jsonResponse(after),
      [IMPORT]: () => {
        current = after;
        return jsonResponse(rateTableImportResult(after, { rerunRequiredStepCount: 2 }), 201);
      },
    });
    renderPanel();
    await screen.findByText('활성 v2026-09 · #1');
    await userEvent.upload(screen.getByLabelText('요금표 CSV'), csv());
    await userEvent.type(screen.getByLabelText('배대지 이름(선택)'), '배대지 B');
    await userEvent.click(screen.getByRole('button', { name: 'CSV 가져오기' }));
    expect(await screen.findByText('활성 v2026-10 · #2')).toBeInTheDocument();
    expect(tierRows()).toEqual([['1.5kg', '¥1,500', '엔', '5,000', '늘 비교']]);
    expect(screen.getByRole('status')).toHaveTextContent(
      '새 버전(#2 · 구간 1개)을 가져와 켰습니다 · 판정 2건이 재실행 필요가 됐습니다',
    );
    const posts = api.requests.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers.get('X-AutoStore-Client')).toBe('1');
  });

  it('IMPORT_PARSE_FAILED면 행·열 오류 목록을 보인다', async () => {
    stubApi({
      [LIST]: () => jsonResponse(rateTablePage([])),
      [IMPORT]: () =>
        errorResponse(
          422,
          'IMPORT_PARSE_FAILED',
          '파일(또는 붙여 넣은 글)에서 필요한 열이나 형식을 찾지 못했습니다.',
          {
            fieldErrors: [
              { field: 'row2.currency', message: '통화는 JPY 또는 KRW여야 합니다.' },
              { field: 'row4.weight_max_kg', message: '같은 무게 구간이 2줄에 이미 있습니다.' },
            ],
          },
        ),
    });
    renderPanel();
    await screen.findByText('활성 요금표 없음');
    await userEvent.upload(screen.getByLabelText('요금표 CSV'), csv('bad.csv'));
    await userEvent.click(screen.getByRole('button', { name: 'CSV 가져오기' }));
    const list = await screen.findByRole('list', { name: '요금표 오류 위치' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'row2.currency 통화는 JPY 또는 KRW여야 합니다.',
      'row4.weight_max_kg 같은 무게 구간이 2줄에 이미 있습니다.',
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent('필요한 열이나 형식을 찾지 못했습니다');
  });

  it('파일을 고르지 않으면 요청 없이 안내', async () => {
    const api = stubApi({ [LIST]: () => jsonResponse(rateTablePage([])) });
    renderPanel();
    await screen.findByText('활성 요금표 없음');
    await userEvent.click(screen.getByRole('button', { name: 'CSV 가져오기' }));
    expect(screen.getByRole('alert')).toHaveTextContent('가져올 CSV 파일을 골라 주세요.');
    await waitFor(() => expect(api.requests.filter((r) => r.method === 'POST')).toHaveLength(0));
  });
});
