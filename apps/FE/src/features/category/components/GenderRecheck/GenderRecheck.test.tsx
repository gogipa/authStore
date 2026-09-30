import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { createTestQueryClient } from '@/test/renderRoute';
import { categoryKeys } from '../../api/queryKeys';
import { GenderRecheck } from './GenderRecheck';

function renderRecheck(disabledReason: string | null = null) {
  const queryClient = createTestQueryClient();
  // 이미 읽어 둔 결정 쿼리(성별을 바꾸면 다시 읽어야 한다)
  queryClient.setQueryData(categoryKeys.decision(1), { id: 21 });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <GenderRecheck
        candidateId={1}
        gender="MALE"
        genderSource="STEP2"
        disabledReason={disabledReason}
      />
    </QueryClientProvider>,
  );
  return { queryClient, ...view };
}

describe('GenderRecheck(SCR-04 ④ 성별 재확인, F-CA-05, P2-06)', () => {
  it('보드 문구: 라벨·출처 ② 자동 판단·안내 글', () => {
    stubApi();
    renderRecheck();
    expect(screen.getByRole('radiogroup', { name: '성별 재확인' })).toBeInTheDocument();
    expect(screen.getByText('출처 ② 자동 판단')).toBeInTheDocument();
    expect(
      screen.getByText('바꾸면 카테고리 후보를 다시 뽑고 ③·⑥-3·⑦을 다시 실행해야 합니다.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '남성' })).toBeChecked();
  });

  it('여성을 고르면 PUT /candidates/1/gender를 부르고 ④ 결정 쿼리를 다시 읽는다', async () => {
    const api = stubApi({
      'PUT /candidates/1/gender': () =>
        jsonResponse({
          candidateId: 1,
          gender: 'FEMALE',
          genderSource: 'OWNER',
          genderRecheckRequired: false,
          changed: true,
          affectedSteps: ['PRICING'],
          resumedStepRunIds: [120],
        }),
    });
    const { queryClient } = renderRecheck();
    await userEvent.click(screen.getByRole('radio', { name: '여성' }));
    const puts = () =>
      api.requests.filter(
        (r) => r.method === 'PUT' && new URL(r.url).pathname === '/api/v1/candidates/1/gender',
      );
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(await puts()[0]!.json()).toEqual({ gender: 'FEMALE' });
    await waitFor(() =>
      expect(queryClient.getQueryState(categoryKeys.decision(1))?.isInvalidated).toBe(true),
    );
  });

  it('④ 입력 대기가 아니면 라디오를 끄고 이유를 보인다(요청 없음)', async () => {
    const api = stubApi();
    renderRecheck('④가 입력 대기일 때 바꿀 수 있습니다. ④를 다시 실행한 뒤 바꿔 주세요.');
    const female = screen.getByRole('radio', { name: '여성' });
    expect(female).toBeDisabled();
    expect(
      screen.getByText('④가 입력 대기일 때 바꿀 수 있습니다. ④를 다시 실행한 뒤 바꿔 주세요.'),
    ).toBeInTheDocument();
    await userEvent.click(female);
    expect(api.requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
  });
});
