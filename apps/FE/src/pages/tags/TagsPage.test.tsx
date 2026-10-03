import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import { candidateDetail, gateList, stepRail } from '@/test/fixtures/stepEngine';
import { boardCandidates, competitorInput, tagCandidate, tagSetOutput } from '@/test/fixtures/tags';
import { renderRoute } from '@/test/renderRoute';

const CANDIDATE_ID = 1;

function setup(set = tagSetOutput()) {
  return stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList(38)),
    [`GET /candidates/${CANDIDATE_ID}`]: () =>
      jsonResponse(
        candidateDetail({
          id: CANDIDATE_ID,
          resumeStepCode: 'TAGS',
          leafCategoryId: '50000830',
          wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
        }),
      ),
    [`GET /candidates/${CANDIDATE_ID}/steps`]: () =>
      jsonResponse(
        stepRail({
          SOURCING: { status: 'COMPLETED' },
          CATEGORY: { status: 'COMPLETED' },
          TAGS: { status: 'COMPLETED', currentStepRunId: set.stepRunId },
        }),
      ),
    [`GET /candidates/${CANDIDATE_ID}/gates`]: () => jsonResponse(gateList({ G2: true })),
    [`GET /candidates/${CANDIDATE_ID}/tag-set`]: () => jsonResponse(set),
    [`GET /candidates/${CANDIDATE_ID}/tag-competitor-inputs`]: () =>
      jsonResponse({ items: [competitorInput({ id: 31 })] }),
    [`POST /candidates/${CANDIDATE_ID}/steps/TAGS/owner-edits`]: () =>
      jsonResponse({ stepRunId: 121, candidateId: CANDIDATE_ID, status: 'RUNNING' }, 202),
  });
}

describe('⑦ 태그 화면(SCR-07, P3-05)', () => {
  it('최종 태그 10/10이면 추가가 꺼지고 보드 문구가 보인다. 사전 미등록 칩', async () => {
    setup();
    renderRoute(`/candidates/${CANDIDATE_ID}/tags`);
    await screen.findByRole('heading', { level: 1, name: '태그' });
    expect(screen.getByRole('heading', { level: 2, name: '⑦ 태그' })).toBeInTheDocument();
    expect(screen.queryByText('SCR-07')).not.toBeInTheDocument(); // 화면 ID 칩 없음(D-27)
    const list = await screen.findByRole('list', { name: '최종 태그 10개' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText('10/10')).toBeInTheDocument();
    expect(screen.getByText('10개가 다 찼습니다. 하나를 지운 뒤 넣어 주세요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '추가' })).toBeDisabled();
    expect(within(list).getByText('사전 미등록')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '다음: 최종 승인' })).toHaveAttribute(
      'href',
      `/candidates/${CANDIDATE_ID}/approval`,
    );
    expect(
      await screen.findByText("입력 출처: 시드 키워드 '아식스 젤카야노14' · 경쟁 태그 셀라파인더"),
    ).toBeInTheDocument();
  });

  it("뺀 태그와 사유가 보이고, 후보 표에 '점수' 열이 없다(M2)", async () => {
    setup();
    renderRoute(`/candidates/${CANDIDATE_ID}/tags`);
    const excluded = await screen.findByRole('list', { name: '뺀 태그와 사유' });
    expect(within(excluded).getAllByRole('listitem')).toHaveLength(5);
    expect(within(excluded).getByText('다른 브랜드명(나이키)')).toBeInTheDocument();
    expect(within(excluded).getByText('제한 태그 · 네이버 확인')).toBeInTheDocument();
    expect(within(excluded).getByText('카테고리 이름(러닝화)과 같음')).toBeInTheDocument();
    expect(within(excluded).getByText('경쟁 11')).toBeInTheDocument();
    expect(screen.getByText('규칙 사전 판정 · AI 판정 꺼짐')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: '후보 태그' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toEqual(['순서', '태그', '출처', '빈도', '상태']);
    expect(headers).not.toContain('점수');
    expect(
      screen.getByText(
        '선정 순서: 추천과 같은 경쟁 태그 → 나머지 경쟁 태그 → 추천 태그 · 최대 10개',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/카테고리 러닝화 기준 필터/)).toBeInTheDocument();
    // 거르기: 뺌 5
    await userEvent.click(screen.getByRole('button', { name: /뺌/ }));
    expect(within(table).getAllByRole('row')).toHaveLength(6);
  });

  it('9개면 태그를 더할 수 있고 owner-edits TAGS EDIT(add)를 보낸다. 삭제 버튼은 remove를 보낸다', async () => {
    const candidates = boardCandidates().map((c) =>
      c.text === '커플운동화' ? { ...c, outcome: 'NOT_SELECTED' as const, finalOrder: null } : c,
    );
    const stub = setup(tagSetOutput({ candidates }));
    renderRoute(`/candidates/${CANDIDATE_ID}/tags`);
    await screen.findByRole('list', { name: '최종 태그 9개' });
    await userEvent.type(screen.getByLabelText('태그 추가'), '나만의태그');
    const add = screen.getByRole('button', { name: '추가' });
    expect(add).toBeEnabled();
    await userEvent.click(add);
    await waitFor(() =>
      expect(stub.requests.some((r) => r.url.endsWith('/steps/TAGS/owner-edits'))).toBe(true),
    );
    const sent = stub.requests.find((r) => r.url.endsWith('/steps/TAGS/owner-edits'))!;
    expect(await sent.clone().json()).toEqual({
      ownerAction: 'EDIT',
      baseStepRunId: 120,
      add: ['나만의태그'],
      remove: [],
    });

    await userEvent.click(screen.getByRole('button', { name: '조깅화 태그 삭제' }));
    await waitFor(() =>
      expect(stub.requests.filter((r) => r.url.endsWith('/steps/TAGS/owner-edits'))).toHaveLength(
        2,
      ),
    );
    const removed = stub.requests.filter((r) => r.url.endsWith('/steps/TAGS/owner-edits'))[1]!;
    expect(await removed.clone().json()).toMatchObject({ add: [], remove: ['조깅화'] });
  });

  it("④ 전에 뽑은 버전이면 '카테고리 미확정' 칩", async () => {
    setup(
      tagSetOutput({
        leafCategoryId: null,
        candidates: [tagCandidate({ text: '조깅화', outcome: 'SELECTED', finalOrder: 1 })],
      }),
    );
    renderRoute(`/candidates/${CANDIDATE_ID}/tags`);
    expect(await screen.findByText('카테고리 미확정')).toBeInTheDocument();
    expect(screen.getByText(/카테고리 미확정 · 카테고리 필터 없이 뽑음/)).toBeInTheDocument();
  });
});
