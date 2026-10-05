import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import { candidateDetail, disabled, ENABLED, gateList, stepRail } from '@/test/fixtures/stepEngine';
import { boardCandidates, competitorInput, tagCandidate, tagSetOutput } from '@/test/fixtures/tags';
import { renderRoute } from '@/test/renderRoute';

const CANDIDATE_ID = 1;

type TagsRail = NonNullable<NonNullable<Parameters<typeof stepRail>[0]>['TAGS']>;

/** `rail`: ⑦ 레일 칸을 덮어쓴다(기본 완료). `inputs`: 읽어 둔 경쟁 태그 입력(기본 1건) */
function setup(
  set = tagSetOutput(),
  {
    rail = {},
    inputs = [competitorInput({ id: 31 })],
  }: { rail?: TagsRail; inputs?: ReturnType<typeof competitorInput>[] } = {},
) {
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
          TAGS: { status: 'COMPLETED', currentStepRunId: set.stepRunId, ...rail },
        }),
      ),
    [`GET /candidates/${CANDIDATE_ID}/gates`]: () => jsonResponse(gateList({ G2: true })),
    [`GET /candidates/${CANDIDATE_ID}/tag-set`]: () => jsonResponse(set),
    [`GET /candidates/${CANDIDATE_ID}/tag-competitor-inputs`]: () =>
      jsonResponse({ items: inputs }),
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

