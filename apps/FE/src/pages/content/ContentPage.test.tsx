import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CONTENT_GUIDE, fillText } from '@/features/guide';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import {
  contentAssemblyOutput,
  contentCopyOutput,
  contentField,
  contentFactOutput,
  factFields,
} from '@/test/fixtures/content';
import { emptyProfile, filledProfile } from '@/test/fixtures/purchaseAgencyProfile';
import { candidateDetail, disabled, gateList, stepRail } from '@/test/fixtures/stepEngine';
import { renderRoute } from '@/test/renderRoute';

const CANDIDATE_ID = 1;

function setup(noticeHtml: 'NOT_RUN' | 'COMPLETED' = 'NOT_RUN') {
  return stubApi({
    'GET /purchase-agency-profile': () => jsonResponse(filledProfile()),
    [`GET /candidates/${CANDIDATE_ID}/content-assembly`]: () =>
      jsonResponse(contentAssemblyOutput()),
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
          NOTICE_HTML: { status: noticeHtml },
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

  it('⑥-3이 끝났으면 조립 결과(상품명·고시·고지)와 HTML 미리보기(iframe sandbox)를 보인다(P3-04)', async () => {
    setup('COMPLETED');
    renderRoute(`/candidates/${CANDIDATE_ID}/content`);
    expect(
      await screen.findByDisplayValue('아식스 젤카야노14 1201A019-108 러닝화 크림 남성'),
    ).toBeInTheDocument();
    expect(screen.getByText('상품정보제공고시 · 신발')).toBeInTheDocument();
    expect(screen.getByText('구매대행 고지 미리보기')).toBeInTheDocument();
    const frame = screen.getByTitle('상세페이지 미리보기');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame).toHaveAttribute(
      'src',
      '/api/v1/candidates/1/content-assembly/preview?stepRunId=106',
    );
    expect(screen.queryByText('문구 검사')).not.toBeInTheDocument();
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

type RailPatch = NonNullable<Parameters<typeof stepRail>[0]>;

/** 단계 레일만 바꿔 ⑥의 상태를 만든다(②는 늘 완료) */
function setupRail(rail: RailPatch) {
  const api = setup();
  api.on(`GET /candidates/${CANDIDATE_ID}/steps`, () =>
    jsonResponse(stepRail({ SOURCING: { status: 'COMPLETED' }, ...rail })),
  );
  return api;
}

const GUIDE_REGION = '⑥ 상세 콘텐츠 안내';
const NOW_MARK = '지금 여기';

/** 안내 판을 열고, 지금 할 일 줄에 글이 나올 때까지 기다린다 */
async function nowText(text: string) {
  const intro = within(await screen.findByRole('region', { name: GUIDE_REGION }));
  await waitFor(() => expect(intro.getByRole('status')).toHaveTextContent(text));
  return intro;
}

/** '지금 여기' 표시가 붙은 칸(표시는 하나뿐이어야 한다) */
async function markedHolder() {
  const marks = await screen.findAllByText(NOW_MARK);
  expect(marks).toHaveLength(1);
  return within(marks[0]!.parentElement!);
}

describe('⑥ 맨 위 안내(D-41): 하는 일 · 지금 할 일 · 낯선 말 풀이', () => {
  it("끝났으면 하는 일 한 문장과 끝났다는 글이 보이고 '지금 여기'는 [다음: ⑦ 태그]에 붙는다. ⑥ 영역 이름은 그대로다", async () => {
    setup('COMPLETED');
    renderRoute(`/candidates/${CANDIDATE_ID}/content`, { demo: true });
    const intro = await nowText(CONTENT_GUIDE.now.done);
    expect(intro.getByText(CONTENT_GUIDE.purpose)).toBeInTheDocument();
    // 맨 위에는 이동 링크를 두지 않고, 구획 이동 줄의 [다음: ⑦ 태그]에만 '지금 여기'가 붙는다(D-42)
    expect(intro.queryByRole('link')).toBeNull();
    const marks = screen.getAllByText(NOW_MARK);
    expect(marks).toHaveLength(1);
    expect(
      within(marks[0]!.parentElement!).getByRole('link', { name: '다음: ⑦ 태그' }),
    ).toHaveAttribute('href', `/candidates/${CANDIDATE_ID}/tags`);
    // 체험 안내·e2e가 영역 이름으로 ⑥을 찾는다 — 안내 영역이 생겨도 '⑥ 상세 콘텐츠'는 하나뿐이다
    const region = screen.getByRole('region', { name: '⑥ 상세 콘텐츠' });
    expect(within(region).getByRole('button', { name: '여기부터 연속 실행' })).toBeInTheDocument();
    expect(within(region).queryByRole('status')).toBeNull();
  });

  it('풀이는 접혀 있다가 펼치면 용어가 나오고, 채우지 못한 자리({…})나 앵커라는 말이 없다', async () => {
    setup('COMPLETED');
    renderRoute(`/candidates/${CANDIDATE_ID}/content`, { demo: true });
    const intro = await nowText(CONTENT_GUIDE.now.done);
    const toggle = intro.getByRole('button', { name: /펼치기/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const entry of Object.values(CONTENT_GUIDE.glossary)) {
      expect(intro.getByText(entry.term)).toBeVisible();
    }
    expect(intro.queryByText(/\{|\}/)).toBeNull();
    expect(intro.queryByText(/앵커/)).toBeNull();
    expect(intro.getByText(/⑥에서 가장 쓸모 있는 버튼입니다/)).toBeVisible();
  });

  it("아무것도 안 했으면 [실행]과 [여기부터 연속 실행]에 '지금 여기'가 붙는다", async () => {
    setupRail({ COPY: {}, NOTICE_RAW: {}, NOTICE_HTML: {} });
    renderRoute(`/candidates/${CANDIDATE_ID}/content`, { demo: true });
    await nowText(CONTENT_GUIDE.now.start);
    const holder = await markedHolder();
    expect(holder.getByRole('button', { name: '실행' })).toBeInTheDocument();
    expect(holder.getByRole('button', { name: '여기부터 연속 실행' })).toBeInTheDocument();
    expect(holder.queryByRole('heading')).toBeNull();
  });

  it('맨 위 실행이 꺼져 있으면 이유를 먼저 해결하라고 하고 표시는 그 버튼에 붙는다', async () => {
    const off = disabled('PREREQUISITE_NOT_MET', '② 소싱을 먼저 마쳐야 합니다.');
    const edit = disabled('INVALID_STEP_CODE', '이 단계는 값을 직접 고칠 수 없습니다.');
    setupRail({
      COPY: { actions: { run: off, continuousRun: off, edit } },
      NOTICE_RAW: {},
      NOTICE_HTML: {},
    });
    renderRoute(`/candidates/${CANDIDATE_ID}/content`, { demo: true });
    await nowText(CONTENT_GUIDE.now.blocked);
    const holder = await markedHolder();
    expect(holder.getByRole('button', { name: '실행' })).toBeDisabled();
    // 꺼진 이유 글은 서버 글 그대로 화면에 있다
    expect((await screen.findAllByText('② 소싱을 먼저 마쳐야 합니다.')).length).toBeGreaterThan(0);
  });

  it("⑥-1이 끝나고 ⑥-2가 비었으면 ⑥-2 구획에만 '지금 여기'가 붙고, 글 속 버튼 이름이 화면의 버튼과 같다", async () => {
    setupRail({ NOTICE_RAW: {}, NOTICE_HTML: {}, COPY: { status: 'COMPLETED' } });
    renderRoute(`/candidates/${CANDIDATE_ID}/content`, { demo: true });
    await nowText(fillText(CONTENT_GUIDE.now.runStep, { step: '⑥-2' }));
    expect(screen.queryByText(/\{step\}/)).toBeNull();
    const holder = await markedHolder();
    expect(holder.getByRole('heading', { name: '⑥-2 원산지·소재' })).toBeInTheDocument();
    expect(holder.getByRole('button', { name: '⑥-2 실행' })).toBeInTheDocument();
    expect(holder.queryByRole('heading', { name: '⑥-1 카피' })).toBeNull();
    expect(holder.queryByRole('heading', { name: '⑥-3 고시·HTML' })).toBeNull();
  });

  it('원산지를 못 정해 ⑥-2가 입력 대기이면 원산지 직접 넣기 자리를 가리킨다', async () => {
    const api = setupRail({
      COPY: { status: 'COMPLETED' },
      NOTICE_RAW: { status: 'WAITING_INPUT' },
      NOTICE_HTML: {},
    });
    api.on(`GET /candidates/${CANDIDATE_ID}/content-fact`, () =>
      jsonResponse(contentFactOutput({ stepRunStatus: 'WAITING_INPUT' })),
    );
    renderRoute(`/candidates/${CANDIDATE_ID}/content`, { demo: true });
    await nowText(CONTENT_GUIDE.now.originInput);
    const holder = await markedHolder();
    expect(holder.getByRole('heading', { name: '⑥-2 원산지·소재' })).toBeInTheDocument();
    expect(await holder.findByText('직접 넣기')).toBeInTheDocument();
    expect(
      holder.getByRole('button', { name: '원산지를 근거 URL과 함께 직접 넣기' }),
    ).toBeEnabled();
  });

  it("⑥-1이 재실행 필요이면 [그대로 유지]까지 알리고 ⑥-1 구획에 '지금 여기'가 붙는다", async () => {
    const api = setupRail({
      COPY: { status: 'RERUN_REQUIRED' },
      NOTICE_RAW: { status: 'COMPLETED' },
      NOTICE_HTML: { status: 'COMPLETED' },
    });
    api.on(`GET /candidates/${CANDIDATE_ID}/content-copy`, () =>
      jsonResponse(contentCopyOutput({ stepRunStatus: 'RERUN_REQUIRED', keepAsIsAllowed: true })),
    );
    renderRoute(`/candidates/${CANDIDATE_ID}/content`, { demo: true });
    await nowText(CONTENT_GUIDE.now.rerunCopy);
    const holder = await markedHolder();
    expect(holder.getByRole('heading', { name: '⑥-1 카피' })).toBeInTheDocument();
    expect(holder.getByRole('button', { name: '⑥-1 다시 실행' })).toBeInTheDocument();
    expect(await holder.findByRole('button', { name: '그대로 유지' })).toBeEnabled();
  });

  it('다시 실행한 카피가 직접 고친 값과 다르면 고르라고 하고 ⑥-1 구획을 가리킨다', async () => {
    const api = setupRail({
      COPY: { status: 'COMPLETED' },
      NOTICE_RAW: { status: 'COMPLETED' },
      NOTICE_HTML: { status: 'COMPLETED' },
    });
    api.on(`GET /candidates/${CANDIDATE_ID}/content-copy`, () =>
      jsonResponse(
        contentCopyOutput({
          fields: [
            contentField({
              fieldKey: 'copy.headline',
              value: '직접 고친 헤드라인',
              generatedValue: '새 헤드라인',
              valueSource: 'OWNER_INPUT',
              choicePending: true,
            }),
          ],
        }),
      ),
    );
    renderRoute(`/candidates/${CANDIDATE_ID}/content`, { demo: true });
    await nowText(CONTENT_GUIDE.now.chooseCopy);
    const holder = await markedHolder();
    expect(holder.getByRole('heading', { name: '⑥-1 카피' })).toBeInTheDocument();
    expect(holder.getByRole('button', { name: '직접 고친 값 유지' })).toBeInTheDocument();
    expect(holder.getByRole('button', { name: '새 결과로 바꾸기' })).toBeInTheDocument();
  });

  it("'재확인 필요' 줄이 있으면 [현재 근거로 확인]이 있는 구획을 가리킨다", async () => {
    setupRail({
      COPY: { status: 'COMPLETED' },
      NOTICE_RAW: { status: 'COMPLETED' },
      NOTICE_HTML: { status: 'COMPLETED' },
    }).on(`GET /candidates/${CANDIDATE_ID}/content-fact`, () =>
      jsonResponse(
        contentFactOutput({
          fields: factFields().map((field) =>
            field.fieldKey === 'fact.origin' ? { ...field, recheckRequired: true } : field,
          ),
        }),
      ),
    );
    renderRoute(`/candidates/${CANDIDATE_ID}/content`, { demo: true });
    await nowText(fillText(CONTENT_GUIDE.now.recheckStep, { step: '⑥-2' }));
    const holder = await markedHolder();
    expect(holder.getByRole('heading', { name: '⑥-2 원산지·소재' })).toBeInTheDocument();
    expect(await holder.findByRole('button', { name: '현재 근거로 확인' })).toBeInTheDocument();
  });

  it('구매대행 프로필에 빈칸이 있고 ⑥-3이 비었으면 ⑥-3 구획의 프로필 채우기를 가리킨다', async () => {
    const api = setupRail({
      COPY: { status: 'COMPLETED' },
      NOTICE_RAW: { status: 'COMPLETED' },
      NOTICE_HTML: {},
    });
    api.on('GET /purchase-agency-profile', () => jsonResponse(emptyProfile()));
    renderRoute(`/candidates/${CANDIDATE_ID}/content`, { demo: true });
    await nowText(CONTENT_GUIDE.now.fillProfile);
    const holder = await markedHolder();
    expect(holder.getByRole('heading', { name: '⑥-3 고시·HTML' })).toBeInTheDocument();
    expect(await holder.findByRole('link', { name: '설정에서 프로필 채우기' })).toBeInTheDocument();
  });

  it('⑥-3이 실패했으면 그 구획 다시 실행을 안내한다', async () => {
    setupRail({
      COPY: { status: 'COMPLETED' },
      NOTICE_RAW: { status: 'COMPLETED' },
      NOTICE_HTML: { status: 'FAILED' },
    });
    renderRoute(`/candidates/${CANDIDATE_ID}/content`, { demo: true });
    await nowText(fillText(CONTENT_GUIDE.now.failedStep, { step: '⑥-3' }));
    const holder = await markedHolder();
    expect(holder.getByRole('button', { name: '⑥-3 다시 실행' })).toBeInTheDocument();
  });

  it("실행 중이면 기다리라고만 하고 '지금 여기'는 붙지 않는다", async () => {
    setupRail({
      COPY: { status: 'COMPLETED' },
      NOTICE_RAW: { status: 'RUNNING' },
      NOTICE_HTML: {},
    });
    renderRoute(`/candidates/${CANDIDATE_ID}/content`, { demo: true });
    await nowText(CONTENT_GUIDE.now.running);
    expect(screen.queryByText(NOW_MARK)).toBeNull();
  });
});
