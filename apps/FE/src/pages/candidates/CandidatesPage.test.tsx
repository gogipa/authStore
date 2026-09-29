import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import {
  candidateDetail,
  candidateSummary,
  page,
  requiredDone,
  statusCounts,
  stepBriefs,
} from '@/test/fixtures/stepEngine';
import { renderRoute } from '@/test/renderRoute';

const NB530 = 13;
const CORTEZ = 16;

function list() {
  return page([
    candidateSummary({
      id: 12,
      status: 'AWAITING_APPROVAL',
      displayName: '아식스 젤카야노 14 · 크림/블랙',
      steps: requiredDone(),
      resumeStepCode: 'REGISTER',
    }),
    candidateSummary({
      id: NB530,
      displayName: '뉴발란스 530 · 화이트/실버',
      steps: stepBriefs({ SOURCING: 'COMPLETED', PRICING: 'WAITING_INPUT' }),
      resumeStepCode: 'PRICING',
    }),
    candidateSummary({
      id: CORTEZ,
      creationPath: 'RAKUTEN_URL',
      rakutenQuery: null,
      displayName: '나이키 코르테즈 · 화이트/레드',
      steps: stepBriefs({ SOURCING: 'COMPLETED' }),
      resumeStepCode: 'PRICING',
    }),
  ]);
}

function stubCandidates() {
  let detail = candidateDetail({ id: NB530 });
  const api = stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList()),
    'GET /candidates/status-counts': () =>
      jsonResponse(statusCounts({ WORKING: 5, AWAITING_APPROVAL: 2, EXCLUDED: 0, REGISTERED: 4 })),
    'GET /candidates': () => jsonResponse(list()),
    [`GET /candidates/${NB530}`]: () => jsonResponse(detail),
    [`POST /candidates/${NB530}/exclude`]: () => {
      detail = { ...detail, status: 'EXCLUDED', excludedReason: 'OWNER_EXCLUDED' };
      return jsonResponse({
        candidateId: NB530,
        status: 'EXCLUDED',
        excludedReason: 'OWNER_EXCLUDED',
        statusChangedAt: '2026-09-28T05:10:00.000Z',
        history: {
          id: 9,
          candidateId: NB530,
          fromStatus: 'WORKING',
          toStatus: 'EXCLUDED',
          reason: 'OWNER_EXCLUDED',
          stepRunId: null,
          gatePassId: null,
          registrationId: null,
          changedAt: '2026-09-28T05:10:00.000Z',
        },
        warnings: [],
      });
    },
  });
  return api;
}

const count = (api: ReturnType<typeof stubApi>, key: string) =>
  api.requests.filter(
    (r) => `${r.method} ${new URL(r.url).pathname.replace(/^\/api\/v1/, '')}` === key,
  ).length;

async function renderCandidates(path = '/candidates') {
  const view = renderRoute(path);
  await screen.findByRole('heading', { level: 1, name: '후보 작업' });
  return view;
}

