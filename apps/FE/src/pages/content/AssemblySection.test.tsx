import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/shared/api/errors';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { contentAssemblyOutput, contentField } from '@/test/fixtures/content';
import { filledProfile } from '@/test/fixtures/purchaseAgencyProfile';
import { railItem } from '@/test/fixtures/stepEngine';
import { createTestQueryClient } from '@/test/renderRoute';
import { AssemblySection, type AssemblySectionProps } from './AssemblySection';

function renderSection(props: Partial<AssemblySectionProps> = {}, profile = filledProfile()) {
  const api = stubApi({
    'GET /purchase-agency-profile': () => jsonResponse(profile),
    'POST /candidates/1/steps/NOTICE_HTML/owner-edits': () =>
      jsonResponse(
        {
          stepRunId: 107,
          candidateId: 1,
          stepCode: 'NOTICE_HTML',
          version: 2,
          executionMode: 'OWNER_EDIT',
          ownerAction: 'EDIT',
          baseStepRunId: 106,
          status: 'COMPLETED',
          staleDownstreamSteps: [],
          propagatedSteps: [],
          warnings: [],
        },
        201,
      ),
  });
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <AssemblySection
          candidateId={1}
          item={railItem({ stepCode: 'NOTICE_HTML', status: 'COMPLETED' })}
          output={contentAssemblyOutput()}
          reloadKey={1}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return api;
}

