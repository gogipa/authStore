import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { COPY_DOC, contentCopyOutput, contentField } from '@/test/fixtures/content';
import { railItem } from '@/test/fixtures/stepEngine';
import { createTestQueryClient } from '@/test/renderRoute';
import { CopySection, type CopySectionProps } from './CopySection';

function renderCopy(props: Partial<CopySectionProps> = {}) {
  const api = stubApi({
    'POST /candidates/1/steps/COPY/owner-edits': () =>
      jsonResponse({ stepRunId: 204, status: 'COMPLETED' }, 201),
  });
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <CopySection
          candidateId={1}
          item={railItem(
            { stepCode: 'COPY', status: 'COMPLETED' },
            { aiEngine: 'CLAUDE', aiModel: 'sonnet' },
          )}
          output={contentCopyOutput()}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return api;
}

const ownerEdits = (api: ReturnType<typeof stubApi>) =>
  api.requests.filter((r) => r.method === 'POST' && r.url.includes('/owner-edits'));

describe('CopySection(SCR-06 ⑥-1 카피, P3-03)', () => {
  it("'AI 생성 · Claude Code' 칩·헤드라인 카운터 25/40·원문 사실 목록을 보인다. 41자째에 오류가 보이고 저장이 꺼진다", async () => {
    renderCopy();
    expect(screen.getByText('AI 생성 · Claude Code')).toBeInTheDocument();
    expect(screen.getByText('25/40')).toBeInTheDocument();
    for (const fact of COPY_DOC.source_facts_used) {
      expect(screen.getByText(fact)).toBeInTheDocument();
    }
    const headline = screen.getByRole('textbox', { name: /헤드라인/ });
    const user = userEvent.setup();
    await user.clear(headline);
    await user.type(headline, '가'.repeat(40));
    expect(screen.getByText('40/40')).toBeInTheDocument();
    expect(screen.queryByText(/40자 이하여야 합니다/)).not.toBeInTheDocument();
    await user.type(headline, '가');
    expect(screen.getByText('41/40')).toBeInTheDocument();
    expect(
      screen.getAllByText('헤드라인은 40자 이하여야 합니다(지금 41자).').length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '고친 내용 저장' })).toBeDisabled();
  });

  it("'그대로 유지'는 재실행 필요가 아니면 꺼지고 이유 글, keepAsIsAllowed면 켜져 KEEP_AS_IS를 보낸다", async () => {
    renderCopy();
    expect(screen.getByRole('button', { name: '그대로 유지' })).toBeDisabled();
    expect(screen.getByText('재실행 필요일 때만 고를 수 있습니다')).toBeInTheDocument();
  });

  it("재실행 필요(keepAsIsAllowed)면 '그대로 유지'가 켜지고 누르면 KEEP_AS_IS 오너 수정", async () => {
    const api = renderCopy({
      item: railItem({ stepCode: 'COPY', status: 'RERUN_REQUIRED' }),
      output: contentCopyOutput({ stepRunStatus: 'RERUN_REQUIRED', keepAsIsAllowed: true }),
    });
    const keep = screen.getByRole('button', { name: '그대로 유지' });
    expect(keep).toBeEnabled();
    await userEvent.setup().click(keep);
    await waitFor(() => expect(ownerEdits(api)).toHaveLength(1));
    expect(await ownerEdits(api)[0]!.json()).toEqual({
      ownerAction: 'KEEP_AS_IS',
      baseStepRunId: 104,
    });
  });

  it('헤드라인을 고치고 저장하면 고친 필드만 EDIT로 보낸다', async () => {
    const api = renderCopy();
    const user = userEvent.setup();
    const headline = screen.getByRole('textbox', { name: /헤드라인/ });
    await user.clear(headline);
    await user.type(headline, '새 헤드라인');
    await user.click(screen.getByRole('button', { name: '고친 내용 저장' }));
    await waitFor(() => expect(ownerEdits(api)).toHaveLength(1));
    expect(await ownerEdits(api)[0]!.json()).toEqual({
      ownerAction: 'EDIT',
      baseStepRunId: 104,
      fields: [{ fieldKey: 'copy.headline', value: '새 헤드라인' }],
    });
  });

  it('다시 실행 결과가 직접 고친 값과 다르면 나란히 보여 주고 고른다(choose)', async () => {
    const api = renderCopy({
      output: contentCopyOutput({
        copy: { ...COPY_DOC, headline: '직접 고친 헤드라인' },
        fields: [
          contentField({
            fieldKey: 'copy.headline',
            value: '직접 고친 헤드라인',
            generatedValue: COPY_DOC.headline,
            valueSource: 'OWNER_INPUT',
            ownerConfirmedAt: '2026-09-28T05:31:00.000Z',
            choicePending: true,
          }),
        ],
      }),
    });
    expect(screen.getByText('14:31 헤드라인 직접 고침 · v1')).toBeInTheDocument();
    expect(screen.getByText('직접 입력')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '새 결과로 바꾸기' }));
    await waitFor(() => expect(ownerEdits(api)).toHaveLength(1));
    expect(await ownerEdits(api)[0]!.json()).toEqual({
      ownerAction: 'EDIT',
      baseStepRunId: 104,
      fields: [{ fieldKey: 'copy.headline', choose: 'GENERATED' }],
    });
  });

  it('실행 전이면 안내 글만 보인다', () => {
    renderCopy({ item: railItem({ stepCode: 'COPY' }), output: undefined });
    expect(screen.getByText(/⑥-1을 실행하면/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '고친 내용 저장' })).not.toBeInTheDocument();
  });
});
