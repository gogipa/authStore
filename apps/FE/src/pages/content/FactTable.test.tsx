import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { contentFactOutput, contentField, factFields } from '@/test/fixtures/content';
import { railItem } from '@/test/fixtures/stepEngine';
import { createTestQueryClient } from '@/test/renderRoute';
import { FactTable, type FactTableProps } from './FactTable';

function renderFacts(props: Partial<FactTableProps> = {}) {
  const api = stubApi({
    'PUT /step-runs/105/content-fields/fact.origin': () =>
      jsonResponse({
        field: contentField({
          fieldKey: 'fact.origin',
          value: ['베트남'],
          valueSource: 'OWNER_INPUT',
        }),
        stepRunId: 105,
        stepRunStatus: 'COMPLETED',
        pendingInputs: [],
      }),
  });
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <FactTable
          candidateId={1}
          item={railItem({ stepCode: 'NOTICE_RAW', status: 'COMPLETED' })}
          output={contentFactOutput()}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return api;
}

function waitingOutput() {
  const fields = factFields().map((f) =>
    f.fieldKey === 'fact.origin'
      ? {
          ...f,
          value: null,
          generatedValue: null,
          extractionMethod: 'NONE' as const,
          evidenceQuote: null,
        }
      : f,
  );
  return contentFactOutput({
    stepRunStatus: 'WAITING_INPUT',
    fields,
    pendingInputs: ['fact.origin'],
  });
}

describe('FactTable(SCR-06 ⑥-2 원산지·소재, P3-03)', () => {
  it('항목·값·근거 원문·출처·방법 표. 방법 글이 네 가지(상품 속성·설명문·AI·정보 없음)로 보인다', () => {
    renderFacts();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: '근거 원문' })).toBeInTheDocument();
    expect(within(table).getByText('베트남')).toBeInTheDocument();
    expect(within(table).getByText("'原産国: ベトナム'")).toBeInTheDocument();
    expect(within(table).getAllByText('설명문에서 찾음').length).toBeGreaterThan(0);
    expect(within(table).getByText('상품 속성에서 찾음')).toBeInTheDocument();
    expect(within(table).getByText('AI로 찾음 · 스펙 이미지')).toBeInTheDocument();
    expect(within(table).getAllByText('정보 없음').length).toBeGreaterThan(0);
    expect(within(table).getByText('약 3cm')).toBeInTheDocument();
    expect(screen.queryByText('문구 검사')).not.toBeInTheDocument();
  });

  it("입력 대기면 경고 띠. '직접 넣기'는 근거 URL을 넣기 전에는 저장이 꺼지고, 넣으면 PUT content-fields로 보낸다", async () => {
    const api = renderFacts({
      item: railItem({ stepCode: 'NOTICE_RAW', status: 'WAITING_INPUT' }),
      output: waitingOutput(),
    });
    expect(screen.getByText(/원산지를 근거로 정하지 못했습니다/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '원산지를 근거 URL과 함께 직접 넣기' }));
    const save = screen.getByRole('button', { name: '원산지 저장' });
    await user.type(screen.getByRole('textbox', { name: '나라' }), '베트남');
    expect(save).toBeDisabled();
    expect(screen.getByText('근거 URL을 넣어야 저장할 수 있습니다.')).toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: '근거 URL' }),
      'item.rakuten.co.jp/shop-c/1/',
    );
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(api.requests.filter((r) => r.method === 'PUT')).toHaveLength(1));
    expect(await api.requests.find((r) => r.method === 'PUT')!.json()).toEqual({
      value: '베트남',
      evidenceUrl: 'item.rakuten.co.jp/shop-c/1/',
      evidenceQuote: null,
    });
  });

  it("'재확인 필요' 칩을 보이고, 완료 버전이면 '현재 근거로 확인'", () => {
    const fields = factFields().map((f) =>
      f.fieldKey === 'fact.origin'
        ? {
            ...f,
            valueSource: 'OWNER_INPUT' as const,
            recheckReason: 'ITEM_CODE_CHANGED' as const,
            recheckRequired: true,
          }
        : f,
    );
    renderFacts({ output: contentFactOutput({ fields }) });
    expect(screen.getByText('재확인 필요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '현재 근거로 확인' })).toBeEnabled();
  });

  it("'색상 표기' 줄(P3-04 F-CT-17): 선택 색상 원문·AI 보조 표시, 입력 대기면 '고치기' → PUT fact.color_ko", async () => {
    const color = contentField({
      id: 16,
      stepRunId: 105,
      fieldKey: 'fact.color_ko',
      value: '크림/블랙',
      extractionMethod: 'AI',
      evidenceQuote: 'クリーム/ブラック',
    });
    const api = renderFacts({
      item: railItem({ stepCode: 'NOTICE_RAW', status: 'WAITING_INPUT' }),
      output: contentFactOutput({
        ...waitingOutput(),
        fields: [...waitingOutput().fields, color],
      }),
    });
    api.on('PUT /step-runs/105/content-fields/fact.color_ko', () =>
      jsonResponse({
        field: { ...color, value: '크림', valueSource: 'OWNER_INPUT' },
        stepRunId: 105,
        stepRunStatus: 'WAITING_INPUT',
        pendingInputs: ['fact.origin'],
      }),
    );
    const table = screen.getByRole('table');
    const row = within(table).getByRole('row', { name: /색상 표기/ });
    expect(within(row).getByText('크림/블랙')).toBeInTheDocument();
    expect(within(row).getByText("'クリーム/ブラック'")).toBeInTheDocument();
    expect(within(row).getByText('선택 색상 원문')).toBeInTheDocument();
    expect(within(row).getByText('사전에 없어 AI 보조')).toBeInTheDocument();
    expect(within(row).getByText('AI 생성')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: '색상 표기 고치기' }));
    const input = screen.getByRole('textbox', { name: '색상 표기' });
    await user.clear(input);
    await user.type(input, '크림');
    await user.click(screen.getByRole('button', { name: '색상 저장' }));
    await waitFor(() => expect(api.requests.filter((r) => r.method === 'PUT')).toHaveLength(1));
    const req = api.requests.find((r) => r.method === 'PUT')!;
    expect(req.url).toContain('/content-fields/fact.color_ko');
    expect(await req.json()).toEqual({ value: '크림' });
  });
});