describe('AssemblySection(SCR-06 ⑥-3 고시·HTML, P3-04)', () => {
  it('상품명 카운터 33/100 · 템플릿 제안 칩 · 금지 수식어 없음 · 템플릿 설명. 문구 검사(M2)는 없다', async () => {
    renderSection();
    expect(screen.getByRole('heading', { level: 2, name: '⑥-3 고시·HTML' })).toBeInTheDocument();
    expect(screen.getByTestId('product-name-counter')).toHaveTextContent('33/100');
    expect(screen.getByText('템플릿 제안')).toBeInTheDocument();
    expect(screen.getByText(/금지 수식어 없음 · 반복 단어 없음/)).toBeInTheDocument();
    expect(screen.getByText('· 병행수입품 아님')).toBeInTheDocument();
    expect(
      screen.getByText('템플릿: 브랜드 시리즈 모델명 상품유형 대표색상 성별'),
    ).toBeInTheDocument();
    expect(await screen.findByText('프로필 확인됨: 상호·수입자·A/S')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '프로필 보기' })).toHaveAttribute('href', '/settings');
    expect(screen.queryByText('문구 검사')).not.toBeInTheDocument();
  });

  it('상품 사양 블록·고시 표(굽높이 넣지 않음)·구매대행 고지(고칠 수 없음·템플릿과 일치·붙은 문장)', () => {
    renderSection();
    const spec = screen.getByRole('list', { name: '상품 사양 블록' });
    expect(within(spec).getByText('· 제조국(원산지): 베트남')).toBeInTheDocument();
    expect(
      within(spec).getByText('· 사이즈: 250~265·275mm (JP 25.0~26.5·27.5cm)'),
    ).toBeInTheDocument();
    expect(screen.getByText('수입산 · 아시아 > 베트남 · 단일 국가')).toBeInTheDocument();
    expect(screen.getByText('넣지 않음 · 굽 재료를 쓰는 여성화만 넣습니다')).toBeInTheDocument();
    expect(screen.getByText('제조자: 아식스 / 수입자: [수입자]')).toBeInTheDocument();
    expect(screen.getByText('고칠 수 없음')).toBeInTheDocument();
    expect(screen.getByText('템플릿과 일치')).toBeInTheDocument();
    expect(
      screen.getByText('기준일 2026-09-24 · 붙은 문장: 가죽 소재 · AI 이미지'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '전체 보기' })).toBeInTheDocument();
  });

  it('100자를 넘으면 경고가 보이지만 저장은 켜져 있고, 저장은 오너 수정(EDIT product_name)', async () => {
    const api = renderSection();
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: '상품명' });
    await user.clear(input);
    await user.type(input, `${'가'.repeat(100)} 나`);
    expect(screen.getByTestId('product-name-counter')).toHaveTextContent('102/100');
    expect(screen.getByText(/100자를 넘었습니다/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: '상품명 저장' });
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() =>
      expect(api.requests.filter((r) => r.url.includes('/owner-edits'))).toHaveLength(1),
    );
    const req = api.requests.find((r) => r.url.includes('/owner-edits'))!;
    expect(await req.json()).toEqual({
      ownerAction: 'EDIT',
      baseStepRunId: 106,
      fields: [{ fieldKey: 'product_name', value: `${'가'.repeat(100)} 나` }],
    });
  });

  it('프로필 빈칸이면 막힘 띠와 설정으로 가는 링크, 409 PROFILE_INCOMPLETE도 같다', async () => {
    renderSection({}, filledProfile({ importer: null, missingFields: ['importer'] }));
    const banner = await screen.findByText(/구매대행 프로필에 빈칸\(수입자\)/);
    expect(banner).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '설정에서 프로필 채우기' })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(screen.queryByText('프로필 확인됨: 상호·수입자·A/S')).not.toBeInTheDocument();
  });

  it('실행 오류 409 PROFILE_INCOMPLETE → 막힘 띠 + /settings 링크(실행 전)', async () => {
    const error = new ApiRequestError({
      code: 'PROFILE_INCOMPLETE',
      message: '구매대행 프로필에 빈칸(수입자)이 있습니다. 설정에서 채워 주세요.',
      status: 409,
      timestamp: '2026-09-28T05:00:00+09:00',
      path: '/api/v1',
    });
    renderSection({ output: undefined, runError: error });
    expect(
      await screen.findByText('구매대행 프로필에 빈칸(수입자)이 있습니다. 설정에서 채워 주세요.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '설정에서 프로필 채우기' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it("재확인 필요 필드는 칩과 '현재 근거로 확인'(recheckConfirmed)", async () => {
    const api = renderSection({
      output: contentAssemblyOutput({
        fields: [
          contentField({
            stepRunId: 106,
            fieldKey: 'notice.size',
            value: '250~275mm',
            valueSource: 'OWNER_INPUT',
            ownerConfirmedAt: '2026-09-28T05:40:00.000Z',
            recheckReason: 'SALE_SIZES_CHANGED',
            recheckRequired: true,
          }),
        ],
      }),
    });
    expect(screen.getByText('재확인 필요')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '현재 근거로 확인' }));
    await waitFor(() =>
      expect(api.requests.filter((r) => r.url.includes('/owner-edits'))).toHaveLength(1),
    );
    const req = api.requests.find((r) => r.url.includes('/owner-edits'))!;
    expect(await req.json()).toMatchObject({
      fields: [{ fieldKey: 'notice.size', recheckConfirmed: true }],
    });
  });

  it("'필드 고치기'는 고친 고시 칸만 보낸다(굽높이를 비우면 null)", async () => {
    const api = renderSection({
      output: contentAssemblyOutput({
        noticeFields: { ...contentAssemblyOutput().noticeFields, height: '약 3cm' },
      }),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '필드 고치기' }));
    const form = screen.getByRole('group', { name: '고시 필드 고치기' });
    await user.clear(within(form).getByRole('textbox', { name: '색상' }));
    await user.type(within(form).getByRole('textbox', { name: '색상' }), '크림');
    await user.clear(within(form).getByRole('textbox', { name: '굽높이(비우면 항목을 뺀다)' }));
    await user.click(within(form).getByRole('button', { name: '고시 저장' }));
    await waitFor(() =>
      expect(api.requests.filter((r) => r.url.includes('/owner-edits'))).toHaveLength(1),
    );
    const req = api.requests.find((r) => r.url.includes('/owner-edits'))!;
    expect(await req.json()).toMatchObject({
      fields: [
        { fieldKey: 'notice.color', value: '크림' },
        { fieldKey: 'notice.height', value: null },
      ],
    });
  });

  it('실행 전이면 안내 글만(미리보기 없음)', () => {
    renderSection({ output: undefined });
    expect(screen.getByText(/⑥-3을 실행하면/)).toBeInTheDocument();
    expect(screen.queryByTitle('상세페이지 미리보기')).not.toBeInTheDocument();
  });
});
