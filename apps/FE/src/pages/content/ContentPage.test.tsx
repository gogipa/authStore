import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import { contentCopyOutput, contentFactOutput } from '@/test/fixtures/content';
import { candidateDetail, gateList, stepRail } from '@/test/fixtures/stepEngine';
import { renderRoute } from '@/test/renderRoute';

const CANDIDATE_ID = 1;

function setup() {
  return stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList(38)),
    [`GET /candidates/${CANDIDATE_ID}`]: () =>
      jsonResponse(
        candidateDetail({ id: CANDIDATE_ID, itemCode: 'shop-a:10000123', resumeStepCode: 'COPY' }),
      ),
    [`GET /candidates/${CANDIDATE_ID}/steps`]: () =>
      jsonResponse(
        stepRail({
          SOURCING: { status: 'COMPLETED' },
          COPY: { status: 'COMPLETED' },
          NOTICE_RAW: { status: 'COMPLETED' },
        }),
      ),
    [`GET /candidates/${CANDIDATE_ID}/gates`]: () => jsonResponse(gateList({ G2: true })),
    [`GET /candidates/${CANDIDATE_ID}/content-copy`]: () => jsonResponse(contentCopyOutput()),
    [`GET /candidates/${CANDIDATE_ID}/content-fact`]: () => jsonResponse(contentFactOutput()),
    [`POST /candidates/${CANDIDATE_ID}/steps/COPY/runs`]: () =>
      jsonResponse({ stepRunId: 300, candidateId: CANDIDATE_ID }, 202),
  });
}

describe('⑥ 상세 콘텐츠 화면(SCR-06, P3-03)', () => {
  it('자리표시 대신 ⑥ 상태 줄·세부 단계 이동·⑥-1 카피·⑥-2 원산지·소재·⑥-3 자리. 문구 검사(M2)는 없다', async () => {
    setup();
    renderRoute(`/candidates/${CANDIDATE_ID}/content`);
    await screen.findByRole('heading', { level: 1, name: '상세 콘텐츠' });
    expect(screen.getByRole('heading', { level: 2, name: '⑥ 상세 콘텐츠' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: '⑥-1 카피' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '⑥-2 원산지·소재' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '⑥-3 고시·HTML' })).toBeInTheDocument();
    expect(
      await screen.findByText('입력 출처: ② 소싱 산출물 · ③ 판매 사이즈 · 프로필'),
    ).toBeInTheDocument();
    expect(
      await screen.findByDisplayValue('뒤꿈치 GEL 쿠션, 크림/블랙 젤카야노 14'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '상세 콘텐츠 세부 단계' })).toBeInTheDocument();
    expect(screen.queryByText('문구 검사')).not.toBeInTheDocument();
    expect(screen.queryByText(/화면은 준비 중/)).not.toBeInTheDocument();
  });

  it("⑥ '다시 실행'은 ⑥-1부터 ⑥-3까지 이어서(throughStepCode=NOTICE_HTML) 부른다", async () => {
    const api = setup();
    renderRoute(`/candidates/${CANDIDATE_ID}/content`);
    await screen.findByRole('heading', { level: 2, name: '⑥-1 카피' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '다시 실행' }));
    await waitFor(() =>
      expect(api.requests.filter((r) => r.url.includes('/steps/COPY/runs'))).toHaveLength(1),
    );
    const req = api.requests.find((r) => r.url.includes('/steps/COPY/runs'))!;
    expect(await req.json()).toEqual({ throughStepCode: 'NOTICE_HTML' });
  });
});
