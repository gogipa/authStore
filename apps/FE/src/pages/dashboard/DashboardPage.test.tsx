import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { FakeEventSource } from '@/test/fakeEventSource';
import { callUsageList } from '@/test/fixtures/callUsage';
import { settingsView } from '@/test/fixtures/settings';
import {
  attentionItem,
  candidateDetail,
  candidateSummary,
  page,
  requiredDone,
  resumeTarget,
  stepBriefs,
} from '@/test/fixtures/stepEngine';
import { renderRoute } from '@/test/renderRoute';

const KAYANO = 12;
const NB530 = 13;
const SAMBA = 14;
const GT2160 = 15;

function candidates() {
  return page([
    candidateSummary({
      id: KAYANO,
      status: 'AWAITING_APPROVAL',
      displayName: '아식스 젤카야노 14',
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
      id: SAMBA,
      displayName: '아디다스 삼바 OG · 블랙',
      steps: stepBriefs({
        SOURCING: 'COMPLETED',
        PRICING: 'COMPLETED',
        CATEGORY: 'COMPLETED',
        THUMBNAIL: 'RERUN_REQUIRED',
        COPY: 'COMPLETED',
        NOTICE_RAW: 'WAITING_INPUT',
      }),
      resumeStepCode: 'THUMBNAIL',
    }),
    candidateSummary({
      id: GT2160,
      displayName: '아식스 GT-2160 · 실버',
      steps: stepBriefs({ SOURCING: 'FAILED' }),
      resumeStepCode: 'SOURCING',
    }),
  ]);
}

function stubDashboard(options: { resume?: 'kayano' | 'none' } = {}) {
  return stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList()),
    'GET /settings': () => jsonResponse(settingsView()),
    'GET /candidates': () => jsonResponse(candidates()),
    'GET /candidates/resume-target': () =>
      options.resume === 'none'
        ? new Response(null, { status: 204 })
        : jsonResponse(
            resumeTarget({ candidateId: KAYANO, candidateStatus: 'AWAITING_APPROVAL', gate: 'G4' }),
          ),
    [`GET /candidates/${KAYANO}`]: () =>
      jsonResponse(
        candidateDetail({
          id: KAYANO,
          displayName: '아식스 젤카야노 14',
          status: 'AWAITING_APPROVAL',
        }),
      ),
    'GET /candidate-steps': () =>
      jsonResponse(
        page([
          attentionItem({
            id: 1,
            candidateId: SAMBA,
            stepCode: 'THUMBNAIL',
            status: 'RERUN_REQUIRED',
            staleInputs: ['candidate.gender'],
          }),
          attentionItem({
            id: 2,
            candidateId: GT2160,
            stepCode: 'SOURCING',
            status: 'FAILED',
            failureKind: 'EXTERNAL_API',
            errorMessage: '페이지 조회 차단 · 24시간 쉼',
            staleSince: null,
          }),
          attentionItem({
            id: 3,
            candidateId: NB530,
            stepCode: 'PRICING',
            status: 'WAITING_INPUT',
            staleSince: null,
            waitingSince: '2026-09-28T05:02:00.000Z',
          }),
        ]),
      ),
  });
}

async function renderDashboard(options: Parameters<typeof renderRoute>[1] = {}) {
  const view = renderRoute('/', options);
  await screen.findByRole('heading', { level: 1, name: '대시보드' });
  return view;
}

const table = (name: string) => within(screen.getByRole('table', { name }));

