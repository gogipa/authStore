import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { railItem } from '@/test/fixtures/stepEngine';
import { createTestQueryClient } from '@/test/renderRoute';
import { StepStatusBar } from '../StepStatusBar/StepStatusBar';
import { StaleInputs, type StaleInputsProps } from './StaleInputs';

function renderStale(props: Partial<StaleInputsProps> = {}) {
  const queryClient = createTestQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <StaleInputs
        candidateId={13}
        stepCode="COPY"
        staleInputs={['owner.referenceSelection']}
        currentStepRunId={140}
        {...props}
      />
    </QueryClientProvider>,
  );
}

const DIFF = {
  candidateId: 13,
  stepCode: 'COPY',
  status: 'RERUN_REQUIRED',
  stepRunId: 140,
  staleInputs: ['sourcing.itemText'],
  staleSince: '2026-09-28T05:00:00.000Z',
  keepAsIsAllowed: true,
  inputs: [
    {
      inputKey: 'sourcing.itemText',
      sourceType: 'PREV_STEP',
      changed: true,
      usedSourceStepRunId: 100,
      currentSourceStepRunId: 101,
      usedValueHash: 'a'.repeat(64),
      currentValueHash: 'b'.repeat(64),
    },
    {
      inputKey: 'sourcing.skuAttributes',
      sourceType: 'PREV_STEP',
      changed: false,
      usedSourceStepRunId: 100,
      currentSourceStepRunId: 101,
      usedValueHash: 'c'.repeat(64),
      currentValueHash: 'c'.repeat(64),
    },
  ],
};

describe('StaleInputs — 재실행 필요 사유(F-CW-11·19)', () => {
  it("'바뀐 입력: 레퍼런스 선택'. '그대로 유지'는 COPY에서만 보인다", () => {
    stubApi();
    renderStale({ stepCode: 'THUMBNAIL' });
    expect(screen.getByText('바뀐 입력: 레퍼런스 선택')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '그대로 유지' })).toBeNull();
  });

  it("COPY '그대로 유지' → KEEP_AS_IS(baseStepRunId = 현재 버전)", async () => {
    const api = stubApi();
    let body: unknown = null;
    api.on('POST /candidates/13/steps/COPY/owner-edits', async (req) => {
      body = await req.json();
      return jsonResponse({ stepRunId: 141 }, 201);
    });
    renderStale({ staleInputs: ['sourcing.itemText', 'owner.domesticPrice'] });
    expect(screen.getByText('바뀐 입력: ② 상품명·설명, 국내 기준가')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '그대로 유지' }));
    await waitFor(() => expect(body).toEqual({ ownerAction: 'KEEP_AS_IS', baseStepRunId: 140 }));
  });

  it("'비교 보기'는 stale-diff를 읽어 입력별 바뀜·같음과 쓴 실행 ↔ 지금 실행을 보인다", async () => {
    const api = stubApi({
      'GET /candidates/13/steps/COPY/stale-diff': () => jsonResponse(DIFF),
    });
    renderStale();
    expect(api.requests).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: '비교 보기' }));
    const list = within(await screen.findByRole('list', { name: '입력 비교' }));
    const items = list.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('② 상품명·설명바뀜쓴 실행 #100 → 지금 #101');
    expect(items[1]).toHaveTextContent('② SKU 속성같음');
    expect(screen.getByRole('button', { name: '비교 닫기' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

describe('StepStatusBar — 단계 본문 맨 위 상태 줄(공통부품 §H)', () => {
  it("상태 칩 · '마지막 실행 HH:MM · 버전 v1' · 입력 출처 · 재실행 사유 · 버튼 자리", () => {
    render(
      <StepStatusBar
        item={railItem(
          {
            stepCode: 'THUMBNAIL',
            status: 'RERUN_REQUIRED',
            staleInputs: ['owner.referenceSelection'],
          },
          { endedAt: '2026-09-28T05:08:00.000Z' },
        )}
        source="② 원본 이미지"
        actions={<button type="button">다시 실행</button>}
      />,
    );
    expect(screen.getByText('재실행 필요')).toBeInTheDocument();
    expect(screen.getByText('마지막 실행 14:08 · 버전 v1')).toBeInTheDocument();
    expect(screen.getByText('입력 출처: ② 원본 이미지')).toBeInTheDocument();
    expect(screen.getByText('바뀐 입력: 레퍼런스 선택')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 실행' })).toBeInTheDocument();
  });

  it("미실행이면 '—', 실패(중단됨)은 failureKind로 보인다", () => {
    const { rerender } = render(
      <StepStatusBar item={railItem({ stepCode: 'SOURCING' })} source="검색어" />,
    );
    expect(screen.getByText('마지막 실행 — · 버전 —')).toBeInTheDocument();
    rerender(
      <StepStatusBar
        item={railItem({ stepCode: 'SOURCING', status: 'FAILED' }, { failureKind: 'INTERRUPTED' })}
        source="검색어"
      />,
    );
    expect(screen.getByText('실패(중단됨)')).toBeInTheDocument();
  });
});