describe('후보 작업 목록(SCR-12, P1-04)', () => {
  it('필터 수 배지: 전체(진행 중) 7 · 작업중 5 · 승인대기 2 · 제외 0', async () => {
    stubCandidates();
    await renderCandidates();
    const group = within(screen.getByRole('group', { name: '후보 거르기' }));
    await group.findByRole('button', { name: '전체 7' });
    expect(group.getByRole('button', { name: '작업중 5' })).toBeInTheDocument();
    expect(group.getByRole('button', { name: '승인대기 2' })).toBeInTheDocument();
    expect(group.getByRole('button', { name: '제외 0' })).toHaveAttribute('aria-pressed', 'false');
    expect(group.getByRole('button', { name: '전체 7' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('필터를 누르면 URL ?status=가 바뀌고 그 상태로 다시 읽는다', async () => {
    const api = stubCandidates();
    const { router } = await renderCandidates();
    await screen.findByRole('button', { name: '작업중 5' });
    await userEvent.click(screen.getByRole('button', { name: '작업중 5' }));
    await waitFor(() => expect(router.state.location.search).toBe('?status=WORKING'));
    await waitFor(() =>
      expect(api.requests.some((r) => r.url.includes('status=WORKING'))).toBe(true),
    );
    await userEvent.click(screen.getByRole('button', { name: '전체 7' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it("줄마다 표시명·상태·이어 할 단계 칩, URL 후보 줄에 '수동'·'비교 안 함', 승인대기는 G4 확인 필요", async () => {
    stubCandidates();
    await renderCandidates();
    const items = within(await screen.findByRole('list', { name: '후보 목록' }));
    const nb = within(
      (await items.findByRole('link', { name: '뉴발란스 530 · 화이트/실버' })).closest('li')!,
    );
    expect(nb.getByText('작업중 · ③ 판정')).toBeInTheDocument();
    expect(nb.getByText('입력 대기')).toBeInTheDocument();
    expect(nb.queryByText('수동')).toBeNull();

    const cortez = within(
      items.getByRole('link', { name: '나이키 코르테즈 · 화이트/레드' }).closest('li')!,
    );
    expect(cortez.getByText('수동')).toBeInTheDocument();
    expect(cortez.getByText('비교 안 함')).toBeInTheDocument();

    const kayano = within(
      items.getByRole('link', { name: '아식스 젤카야노 14 · 크림/블랙' }).closest('li')!,
    );
    expect(kayano.getByText('승인대기')).toBeInTheDocument();
    expect(kayano.getByText('G4 최종 승인 · 확인 필요')).toBeInTheDocument();
    // 'URL로 만들기'는 자리만(P2-02)
    expect(screen.getByRole('button', { name: 'URL로 만들기' })).toBeDisabled();
  });

  it("?candidateId= 후보 머리: 표시명·앵커 키·성별·소싱·게이트·출처 키워드와 '후보 제외'", async () => {
    stubCandidates();
    await renderCandidates(`/candidates?candidateId=${NB530}`);
    const header = within(await screen.findByRole('region', { name: '후보 정보' }));
    expect(await header.findByText('뉴발란스 530 · 화이트/실버')).toBeInTheDocument();
    expect(header.getByText('MR530SG · 화이트/실버')).toBeInTheDocument();
    expect(header.getByText('shop-b:20000456')).toBeInTheDocument();
    expect(header.getByText('G2 판정 확정 · 확인 필요')).toBeInTheDocument();
    expect(header.getByText('G3 썸네일 선택 · 잠김')).toBeInTheDocument();
    expect(header.getByText('G4 최종 승인 · 잠김')).toBeInTheDocument();
    expect(header.getByText('출처 키워드: 뉴발란스 530')).toBeInTheDocument();
    expect(header.getByRole('button', { name: '후보 제외' })).toBeEnabled();
    const selected = screen.getByRole('link', { name: '뉴발란스 530 · 화이트/실버' });
    expect(selected).toHaveAttribute('aria-current', 'true');
  });

  it("'후보 제외' 뒤 목록·상세를 다시 읽고 버튼이 '다시 작업'으로 바뀐다", async () => {
    const api = stubCandidates();
    await renderCandidates(`/candidates?candidateId=${NB530}`);
    const header = within(await screen.findByRole('region', { name: '후보 정보' }));
    const button = await header.findByRole('button', { name: '후보 제외' });
    const before = count(api, 'GET /candidates');
    await userEvent.click(button);
    await waitFor(() => expect(count(api, `POST /candidates/${NB530}/exclude`)).toBe(1));
    await waitFor(() => expect(count(api, 'GET /candidates')).toBeGreaterThan(before));
    expect(await header.findByRole('button', { name: '다시 작업' })).toBeInTheDocument();
    const exclude = api.requests.find((r) => r.method === 'POST')!;
    expect(exclude.headers.get('X-AutoStore-Client')).toBe('1');
  });

  it('409 응답의 message를 그대로 보인다', async () => {
    const api = stubCandidates();
    api.on(`POST /candidates/${NB530}/exclude`, () =>
      errorResponse(
        409,
        'STEP_LOCKED_BY_RUNNING_STEP',
        '② 소싱이 실행 중이라 지금은 할 수 없습니다. 끝난 뒤 다시 해 주세요.',
        {
          details: { stepCode: 'SOURCING' },
        },
      ),
    );
    await renderCandidates(`/candidates?candidateId=${NB530}`);
    const header = within(await screen.findByRole('region', { name: '후보 정보' }));
    await userEvent.click(await header.findByRole('button', { name: '후보 제외' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '② 소싱이 실행 중이라 지금은 할 수 없습니다. 끝난 뒤 다시 해 주세요.',
    );
  });

  it("잠긴 후보는 '후보 제외'가 꺼지고 이유를 보인다", async () => {
    const api = stubCandidates();
    api.on(`GET /candidates/${NB530}`, () =>
      jsonResponse(candidateDetail({ id: NB530, status: 'REGISTERING', locked: true })),
    );
    await renderCandidates(`/candidates?candidateId=${NB530}`);
    const header = within(await screen.findByRole('region', { name: '후보 정보' }));
    const button = await header.findByRole('button', { name: '후보 제외' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('등록을 진행 중이거나 끝난 후보입니다');
  });

  it("?runnableStep=PRICING이면 '입력 고르기' 패널: 그 단계를 지금 실행할 수 있는 후보와 단계 화면 링크", async () => {
    const api = stubCandidates();
    api.on('GET /candidates', (req) =>
      jsonResponse(
        new URL(req.url).searchParams.get('runnableStep') === 'PRICING'
          ? page([list().content[1]!])
          : list(),
      ),
    );
    await renderCandidates('/candidates?runnableStep=PRICING');
    const picker = within(await screen.findByRole('region', { name: '입력 고르기' }));
    expect(picker.getByText('③ 판정 화면에서 작업할 후보를 고릅니다')).toBeInTheDocument();
    const link = await picker.findByRole('link', { name: '③ 판정 열기' });
    expect(link).toHaveAttribute('href', `/candidates/${NB530}/judgement`);
    expect(picker.getByText('뉴발란스 530 · 화이트/실버')).toBeInTheDocument();
  });
});
