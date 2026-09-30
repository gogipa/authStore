import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { FakeEventSource } from '@/test/fakeEventSource';
import { callUsageList } from '@/test/fixtures/callUsage';
import {
  candidateDetail,
  candidateSummary,
  disabled,
  page,
  statusCounts,
  stepRail,
  versionItem,
} from '@/test/fixtures/stepEngine';
import { renderRoute } from '@/test/renderRoute';

const ID = 13;
const PRE_G2 =
  '판정(G2) 전에 썸네일을 만들면 팔지 않을 상품에도 AI 사용량이 듭니다. 실행은 막지 않습니다.';
const UPLOAD_WHY = 'G3 썸네일 선택을 먼저 통과해 주세요.';

function rail() {
  return stepRail({
    SOURCING: { status: 'COMPLETED' },
    PRICING: { status: 'WAITING_INPUT' },
    THUMBNAIL: {
      status: 'RERUN_REQUIRED',
      staleInputs: ['owner.referenceSelection'],
      warnings: [{ code: 'PRE_G2_AI_COST', message: PRE_G2 }],
    },
    NOTICE_HTML: {
      actions: {
        run: disabled('STEP_START_CONDITION_UNMET', '시작에 필요한 값이 없습니다: ⑥-1 카피.'),
        continuousRun: disabled('CONTINUOUS_RUN_BEFORE_G2', 'G2 전'),
        edit: disabled('STEP_NOT_COMPLETED', '미실행'),
      },
    },
    UPLOAD: {
      actions: {
        run: disabled('GATE_NOT_PASSED', UPLOAD_WHY),
        continuousRun: disabled('GATE_NOT_PASSED', UPLOAD_WHY),
        edit: disabled('INVALID_STEP_CODE', 'x'),
      },
    },
    REGISTER: {
      actions: {
        run: disabled('INVALID_STEP_CODE', '최종 승인(G4)에서만 등록합니다.'),
        continuousRun: disabled('INVALID_STEP_CODE', '최종 승인(G4)에서만 등록합니다.'),
        edit: disabled('INVALID_STEP_CODE', 'x'),
      },
    },
  });
}

function stub() {
  const api = stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList()),
    'GET /candidates/status-counts': () => jsonResponse(statusCounts({ WORKING: 1 })),
    'GET /candidates': () => jsonResponse(page([candidateSummary({ id: ID })])),
    [`GET /candidates/${ID}`]: () =>
      jsonResponse(
        candidateDetail({
          id: ID,
          creationPath: 'KEYWORD',
          pageDataCollectedAt: '2026-09-27T20:38:00.000Z',
          pageDataStale: true,
        }),
      ),
    [`GET /candidates/${ID}/steps`]: () => jsonResponse(rail()),
    [`GET /candidates/${ID}/steps/SOURCING/runs`]: () =>
      jsonResponse(
        page([versionItem({ id: 100, version: 1, stepCode: 'SOURCING', isCurrent: true })]),
      ),
    [`POST /candidates/${ID}/steps/SOURCING/runs`]: () =>
      jsonResponse(
        {
          stepRunId: 200,
          stepRunIds: [200],
          candidateId: ID,
          stepCode: 'SOURCING',
          version: 2,
          executionMode: 'STEP',
          aiEngine: null,
          aiModel: null,
          aiCliVersion: null,
          status: 'RUNNING',
          warnings: [],
        },
        202,
      ),
  });
  return api;
}

const count = (api: ReturnType<typeof stubApi>, key: string) =>
  api.requests.filter(
    (r) => `${r.method} ${new URL(r.url).pathname.replace(/^\/api\/v1/, '')}` === key,
  ).length;

async function renderTable() {
  const view = renderRoute(`/candidates?candidateId=${ID}`, { EventSourceImpl: FakeEventSource });
  const table = within(await screen.findByRole('table', { name: '단계 표' }));
  await table.findAllByText('완료');
  return { ...view, table };
}

const row = (table: ReturnType<typeof within>, name: RegExp | string) =>
  within(table.getByText(name, { selector: 'td span' }).closest('tr')!);

