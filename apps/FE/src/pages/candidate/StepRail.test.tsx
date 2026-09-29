import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { CandidateHeader } from '@/features/step-engine';
import { StepRail, type StepRailProps } from './StepRail';
import { Button, DisabledReason } from '@/shared/ui';

function renderRail(props: Partial<StepRailProps> = {}) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: <StepRail candidateId="7" currentScreen="approval" {...props} />,
      },
    ],
    { initialEntries: ['/candidates/7/approval'] },
  );
  render(<RouterProvider router={router} />);
  return within(screen.getByRole('navigation', { name: '단계' }));
}

describe('StepRail 자리(칩·게이트)', () => {
  it('값이 없으면 상태 칩을 그리지 않고, 게이트 줄은 이름만 보인다', () => {
    const rail = renderRail();
    expect(rail.queryByText('완료')).toBeNull();
    expect(rail.getByText('G2 판정 확정')).toBeInTheDocument();
    expect(rail.queryByText(/· 통과|· 잠김|· 확인 필요/)).toBeNull();
  });

  it('후보 A(공통부품 §E): ②~⑧ 완료, ⑨ 미실행, G2·G3 통과, G4 확인 필요', () => {
    const done = { status: 'COMPLETED' } as const;
    const rail = renderRail({
      statuses: {
        SOURCING: done,
        PRICING: done,
        CATEGORY: done,
        THUMBNAIL: done,
        COPY: done,
        NOTICE_RAW: done,
        NOTICE_HTML: done,
        TAGS: done,
        UPLOAD: done,
        REGISTER: { status: 'NOT_RUN' },
      },
      groupStatuses: { content: done },
      gates: { G2: 'passed', G3: 'passed', G4: 'pending' },
      footer: (
        <>
          <Button size="sm" disabled aria-describedby="rerun-why">
            재실행 필요 단계 모두 실행
          </Button>
          <DisabledReason id="rerun-why" tone="muted">
            재실행 필요 단계가 없습니다
          </DisabledReason>
        </>
      ),
    });
    const links = rail.getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual([
      '②소싱완료',
      '③판정완료',
      '④카테고리완료',
      '⑤썸네일완료',
      '⑥상세 콘텐츠완료',
      '⑥-1 카피완료',
      '⑥-2 원산지·소재완료',
      '⑥-3 고시·HTML완료',
      '⑦태그완료',
      '⑧이미지 업로드완료',
      '⑨등록미실행',
    ]);
    expect(rail.getByText('G2 판정 확정 · 통과')).toBeInTheDocument();
    expect(rail.getByText('G3 썸네일 선택 · 통과')).toBeInTheDocument();
    expect(rail.getByText('G4 최종 승인 · 확인 필요')).toBeInTheDocument();
    expect(rail.getByRole('link', { current: 'step' })).toHaveTextContent('⑧이미지 업로드');
    expect(rail.getByRole('button', { name: '재실행 필요 단계 모두 실행' })).toBeDisabled();
  });

  it('실패(중단됨)은 failureKind로 보인다', () => {
    const rail = renderRail({
      statuses: { SOURCING: { status: 'FAILED', failureKind: 'INTERRUPTED' } },
    });
    expect(rail.getByRole('link', { name: /소싱/ })).toHaveTextContent('실패(중단됨)');
  });
});

describe('CandidateHeader', () => {
  it('오른쪽 버튼은 슬롯이다(단계 화면 틀은 후보 목록, SCR-12는 후보 제외)', () => {
    render(
      <CandidateHeader
        title="아식스 젤카야노 14 · 크림/블랙"
        gates={[
          { gate: 'G2', state: 'passed' },
          { gate: 'G4', state: 'pending' },
        ]}
        caption="라쿠텐 페이지 14:02 받음 · 20:02까지 유효"
        actions={<Button variant="danger">후보 제외</Button>}
      />,
    );
    const header = within(screen.getByRole('region', { name: '후보 정보' }));
    expect(header.getByText('아식스 젤카야노 14 · 크림/블랙')).toBeInTheDocument();
    expect(header.getByText('G2 판정 확정 · 통과')).toBeInTheDocument();
    expect(header.getByText('G4 최종 승인 · 확인 필요')).toBeInTheDocument();
    expect(header.getByRole('button', { name: '후보 제외' })).toBeInTheDocument();
  });

  it('게이트 값이 없으면 게이트 줄을 그리지 않는다', () => {
    render(<CandidateHeader title="후보 7" />);
    const header = within(screen.getByRole('region', { name: '후보 정보' }));
    expect(header.queryByText(/G\d/)).toBeNull();
    expect(header.queryByRole('button')).toBeNull();
  });
});
