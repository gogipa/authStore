import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import {
  categoryDecision,
  categoryOption,
  categorySelectionResult,
} from '@/test/fixtures/category';
import { createTestQueryClient } from '@/test/renderRoute';
import type { CategoryDecisionDetail } from '../../model/category';
import { CategoryPanel } from './CategoryPanel';

const DECISION_ID = 21;

function renderPanel(decision: CategoryDecisionDetail = categoryDecision()) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <CategoryPanel candidateId={1} decision={decision} genderSlot={<span>성별 자리</span>} />
    </QueryClientProvider>,
  );
}

const puts = (api: ReturnType<typeof stubApi>) =>
  api.requests.filter(
    (r) =>
      r.method === 'PUT' &&
      new URL(r.url).pathname === `/api/v1/category-decisions/${DECISION_ID}/selection`,
  );

const confirmButton = () => screen.getByRole('button', { name: '이 카테고리로 확정' });

describe('CategoryPanel(SCR-04 ④, P2-06)', () => {
  it('경로는 ` > `로 보이고, 막힌 후보 라디오는 꺼져 있고 옆에 이유 글이 보인다', () => {
    stubApi();
    renderPanel(
      categoryDecision({
        categoryOptions: [
          categoryOption(),
          categoryOption({
            leafCategoryId: '50000870',
            wholeCategoryName: '패션잡화>남성신발>기능화>바퀴운동화',
            blocked: true,
            blockReason: 'CON08_EXCLUDED',
          }),
          categoryOption({
            leafCategoryId: '50000860',
            wholeCategoryName: '패션잡화>남성신발>운동화>트레이닝화',
            blocked: true,
            blockReason: 'CHILD_CERTIFICATION',
          }),
        ],
      }),
    );
    const group = screen.getByRole('radiogroup', { name: '리프 카테고리' });
    expect(
      within(group).getByRole('radio', { name: '패션잡화 > 남성신발 > 운동화 > 러닝화' }),
    ).toBeEnabled();
    const wheeled = within(group).getByRole('radio', {
      name: '패션잡화 > 남성신발 > 기능화 > 바퀴운동화',
    });
    expect(wheeled).toBeDisabled();
    expect(wheeled).toHaveAccessibleDescription(
      '판매 제외 품목(바퀴 달린 운동화·고령자용 신발) 카테고리라 고를 수 없습니다.',
    );
    expect(
      within(group).getByRole('radio', { name: '패션잡화 > 남성신발 > 운동화 > 트레이닝화' }),
    ).toHaveAccessibleDescription('어린이 인증 카테고리라 고를 수 없습니다.');
    // 고르기 전: 단추 꺼짐 + 이유, 확인 줄은 '확인 전'
    expect(confirmButton()).toBeDisabled();
    expect(confirmButton()).toHaveAccessibleDescription('리프 카테고리를 골라 주세요.');
    expect(screen.getByText('성별·카테고리 확인 전')).toBeInTheDocument();
    expect(screen.getByText('아동 카테고리 확인 전')).toBeInTheDocument();
  });

  it('KC 후보를 고르면 체크 전에는 단추가 꺼지고, 체크하면 켜져 PUT 본문에 kcExemptAdultConfirmed: true', async () => {
    const api = stubApi({
      [`PUT /category-decisions/${DECISION_ID}/selection`]: () =>
        jsonResponse(
          categorySelectionResult({
            leafCategoryId: '50000831',
            exceptionDecision: 'KC_EXEMPT',
            kcExemptAdultConfirmedAt: '2026-09-28T05:07:00.000Z',
          }),
        ),
    });
    renderPanel();
    expect(screen.getByText('KC 확인 필요')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('radio', { name: '패션잡화 > 남성신발 > 운동화 > 워킹화' }),
    );
    expect(confirmButton()).toBeDisabled();
    expect(confirmButton()).toHaveAccessibleDescription(
      "KC 인증 예외 카테고리입니다. 'KC 면제 성인용 확인'을 체크해 주세요.",
    );
    expect(screen.getByText('성별·카테고리 일치')).toBeInTheDocument();
    expect(screen.getByText('아동 카테고리 아님')).toBeInTheDocument();
    const kc = screen.getByRole('checkbox', { name: 'KC 면제 성인용 확인' });
    expect(kc).toBeEnabled();
    await userEvent.click(kc);
    expect(screen.getByText('체크하면 KC 면제(해외 구매대행)로 채웁니다')).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
    await userEvent.click(confirmButton());
    await waitFor(() => expect(puts(api)).toHaveLength(1));
    expect(await puts(api)[0]!.json()).toEqual({
      leafCategoryId: '50000831',
      kcExemptAdultConfirmed: true,
    });
    expect(puts(api)[0]!.headers.get('X-AutoStore-Client')).toBe('1');
  });

  it('KC가 아닌 후보는 체크 칸이 꺼지고 본문의 확인 값은 false', async () => {
    const api = stubApi({
      [`PUT /category-decisions/${DECISION_ID}/selection`]: () =>
        jsonResponse(categorySelectionResult()),
    });
    renderPanel();
    await userEvent.click(
      screen.getByRole('radio', { name: '패션잡화 > 남성신발 > 운동화 > 러닝화' }),
    );
    expect(screen.getByRole('checkbox', { name: 'KC 면제 성인용 확인' })).toBeDisabled();
    expect(screen.getByText('KC 인증 예외가 없는 카테고리입니다')).toBeInTheDocument();
    await userEvent.click(confirmButton());
    await waitFor(() => expect(puts(api)).toHaveLength(1));
    expect(await puts(api)[0]!.json()).toEqual({
      leafCategoryId: '50000830',
      kcExemptAdultConfirmed: false,
    });
  });

  it.each([
    ['CATEGORY_CHILD_BLOCKED', '아동 카테고리는 고를 수 없습니다.'],
    ['CATEGORY_EXCLUDED_ITEM', '판매 제외 품목 카테고리입니다.'],
    ['CATEGORY_GENDER_MISMATCH', '여정 성별과 카테고리(남성·여성)가 맞지 않습니다.'],
    [
      'KC_EXEMPT_CONFIRMATION_REQUIRED',
      "KC 인증 예외 카테고리입니다. 'KC 면제 성인용 확인'을 체크해 주세요.",
    ],
  ])('409 %s → 05-3 문구를 막힘 띠(Banner blocked)로', async (code, message) => {
    stubApi({
      [`PUT /category-decisions/${DECISION_ID}/selection`]: () => errorResponse(409, code, message),
      'GET /candidates/1/category-decision': () => jsonResponse(categoryDecision()),
    });
    const view = renderPanel();
    await userEvent.click(
      screen.getByRole('radio', { name: '패션잡화 > 남성신발 > 운동화 > 러닝화' }),
    );
    await userEvent.click(confirmButton());
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(message);
    expect(view.container.querySelector('[class*="blocked"]')).not.toBeNull();
  });

  it('GENDER_PATH_ALL일 때만 "남성신발 전체 목록에서 고르기"가 보이고, 누르면 목록 전체(스크롤)를 연다', async () => {
    stubApi();
    const all = [
      categoryOption(),
      categoryOption({
        leafCategoryId: '50000832',
        wholeCategoryName: '패션잡화>남성신발>운동화>스니커즈',
      }),
    ];
    const { unmount } = renderPanel(
      categoryDecision({ candidateSource: 'GENDER_PATH_ALL', categoryOptions: all }),
    );
    const open = screen.getByRole('button', { name: '남성신발 전체 목록에서 고르기' });
    expect(screen.getByText('장르 없는 URL 여정용')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(open).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(open);
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    unmount();

    renderPanel(categoryDecision({ candidateSource: 'MAPPING' }));
    expect(screen.queryByRole('button', { name: /전체 목록에서 고르기/ })).toBeNull();
    expect(screen.queryByText('장르 없는 URL 여정용')).toBeNull();
  });

  it('완료된 결정: 고른 리프가 체크된 채 꺼지고, KC 면제면 보드 캡션·확인 줄 3개 통과', () => {
    stubApi();
    renderPanel(
      categoryDecision({
        stepStatus: 'COMPLETED',
        leafCategoryId: '50000831',
        wholeCategoryName: '패션잡화>남성신발>운동화>워킹화',
        genderPathMatch: true,
        exceptionDecision: 'KC_EXEMPT',
        kcExemptAdultConfirmedAt: '2026-09-28T05:07:00.000Z',
        decidedAt: '2026-09-28T05:07:00.000Z',
      }),
    );
    const picked = screen.getByRole('radio', { name: '패션잡화 > 남성신발 > 운동화 > 워킹화' });
    expect(picked).toBeChecked();
    expect(picked).toBeDisabled();
    const kc = screen.getByRole('checkbox', { name: 'KC 면제 성인용 확인' });
    expect(kc).toBeChecked();
    expect(kc).toBeDisabled();
    expect(screen.getByText('KC 면제(해외 구매대행)로 채웠습니다')).toBeInTheDocument();
    expect(screen.getByText('성별·카테고리 일치')).toBeInTheDocument();
    expect(screen.getByText('아동 카테고리 아님')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 카테고리로 확정' })).toBeNull();
  });
});
