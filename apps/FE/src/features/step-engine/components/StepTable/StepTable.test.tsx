import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { FakeEventSource } from '@/test/fakeEventSource';
import { callUsageList } from '@/test/fixtures/callUsage';
import {
  candidateDetail,
  candidateSummary,
  continuousRun,
  disabled,
  gateList,
  page,
  statusCounts,
  stepRail,
  stepRunSummary,
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
    [`GET /candidates/${ID}/gates`]: () => jsonResponse(gateList()),
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

  it("② 오래됨 줄 '재조회'(P2-02): '재조회는 페이지 1건 · 오늘 38/110', 누르면 POST …/refetch 한 번. 하루 한도면 꺼지고 이유", async () => {
    const api = stub();
    api.on(`POST /candidates/${ID}/refetch`, () =>
      jsonResponse({ stepRunId: 201, candidateId: ID, stepCode: 'SOURCING' }, 202),
    );
    const { table } = await renderTable();
    expect(await table.findByText('38/110')).toBeInTheDocument();
    expect(table.getByText(/재조회는 페이지 1건 · 오늘/)).toBeInTheDocument();
    await userEvent.click(table.getByRole('button', { name: '재조회' }));
    await waitFor(() => expect(count(api, `POST /candidates/${ID}/refetch`)).toBe(1));
  });

  it("② '재조회'는 하루 페이지 조회 한도에 닿으면 꺼지고 이유를 보인다(P2-02)", async () => {
    const api = stub();
    api.on('GET /call-usage', () => jsonResponse(callUsageList(110)));
    const { table } = await renderTable();
    const button = table.getByRole('button', { name: '재조회' });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAccessibleDescription(
      '오늘 페이지 조회 한도(110건)를 다 썼습니다. 내일 0시(한국 시간)에 다시 됩니다.',
    );
  });

  it('꺼진 버튼 옆 이유: ⑧(G3 전)·⑨는 시안 글, 그 밖은 API disabledReason.message 그대로', async () => {
    const api = stub();
    api.on(`GET /candidates/${ID}/steps`, () =>
      jsonResponse(
        stepRail({
          ...rail().items.reduce((acc, item) => ({ ...acc, [item.stepCode]: item }), {}),
          UPLOAD: {
            actions: {
              run: {
                enabled: false,
                disabledReason: {
                  code: 'GATE_NOT_PASSED',
                  message: UPLOAD_WHY,
                  details: { stepCode: 'UPLOAD', gate: 'G3' },
                },
              },
              continuousRun: disabled('GATE_NOT_PASSED', UPLOAD_WHY),
              edit: disabled('INVALID_STEP_CODE', 'x'),
            },
          },
          REGISTER: {
            actions: {
              run: {
                enabled: false,
                disabledReason: {
                  code: 'INVALID_STEP_CODE',
                  message: '최종 승인(G4)에서만 등록합니다.',
                  details: { stepCode: 'REGISTER', reason: 'NOT_RUNNABLE' },
                },
              },
              continuousRun: disabled('INVALID_STEP_CODE', 'x'),
              edit: disabled('INVALID_STEP_CODE', 'x'),
            },
          },
          CATEGORY: {
            actions: {
              run: disabled(
                'STEP_START_CONDITION_UNMET',
                '시작에 필요한 값이 없습니다: ② 장르·상품유형.',
              ),
              continuousRun: disabled('CONTINUOUS_RUN_BEFORE_G2', 'G2 전'),
              edit: disabled('INVALID_STEP_CODE', 'x'),
            },
          },
        }),
      ),
    );
    const { table } = await renderTable();
    const upload = row(table, '이미지 업로드').getByRole('button', { name: '실행' });
    expect(upload).toBeDisabled();
    expect(upload).toHaveAccessibleDescription('썸네일 선택(G3)이 필요합니다');
    const register = row(table, '등록').getByRole('button', { name: '실행' });
    expect(register).toBeDisabled();
    expect(register).toHaveAccessibleDescription('최종 승인(G4)에서만 등록합니다');
    const category = row(table, '카테고리').getByRole('button', { name: '실행' });
    expect(category).toHaveAccessibleDescription('시작에 필요한 값이 없습니다: ② 장르·상품유형.');
    expect(row(table, '소싱').getByRole('button', { name: '다시 실행' })).toBeEnabled();
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

  it("시작 409 AI_ENGINE_UNAVAILABLE이면 문구 옆 'AI 엔진 설정으로' 링크(P1-10, F-BS-76). 다른 409에는 없다", async () => {
    const api = stub();
    api.on(`POST /candidates/${ID}/steps/CATEGORY/runs`, () =>
      jsonResponse(
        {
          code: 'AI_ENGINE_UNAVAILABLE',
          message:
            "선택한 AI 엔진(Claude Code)을 지금 쓸 수 없습니다(설치되지 않음). 'AI 엔진' 설정에서 확인해 주세요.",
          status: 409,
          timestamp: '2026-09-28T05:00:00+09:00',
          path: '/api/v1',
          details: {
            engineCode: 'CLAUDE',
            reason: 'NOT_INSTALLED',
            settingsPath: '/settings/ai-engine',
          },
        },
        409,
      ),
    );
    const { table } = await renderTable();
    await userEvent.click(row(table, '카테고리').getByRole('button', { name: '실행' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/설치되지 않음/);
    expect(within(alert).getByRole('link', { name: 'AI 엔진 설정으로' })).toHaveAttribute(
      'href',
      '/settings/ai-engine',
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

describe('StepTable — 연속 실행·게이트(P1-06)', () => {
  const BEFORE_G2 =
    '판정(G2)을 통과해야 ④부터 연속 실행할 수 있습니다. 그 전에는 단계를 하나씩 실행합니다.';
  const beforeG2 = disabled(
    'CONTINUOUS_RUN_BEFORE_G2',
    '소싱 확정(G2) 전에는 ②·③부터만 연속 실행할 수 있습니다. 다른 단계는 하나씩 실행해 주세요.',
  );

  /** G2 전 레일: ②·③만 연속 실행이 켜지고 ④ 이후는 CONTINUOUS_RUN_BEFORE_G2 */
  function preG2Rail(extra: Parameters<typeof stepRail>[0] = {}) {
    const actions = { run: { enabled: true, disabledReason: null }, continuousRun: beforeG2 };
    return stepRail({
      SOURCING: { status: 'COMPLETED' },
      PRICING: { status: 'COMPLETED' },
      CATEGORY: { actions: { ...actions, edit: disabled('INVALID_STEP_CODE', 'x') } },
      THUMBNAIL: { actions: { ...actions, edit: disabled('INVALID_STEP_CODE', 'x') } },
      COPY: { actions: { ...actions, edit: disabled('STEP_NOT_COMPLETED', 'x') } },
      TAGS: { actions: { ...actions, edit: disabled('STEP_NOT_COMPLETED', 'x') } },
      ...extra,
    });
  }

  function stubChain(
    patch: { detail?: Parameters<typeof candidateDetail>[0]; rail?: unknown } = {},
  ) {
    const api = stub();
    api.on(`GET /candidates/${ID}`, () =>
      jsonResponse(candidateDetail({ id: ID, creationPath: 'KEYWORD', ...patch.detail })),
    );
    api.on(`GET /candidates/${ID}/steps`, () => jsonResponse(patch.rail ?? preG2Rail()));
    return api;
  }

  it("G2 전: ②·③ 줄의 '여기부터 연속 실행'만 켜지고, ④ 줄은 꺼짐 + 시안 문구(G2 줄 설명)", async () => {
    stubChain();
    const { table } = await renderTable();
    const chain = (name: string) =>
      row(table, name).getByRole('button', { name: `${name} 여기부터 연속 실행` });
    expect(chain('소싱')).toBeEnabled();
    expect(chain('판정')).toBeEnabled();
    expect(chain('카테고리')).toBeDisabled();
    expect(chain('카테고리')).toHaveAccessibleDescription(BEFORE_G2);
    expect(chain('썸네일')).toBeDisabled();
    expect(
      table.getByRole('button', { name: '⑥ 상세 콘텐츠 여기부터 연속 실행' }),
    ).toHaveAccessibleDescription(BEFORE_G2);
    // ⑧·⑨는 '실행'만(시안)
    expect(
      row(table, '이미지 업로드').queryByRole('button', { name: /여기부터 연속 실행/ }),
    ).toBeNull();
    expect(table.getByText(BEFORE_G2)).toBeInTheDocument();
  });

  it("'여기부터 연속 실행'을 누르면 FROM_HERE + startStepCode로 POST 한 번, 받은 묶음의 진행을 띠로 보인다", async () => {
    const api = stubChain();
    let body: unknown = null;
    api.on(`POST /candidates/${ID}/continuous-runs`, async (req) => {
      body = await req.json();
      return jsonResponse(
        {
          stepChainId: 9,
          candidateId: ID,
          kind: 'FROM_HERE',
          startStepCode: 'SOURCING',
          startedAt: '2026-09-28T05:00:00.000Z',
          status: 'RUNNING',
          stepRunId: 500,
          stepCode: 'SOURCING',
        },
        202,
      );
    });
    api.on('GET /continuous-runs/9', () =>
      jsonResponse(
        continuousRun({
          id: 9,
          candidateId: ID,
          stepRuns: [
            stepRunSummary({ id: 500, stepCode: 'SOURCING', status: 'RUNNING', stepChainId: 9 }),
          ],
        }),
      ),
    );
    const { table } = await renderTable();
    await userEvent.click(
      row(table, '소싱').getByRole('button', { name: '소싱 여기부터 연속 실행' }),
    );
    await waitFor(() => expect(body).toEqual({ kind: 'FROM_HERE', startStepCode: 'SOURCING' }));
    expect(api.requests.find((r) => r.method === 'POST')!.headers.get('X-AutoStore-Client')).toBe(
      '1',
    );
    const banner = await screen.findByText('연속 실행 중입니다');
    expect(banner.closest('[role="status"]')).toHaveTextContent(
      '실행한 단계: ② 소싱 · 지금 ② 소싱 실행 중',
    );
  });

  it("재실행 필요 단계가 없으면 '재실행 필요 단계 모두 실행'은 꺼짐 + '재실행 필요 단계가 없습니다'. 있으면 RERUN_STALE로 POST", async () => {
    const api = stubChain();
    const { unmount } = await renderTable();
    const button = screen.getAllByRole('button', { name: '재실행 필요 단계 모두 실행' })[0]!;
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('재실행 필요 단계가 없습니다');
    unmount();

    api.on(`GET /candidates/${ID}/steps`, () =>
      jsonResponse(
        preG2Rail({ SOURCING: { status: 'RERUN_REQUIRED', staleInputs: ['settings.costs'] } }),
      ),
    );
    let body: unknown = null;
    api.on(`POST /candidates/${ID}/continuous-runs`, async (req) => {
      body = await req.json();
      return jsonResponse({ stepChainId: 10, stepRunId: 501, stepCode: 'SOURCING' }, 202);
    });
    api.on('GET /continuous-runs/10', () =>
      jsonResponse(continuousRun({ id: 10, kind: 'RERUN_STALE' })),
    );
    await renderTable();
    const enabled = screen.getAllByRole('button', { name: '재실행 필요 단계 모두 실행' })[0]!;
    await waitFor(() => expect(enabled).toBeEnabled());
    await userEvent.click(enabled);
    await waitFor(() => expect(body).toEqual({ kind: 'RERUN_STALE' }));
  });

  it("게이트 줄 배지: 'G2 판정 확정 · 확인 필요'·'G3 썸네일 선택 · 잠김', 통과 뒤 '· 통과'(게이트 목록으로 그린다)", async () => {
    const api = stubChain();
    const { table, unmount } = await renderTable();
    expect(await table.findByText('G2 판정 확정 · 확인 필요')).toBeInTheDocument();
    expect(table.getByText('G3 썸네일 선택 · 잠김')).toBeInTheDocument();
    unmount();

    // 후보 상세의 gates는 무효인 채여도 게이트 목록(지문 비교)이 통과면 통과로 그린다
    api.on(`GET /candidates/${ID}/gates`, () => jsonResponse(gateList({ G2: true })));
    const again = await renderTable();
    expect(await again.table.findByText('G2 판정 확정 · 통과')).toBeInTheDocument();
    expect(again.table.getByText('G3 썸네일 선택 · 확인 필요')).toBeInTheDocument();
    expect(again.table.getByText('G4 최종 승인 · 잠김')).toBeInTheDocument();
  });

  it('continuous-run.stopped 이벤트 뒤 띠를 다시 읽어 멈춘 이유를 보인다', async () => {
    const api = stubChain({
      detail: {
        id: ID,
        openContinuousRun: {
          id: 7,
          candidateId: ID,
          kind: 'FROM_HERE',
          startStepCode: 'SOURCING',
          startedAt: '2026-09-28T05:00:00.000Z',
          endedAt: null,
          stopReason: null,
          stopStepCode: null,
        },
      },
    });
    let stopped = false;
    api.on('GET /continuous-runs/7', () =>
      jsonResponse(
        continuousRun({
          id: 7,
          candidateId: ID,
          stepRuns: [
            stepRunSummary({ id: 500, stepCode: 'SOURCING', status: 'COMPLETED', stepChainId: 7 }),
            stepRunSummary({
              id: 501,
              stepCode: 'PRICING',
              status: stopped ? 'WAITING_INPUT' : 'RUNNING',
              stepChainId: 7,
            }),
          ],
          ...(stopped
            ? {
                endedAt: '2026-09-28T05:10:00.000Z',
                stopReason: 'AWAIT_G2' as const,
                stopStepCode: 'PRICING' as const,
              }
            : {}),
        }),
      ),
    );
    await renderTable();
    expect(await screen.findByText('연속 실행 중입니다')).toBeInTheDocument();
    const before = count(api, 'GET /continuous-runs/7');
    stopped = true;
    FakeEventSource.latest().emit('continuous-run.stopped', {
      stepChainId: 7,
      candidateId: ID,
      kind: 'FROM_HERE',
      stopReason: 'AWAIT_G2',
      stopStepCode: 'PRICING',
      endedAt: '2026-09-28T05:10:00.000Z',
    });
    expect(await screen.findByText('연속 실행이 멈췄습니다')).toBeInTheDocument();
    expect(count(api, 'GET /continuous-runs/7')).toBeGreaterThan(before);
    expect(
      screen.getByText(
        '판정(G2) 앞에서 멈췄습니다. ③ 판정 화면에서 국내 기준가를 넣고 판정을 확정해 주세요.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('실행한 단계: ② 소싱 → ③ 판정')).toBeInTheDocument();
  });
});

describe('StepTable — 커머스API 인증 실패 안내(P1-07 규칙 14)', () => {
  it('실패 사유가 COMMERCE_AUTH_FAILED·SECRET_NOT_CONFIGURED면 시스템 상태 키 입력으로 잇는 링크를 붙인다', async () => {
    const api = stub();
    const failed = (id: number, stepCode: 'UPLOAD' | 'TAGS', errorCode: string | null) =>
      stepRunSummary({
        id,
        stepCode,
        status: 'FAILED',
        failureKind: 'EXTERNAL_API',
        errorCode,
        errorMessage: `${stepCode} 실패 문구`,
      });
    api.on(`GET /candidates/${ID}/steps`, () =>
      jsonResponse(
        stepRail({
          SOURCING: { status: 'COMPLETED' },
          UPLOAD: {
            status: 'FAILED',
            currentStepRunId: 107,
            currentRun: failed(107, 'UPLOAD', 'COMMERCE_AUTH_FAILED'),
          },
          TAGS: {
            status: 'FAILED',
            currentStepRunId: 106,
            currentRun: failed(106, 'TAGS', 'AI_ENGINE_UNAVAILABLE'),
          },
        }),
      ),
    );
    await renderTable();
    const uploadNote = (await screen.findByText(/UPLOAD 실패 문구/)).closest('td')!;
    expect(
      within(uploadNote).getByRole('link', { name: '시스템 상태에서 키 확인' }),
    ).toHaveAttribute('href', '/system#keys');
    const tagsNote = screen.getByText(/TAGS 실패 문구/).closest('td')!;
    expect(within(tagsNote).queryByRole('link', { name: '시스템 상태에서 키 확인' })).toBeNull();
    // 선택 AI 엔진을 쓸 수 없어 실패한 줄은 'AI 엔진 설정으로'(P1-10, F-BS-76)
    expect(within(tagsNote).getByRole('link', { name: 'AI 엔진 설정으로' })).toHaveAttribute(
      'href',
      '/settings/ai-engine',
    );
    expect(within(uploadNote).queryByRole('link', { name: 'AI 엔진 설정으로' })).toBeNull();
  });
});