describe('⑦ 맨 위 안내(D-41): 하는 일 · 지금 할 일 · 낯선 말 풀이', () => {
  it('하는 일 한 문장과 지금 할 일(최종 태그 수)이 보이고, 풀이는 접혀 있다가 펼치면 용어가 나온다', async () => {
    setup();
    renderRoute(`/candidates/${CANDIDATE_ID}/tags`, { demo: true });
    const intro = within(await screen.findByRole('region', { name: '⑦ 태그 안내' }));
    expect(
      intro.getByText(
        '추천 태그(네이버가 알려 주는 태그)와 경쟁 태그(경쟁 상품에 달린 태그)를 모아, 상품에 붙일 검색 태그를 최대 10개 고르는 단계입니다.',
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(intro.getByRole('status')).toHaveTextContent(
        /^지금 할 일 최종 태그 10개가 정해졌습니다\. 빼거나 더할 태그가 있으면 고치고, 괜찮으면 \[다음: 최종 승인\]을 누르세요\./,
      ),
    );
    expect(intro.queryByText(/\{count\}/)).toBeNull();
    // 다음 화면으로 가는 길은 '최종 태그' 패널의 버튼 하나뿐이다(안내 쪽에 같은 이름의 링크를 더하지 않는다)
    expect(screen.getAllByRole('link', { name: /최종 승인/ })).toHaveLength(1);

    const toggle = intro.getByRole('button', { name: /펼치기/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const term of [
      "'카테고리 미확정' 표시",
      '시드 키워드',
      '실행 · 다시 실행',
      '여기부터 연속 실행',
      '최종 태그 · 태그 추가',
      '후보 태그',
      '경쟁 태그(manu태그)',
      '경쟁 태그 넣는 방법',
      '뺀 태그와 사유 · 제한 태그',
    ]) {
      expect(intro.getByText(term)).toBeVisible();
    }
  });

  it.each([
    [
      '미실행·경쟁 태그 없음',
      { status: 'NOT_RUN' as const, currentStepRunId: null },
      [],
      /^지금 할 일 \[실행\]을 누르세요\. 추천 태그로 최종 태그를 고릅니다\. 경쟁 태그가 있으면 \[실행\] 전에 아래 '경쟁 태그 입력'에 넣어 두세요\./,
    ],
    [
      '미실행·경쟁 태그 있음',
      { status: 'NOT_RUN' as const, currentStepRunId: null },
      [competitorInput({ id: 31 })],
      /^지금 할 일 \[실행\]을 누르세요\. 읽어 둔 경쟁 태그와 추천 태그를 합쳐 최종 태그를 고릅니다\./,
    ],
  ])(
    '%s: 실행할 차례 — 글이 갈리고 [실행] 자리에만 표시가 붙는다',
    async (_name, rail, inputs, text) => {
      setup(tagSetOutput(), { rail, inputs });
      renderRoute(`/candidates/${CANDIDATE_ID}/tags`, { demo: true });
      const intro = within(await screen.findByRole('region', { name: '⑦ 태그 안내' }));
      await waitFor(() => expect(intro.getByRole('status')).toHaveTextContent(text));
      const marks = await screen.findAllByText('지금 여기');
      expect(marks).toHaveLength(1);
      const holder = marks[0]!.parentElement!;
      expect(within(holder).getByRole('button', { name: '실행' })).toBeInTheDocument();
      expect(within(holder).queryByRole('list')).toBeNull();
    },
  );

  it('재실행 필요·실패는 [다시 실행] 자리에 표시가 붙는다', async () => {
    setup(tagSetOutput(), { rail: { status: 'RERUN_REQUIRED' } });
    const first = renderRoute(`/candidates/${CANDIDATE_ID}/tags`, { demo: true });
    let intro = within(await screen.findByRole('region', { name: '⑦ 태그 안내' }));
    await waitFor(() =>
      expect(intro.getByRole('status')).toHaveTextContent(
        /^지금 할 일 앞 단계 결과나 입력이 바뀌었습니다\. \[다시 실행\]을 눌러 최신 내용으로 다시 고르세요\. 직접 더하거나 뺀 태그는 그대로 남습니다\./,
      ),
    );
    let marks = await screen.findAllByText('지금 여기');
    expect(marks).toHaveLength(1);
    expect(
      within(marks[0]!.parentElement!).getByRole('button', { name: '다시 실행' }),
    ).toBeInTheDocument();
    first.unmount();

    setup(tagSetOutput(), { rail: { status: 'FAILED' } });
    renderRoute(`/candidates/${CANDIDATE_ID}/tags`, { demo: true });
    intro = within(await screen.findByRole('region', { name: '⑦ 태그 안내' }));
    await waitFor(() =>
      expect(intro.getByRole('status')).toHaveTextContent(
        /^지금 할 일 실행하지 못했습니다\. 아래 오류를 확인하고 \[다시 실행\]을 누르세요\./,
      ),
    );
    marks = await screen.findAllByText('지금 여기');
    expect(marks).toHaveLength(1);
    expect(
      within(marks[0]!.parentElement!).getByRole('button', { name: '다시 실행' }),
    ).toBeInTheDocument();
  });

  it('[실행]이 서버 이유로 꺼져 있으면 그 이유를 읽으라고 말하고 표시는 [실행] 자리에 붙는다', async () => {
    const WHY = '② 소싱이 완료가 아닙니다.';
    setup(tagSetOutput(), {
      rail: {
        status: 'NOT_RUN',
        currentStepRunId: null,
        actions: {
          run: disabled('STEP_START_CONDITION_UNMET', WHY),
          continuousRun: ENABLED,
          edit: disabled('INVALID_STEP_CODE', '이 단계는 값을 직접 고칠 수 없습니다.'),
        },
      },
    });
    renderRoute(`/candidates/${CANDIDATE_ID}/tags`, { demo: true });
    const intro = within(await screen.findByRole('region', { name: '⑦ 태그 안내' }));
    await waitFor(() =>
      expect(intro.getByRole('status')).toHaveTextContent(
        /^지금 할 일 \[실행\] 또는 \[다시 실행\]이 꺼져 있습니다\. 그 아래에 적힌 이유를 읽고 먼저 그 일을 끝내세요\./,
      ),
    );
    // 서버 이유는 [실행] 아래에 그대로 보인다
    expect(await screen.findByText(WHY)).toBeInTheDocument();
    const marks = await screen.findAllByText('지금 여기');
    expect(marks).toHaveLength(1);
    expect(within(marks[0]!.parentElement!).getByRole('button', { name: '실행' })).toBeDisabled();
  });

  it('실행 중에는 기다리라고 말하고 표시는 없다', async () => {
    setup(tagSetOutput(), { rail: { status: 'RUNNING', currentStepRunId: 121 } });
    renderRoute(`/candidates/${CANDIDATE_ID}/tags`, { demo: true });
    const intro = within(await screen.findByRole('region', { name: '⑦ 태그 안내' }));
    await waitFor(() =>
      expect(intro.getByRole('status')).toHaveTextContent(
        /^지금 할 일 태그를 고르는 중입니다\. 끝날 때까지 경쟁 태그를 넣거나 최종 태그를 고칠 수 없으니 잠시 기다려 주세요\./,
      ),
    );
    expect(screen.queryByText('지금 여기')).toBeNull();
  });

  it("최종 태그를 확인할 차례에는 표시가 '최종 태그' 패널에 붙는다(완료)", async () => {
    setup();
    renderRoute(`/candidates/${CANDIDATE_ID}/tags`, { demo: true });
    await screen.findByRole('list', { name: '최종 태그 10개' });
    const marks = await screen.findAllByText('지금 여기');
    expect(marks).toHaveLength(1);
    const holder = marks[0]!.parentElement!;
    expect(within(holder).getByRole('list', { name: '최종 태그 10개' })).toBeInTheDocument();
    expect(within(holder).getByRole('link', { name: '다음: 최종 승인' })).toBeInTheDocument();
    // 위쪽 [다시 실행]과 경쟁 태그 입력에는 붙지 않는다
    expect(within(holder).queryByRole('button', { name: '다시 실행' })).toBeNull();
    expect(within(holder).queryByRole('heading', { name: '경쟁 태그 입력' })).toBeNull();
  });

  it('완료인데 최종 태그가 하나도 없으면 넣으라고 말하고 표시는 같은 패널에 붙는다', async () => {
    setup(tagSetOutput({ candidates: [], finalTags: [] }));
    renderRoute(`/candidates/${CANDIDATE_ID}/tags`, { demo: true });
    const intro = within(await screen.findByRole('region', { name: '⑦ 태그 안내' }));
    await waitFor(() =>
      expect(intro.getByRole('status')).toHaveTextContent(
        /^지금 할 일 최종 태그가 하나도 없습니다\. 아래 '경쟁 태그 입력'에 경쟁 태그를 넣고 \[다시 실행\]하거나, '태그 추가'로 직접 넣으세요\./,
      ),
    );
    const marks = await screen.findAllByText('지금 여기');
    expect(marks).toHaveLength(1);
    expect(
      within(marks[0]!.parentElement!).getByRole('heading', { name: '최종 태그' }),
    ).toBeInTheDocument();
  });
});