describe('대시보드(SCR-01, P1-04)', () => {
  it("배너 '이어서 할 곳: 아식스 젤카야노 14 · 최종 승인', '이어 하기'는 /candidates/{id}/approval", async () => {
    stubDashboard();
    await renderDashboard();
    expect(
      await screen.findByText('이어서 할 곳: 아식스 젤카야노 14 · 최종 승인'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '이어 하기' })).toHaveAttribute(
      'href',
      `/candidates/${KAYANO}/approval`,
    );
  });

  it('이어 할 곳이 없으면(204) 배너가 없다', async () => {
    stubDashboard({ resume: 'none' });
    await renderDashboard();
    await screen.findByRole('table', { name: '진행 중 여정' });
    await waitFor(() => expect(table('진행 중 여정').getAllByRole('row')).toHaveLength(5));
    expect(screen.queryByText(/이어서 할 곳/)).toBeNull();
    expect(screen.queryByRole('link', { name: '이어 하기' })).toBeNull();
  });

  it("재실행 필요·멈춘 여정 표: 여정·단계·상태·사유, '단계 열기'는 stepPath 경로, 안내 문구", async () => {
    stubDashboard();
    await renderDashboard();
    const stuck = within(await screen.findByRole('region', { name: /재실행 필요·멈춘 여정/ }));
    expect(
      stuck.getByText(
        '재실행 필요 단계는 자동으로 다시 돌지 않습니다. 단계를 열어 다시 실행하세요.',
      ),
    ).toBeInTheDocument();
    const t = table('재실행 필요·멈춘 여정');
    await t.findByText('아디다스 삼바 OG · 블랙');
    const rows = t.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('⑤ 썸네일')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('재실행 필요')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('바뀐 입력: 성별')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link', { name: '단계 열기' })).toHaveAttribute(
      'href',
      `/candidates/${SAMBA}/thumbnail`,
    );
    expect(within(rows[1]!).getByText('페이지 조회 차단 · 24시간 쉼')).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('link', { name: '단계 열기' })).toHaveAttribute(
      'href',
      `/candidates/${GT2160}/sourcing`,
    );
    expect(within(rows[2]!).getByText('14:02부터 입력을 기다립니다')).toBeInTheDocument();
    expect(within(rows[2]!).getByRole('link', { name: '단계 열기' })).toHaveAttribute(
      'href',
      `/candidates/${NB530}/judgement`,
    );
  });

  it("진행 중 여정 표: 여정 상태 칩, ②~⑨ 점(⑥ 묶음 규칙), '{단계} 열기'", async () => {
    stubDashboard();
    await renderDashboard();
    const t = table('진행 중 여정');
    await t.findByText('아식스 젤카야노 14');
    const headers = t.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      '여정',
      '여정 상태',
      '②',
      '③',
      '④',
      '⑤',
      '⑥',
      '⑦',
      '⑧',
      '⑨',
      '이어 하기',
    ]);

    const kayano = within(t.getByText('아식스 젤카야노 14').closest('tr')!);
    expect(kayano.getByText('승인대기')).toBeInTheDocument();
    expect(kayano.getByRole('img', { name: '② 완료' })).toBeInTheDocument();
    expect(kayano.getByRole('img', { name: '⑧ 완료' })).toBeInTheDocument();
    expect(kayano.getByRole('img', { name: '⑨ 미실행' })).toBeInTheDocument();
    expect(kayano.getByRole('link', { name: '최종 승인 열기' })).toHaveAttribute(
      'href',
      `/candidates/${KAYANO}/approval`,
    );

    const samba = within(t.getByText('아디다스 삼바 OG · 블랙').closest('tr')!);
    // ⑥-1 완료 · ⑥-2 입력 대기 · ⑥-3 미실행 → 입력 대기(실패 > 재실행 필요 > 입력 대기 > 실행중 > 미실행 > 완료)
    expect(samba.getByRole('img', { name: '⑥ 입력 대기' })).toBeInTheDocument();
    expect(samba.getByRole('img', { name: '⑤ 재실행 필요' })).toBeInTheDocument();
    expect(samba.getByRole('link', { name: '⑤ 썸네일 열기' })).toHaveAttribute(
      'href',
      `/candidates/${SAMBA}/thumbnail`,
    );
    const nb = within(t.getByText('뉴발란스 530 · 화이트/실버').closest('tr')!);
    expect(nb.getByText('작업중')).toBeInTheDocument();
    expect(nb.getByRole('link', { name: '③ 판정 열기' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '단계 점 범례' })).toHaveTextContent(
      '입력 대기·재확인 필요',
    );
  });

  it("시스템 경고: '설정 파일 검사 · 앱을 켤 때 오류 없음'", async () => {
    stubDashboard();
    await renderDashboard();
    const sys = within(await screen.findByRole('region', { name: '시스템 경고' }));
    expect(await sys.findByText('설정 파일 검사 · 앱을 켤 때 오류 없음')).toBeInTheDocument();
    expect(sys.getByText('통과')).toBeInTheDocument();
  });

  it("'오늘 처리량' 같은 M2 글이 없다", async () => {
    stubDashboard();
    await renderDashboard();
    await screen.findByText('이어서 할 곳: 아식스 젤카야노 14 · 최종 승인');
    for (const text of [
      '오늘 처리량',
      '단계별 대기 건수',
      '조치 필요',
      '등록 한도·판매 비중',
      '고른 여정 일괄 실행',
      '밤에 실행',
    ]) {
      expect(screen.queryByText(text)).toBeNull();
    }
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('SSE candidate.status-changed가 오면 목록·이어서 할 곳을 다시 읽는다', async () => {
    const api = stubDashboard();
    await renderDashboard({ EventSourceImpl: FakeEventSource });
    await screen.findByText('이어서 할 곳: 아식스 젤카야노 14 · 최종 승인');
    const count = (key: string) =>
      api.requests.filter(
        (r) => `${r.method} ${new URL(r.url).pathname.replace(/^\/api\/v1/, '')}` === key,
      ).length;
    const before = {
      list: count('GET /candidates'),
      resume: count('GET /candidates/resume-target'),
    };
    act(() => {
      FakeEventSource.latest().open();
      FakeEventSource.latest().emit('candidate.status-changed', {
        candidateId: NB530,
        fromStatus: 'WORKING',
        toStatus: 'EXCLUDED',
        reason: 'OWNER_EXCLUDED',
        excludedReason: 'OWNER_EXCLUDED',
        changedAt: '2026-09-28T05:02:00.000Z',
      });
    });
    await waitFor(() => expect(count('GET /candidates')).toBeGreaterThan(before.list));
    await waitFor(() =>
      expect(count('GET /candidates/resume-target')).toBeGreaterThan(before.resume),
    );
  });
});