describe('StepTable — SCR-12 단계 표(P1-05)', () => {
  it('열 6개와 10단계(⑥ 묶음을 펼치면 ⑥-1~⑥-3), 표 위 안내', async () => {
    stub();
    const { table } = await renderTable();
    expect(table.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      '단계',
      '상태',
      '마지막 실행',
      '입력 출처',
      '버전',
      '동작',
    ]);
    expect(
      screen.getByText(/단계마다 따로 실행하고, 다음 단계는 자동으로 시작하지 않습니다/),
    ).toBeInTheDocument();
    const stepRows = () =>
      table
        .getAllByRole('row')
        .map((tr) => tr.getAttribute('data-step'))
        .filter(Boolean);
    expect(stepRows()).toEqual([
      'SOURCING',
      'PRICING',
      'CATEGORY',
      'THUMBNAIL',
      'CONTENT',
      'TAGS',
      'UPLOAD',
      'REGISTER',
    ]);
    await userEvent.click(
      table.getByRole('button', { name: '⑥-1 카피, ⑥-2 원산지·소재, ⑥-3 고시·HTML 펼치기' }),
    );
    expect(stepRows().filter((code) => code !== 'CONTENT')).toHaveLength(10);
    expect(stepRows()).toContain('NOTICE_HTML');
    // 게이트 줄
    expect(table.getByText('G2 판정 확정 · 확인 필요')).toBeInTheDocument();
    expect(table.getByText('G4 최종 승인 · 잠김')).toBeInTheDocument();
  });

  it('상태 칩 글자, ② 오래됨·받음 · 6시간이 지났습니다, 입력 출처, ⑤ AI 비용 경고, 재실행 사유', async () => {
    stub();
    const { table } = await renderTable();
    expect(row(table, '소싱').getByText('완료')).toBeInTheDocument();
    expect(row(table, '소싱').getByText('키워드 검색어')).toBeInTheDocument();
    expect(row(table, '판정').getByText('입력 대기')).toBeInTheDocument();
    expect(row(table, '썸네일').getByText('재실행 필요')).toBeInTheDocument();
    expect(row(table, '카테고리').getByText('미실행')).toBeInTheDocument();
    expect(table.getByText('오래됨')).toBeInTheDocument();
    expect(table.getByText(/받음 · 6시간이 지났습니다/)).toBeInTheDocument();
    expect(table.getByRole('note')).toHaveTextContent(PRE_G2);
    expect(table.getByText('바뀐 입력: 레퍼런스 선택')).toBeInTheDocument();
    // 입력 대기 단계는 그 화면으로 간다
    expect(row(table, '판정').getByRole('link', { name: '판정 열기' })).toHaveAttribute(
      'href',
      `/candidates/${ID}/judgement`,
    );
  });

  it('꺼진 버튼 옆에 API disabledReason.message를 그대로 보인다', async () => {
    stub();
    const { table } = await renderTable();
    const upload = row(table, '이미지 업로드').getByRole('button', { name: '실행' });
    expect(upload).toBeDisabled();
    expect(upload).toHaveAccessibleDescription(UPLOAD_WHY);
    const register = row(table, '등록').getByRole('button', { name: '실행' });
    expect(register).toBeDisabled();
    expect(register).toHaveAccessibleDescription('최종 승인(G4)에서만 등록합니다.');
    expect(row(table, '카테고리').getByRole('button', { name: '실행' })).toBeEnabled();
  });

  it("버전 펼침: '현재 버전'·'이전 버전이 없습니다'", async () => {
    stub();
    const { table } = await renderTable();
    await userEvent.click(table.getByRole('button', { name: '② 버전 이력 펼치기' }));
    const history = within(await table.findByRole('list', { name: 'SOURCING 버전 이력' }));
    expect(await history.findByText('현재 버전')).toBeInTheDocument();
    expect(await table.findByText('이전 버전이 없습니다')).toBeInTheDocument();
    expect(table.getAllByRole('button', { name: '이전 버전 다시 고르기' })[0]).toBeDisabled();
  });

  it("'다시 실행'을 누르면 POST 한 번, SSE 뒤 표를 다시 읽는다", async () => {
    const api = stub();
    const { table } = await renderTable();
    await userEvent.click(row(table, '소싱').getByRole('button', { name: '다시 실행' }));
    await waitFor(() => expect(count(api, `POST /candidates/${ID}/steps/SOURCING/runs`)).toBe(1));
    const post = api.requests.find((r) => r.method === 'POST')!;
    expect(post.headers.get('X-AutoStore-Client')).toBe('1');
    await waitFor(() =>
      expect(count(api, `GET /candidates/${ID}/steps`)).toBeGreaterThanOrEqual(2),
    );
    const before = count(api, `GET /candidates/${ID}/steps`);
    FakeEventSource.latest().emit('step-run.status-changed', {
      stepRunId: 200,
      candidateId: ID,
      stepCode: 'SOURCING',
      version: 2,
      executionMode: 'STEP',
      stepChainId: null,
      status: 'COMPLETED',
      occurredAt: '2026-09-28T05:00:00.000Z',
    });
    await waitFor(() => expect(count(api, `GET /candidates/${ID}/steps`)).toBe(before + 1));
    expect(count(api, `POST /candidates/${ID}/steps/SOURCING/runs`)).toBe(1);
  });

  it("⑥ '실행'은 COPY + throughStepCode=NOTICE_HTML 한 번", async () => {
    const api = stub();
    let body: unknown = null;
    api.on(`POST /candidates/${ID}/steps/COPY/runs`, async (req) => {
      body = await req.json();
      return jsonResponse({ stepRunId: 300, stepRunIds: [300] }, 202);
    });
    const { table } = await renderTable();
    await userEvent.click(table.getByRole('button', { name: '⑥ 상세 콘텐츠 실행' }));
    await waitFor(() => expect(body).toEqual({ throughStepCode: 'NOTICE_HTML' }));
  });

  it('409 응답의 message를 그대로 보인다', async () => {
    const api = stub();
    api.on(`POST /candidates/${ID}/steps/CATEGORY/runs`, () =>
      jsonResponse(
        {
          code: 'STEP_LOCKED_BY_RUNNING_STEP',
          message: '② 소싱이 실행 중이라 지금은 할 수 없습니다. 끝난 뒤 다시 해 주세요.',
          status: 409,
          timestamp: '2026-09-28T05:00:00+09:00',
          path: '/api/v1',
        },
        409,
      ),
    );
    const { table } = await renderTable();
    await userEvent.click(row(table, '카테고리').getByRole('button', { name: '실행' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '② 소싱이 실행 중이라 지금은 할 수 없습니다. 끝난 뒤 다시 해 주세요.',
    );
  });

  it('이전 버전 다시 고르기 → RESTORE_VERSION(baseStepRunId = 고른 버전)', async () => {
    const api = stub();
    api.on(`GET /candidates/${ID}/steps/SOURCING/runs`, () =>
      jsonResponse(
        page([
          versionItem({ id: 101, version: 2, stepCode: 'SOURCING', isCurrent: true }),
          versionItem({ id: 100, version: 1, stepCode: 'SOURCING' }),
        ]),
      ),
    );
    let body: unknown = null;
    api.on(`POST /candidates/${ID}/steps/SOURCING/owner-edits`, async (req) => {
      body = await req.json();
      return jsonResponse({ stepRunId: 102 }, 201);
    });
    const { table } = await renderTable();
    await userEvent.click(table.getByRole('button', { name: '② 버전 이력 펼치기' }));
    await userEvent.click(await table.findByRole('button', { name: 'v1 이전 버전 다시 고르기' }));
    await waitFor(() =>
      expect(body).toEqual({ ownerAction: 'RESTORE_VERSION', baseStepRunId: 100 }),
    );
    expect(table.queryByText('이전 버전이 없습니다')).toBeNull();
  });
});
