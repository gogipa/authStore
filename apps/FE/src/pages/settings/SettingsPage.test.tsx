import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { FakeEventSource } from '@/test/fakeEventSource';
import { callUsageList } from '@/test/fixtures/callUsage';
import { settingsContent, settingsReloadResult, settingsView } from '@/test/fixtures/settings';
import { renderRoute } from '@/test/renderRoute';

const INVALID_MESSAGE =
  '설정 파일에 오류가 있어 설정을 읽지 못했습니다. 설정 화면의 검사 결과를 확인해 주세요.';

function stubSettings(view = settingsView()) {
  return stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList()),
    'GET /settings': () => jsonResponse(view),
  });
}

async function renderSettings(options: Parameters<typeof renderRoute>[1] = {}) {
  const view = renderRoute('/settings', options);
  await screen.findByRole('heading', { level: 1, name: '설정' });
  return view;
}

const checkCard = () => within(screen.getByRole('region', { name: '설정 파일 검사' }));
const summary = () => within(screen.getByRole('region', { name: '적용 중인 기본값' }));
const getRequests = (api: ReturnType<typeof stubApi>, key: string) =>
  api.requests.filter(
    (r) => `${r.method} ${new URL(r.url).pathname.replace(/^\/api\/v1/, '')}` === key,
  );

describe('설정 화면(SCR-10, P1-03)', () => {
  it('머리: 제목 "설정"과 시안 설명, 탭은 M1 3개만', async () => {
    stubSettings();
    await renderSettings();
    expect(
      screen.getByText(
        '모든 상품에 공통으로 쓰는 값입니다. 저장할 때 형식을 검사하고, 안전장치를 끄거나 기준을 낮추는 값은 저장하지 않습니다.',
      ),
    ).toBeInTheDocument();
    const tabs = within(screen.getByRole('tablist', { name: '설정 항목' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['구매대행 프로필', '비용·요금표', '환율']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('구매대행 프로필');
    // 편집 버튼(되돌리기·저장)은 M1에 없다
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull();
  });

  it('탭을 고르면 그 패널을 보인다', async () => {
    stubSettings();
    await renderSettings();
    await userEvent.click(screen.getByRole('tab', { name: '환율' }));
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('환율');
  });

  it("valid:true → '오류 없음'", async () => {
    stubSettings();
    await renderSettings();
    expect(await checkCard().findByText('오류 없음')).toBeInTheDocument();
    expect(checkCard().queryByRole('list')).toBeNull();
  });

  it('오류가 있으면 칸 이름(JSON 경로)과 문구를 보인다', async () => {
    stubSettings(
      settingsView({
        valid: false,
        errors: [{ field: '/costs/cardSurchargePct', message: '숫자여야 합니다.' }],
      }),
    );
    await renderSettings();
    expect(await checkCard().findByText('오류 1건')).toBeInTheDocument();
    const list = checkCard().getByRole('list', { name: '설정 파일 오류' });
    expect(within(list).getByText('/costs/cardSurchargePct')).toBeInTheDocument();
    expect(within(list).getByText('숫자여야 합니다.')).toBeInTheDocument();
    expect(checkCard().queryByText('오류 없음')).toBeNull();
  });

  it("'적용 중인 기본값': 2.5% · 3.0% · 3.63% · 3,000원 · 10% · 5,000원, 부가세 모드 A, 과세 사이즈 판매 꺼짐", async () => {
    stubSettings();
    await renderSettings();
    await summary().findByText('2.5%');
    const texts = summary()
      .getAllByRole('definition')
      .map((dd) => dd.textContent);
    expect(texts).toEqual([
      '2.5%',
      '3.0%',
      '3.63%',
      '3,000원',
      '10%',
      '5,000원',
      'A 대행수수료 과세',
    ]);
    const terms = summary()
      .getAllByRole('term')
      .map((dt) => dt.textContent);
    expect(terms).toEqual([
      '카드 가산',
      '판매수수료',
      'Npay 수수료',
      '기타비용',
      '목표 마진',
      '최소 이익',
      '부가세 모드',
    ]);
    const taxable = summary().getByRole('switch', { name: '과세 사이즈 판매' });
    expect(taxable).toHaveAttribute('aria-checked', 'false');
    expect(taxable).toBeDisabled();
    expect(summary().getByText('꺼짐')).toBeInTheDocument();
    expect(
      summary().getByText(
        /지금은 면세 사이즈만 팝니다\. 관세사 확인 뒤 켜면 관부가세 예상액을 판매가에 넣습니다\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '아동 단어·실존 인물 차단어·고지 필수 블록은 더할 수만 있고 뺄 수 없습니다.',
      ),
    ).toBeInTheDocument();
  });

  it("'AI 엔진' 카드: 현재 Claude Code (sonnet), AI 엔진 설정 링크", async () => {
    stubSettings();
    await renderSettings();
    const card = within(screen.getByRole('region', { name: 'AI 엔진' }));
    expect(await card.findByText('Claude Code')).toBeInTheDocument();
    expect(card.getByText('(sonnet)')).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'AI 엔진 설정' })).toHaveAttribute(
      'href',
      '/settings/ai-engine',
    );
  });

  it('다른 엔진·모델이면 그대로 보인다(content.ai에서 읽는다)', async () => {
    const content = settingsContent();
    content.ai.engine = 'CODEX';
    (content.ai.models.CODEX as { text: string | null }).text = 'gpt-5-codex';
    stubSettings(settingsView({ content }));
    await renderSettings();
    const card = within(screen.getByRole('region', { name: 'AI 엔진' }));
    expect(await card.findByText('Codex')).toBeInTheDocument();
    expect(card.getByText('(gpt-5-codex)')).toBeInTheDocument();
  });

  it("'설정 파일 다시 읽기' → POST /settings-snapshots(X-AutoStore-Client), 성공하면 설정을 다시 읽는다", async () => {
    const api = stubSettings();
    api.on('POST /settings-snapshots', () => jsonResponse(settingsReloadResult(true), 201));
    await renderSettings();
    await checkCard().findByText('오류 없음');
    expect(getRequests(api, 'GET /settings')).toHaveLength(1);

    await userEvent.click(checkCard().getByRole('button', { name: '설정 파일 다시 읽기' }));

    const posts = getRequests(api, 'POST /settings-snapshots');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.headers.get('X-AutoStore-Client')).toBe('1');
    await waitFor(() => expect(getRequests(api, 'GET /settings')).toHaveLength(2));
    expect(await checkCard().findByRole('status')).toHaveTextContent(
      '새 설정을 적용했습니다 · 바뀐 칸 1개',
    );
  });

  it('같은 내용이면(200, created:false) 바뀐 내용이 없다고 알린다', async () => {
    const api = stubSettings();
    api.on('POST /settings-snapshots', () => jsonResponse(settingsReloadResult(false)));
    await renderSettings();
    await userEvent.click(await checkCard().findByRole('button', { name: '설정 파일 다시 읽기' }));
    expect(await checkCard().findByRole('status')).toHaveTextContent('바뀐 내용이 없습니다');
  });

  it('다시 읽기 422 → 봉투 message를 보이고, 검사 결과도 다시 읽는다', async () => {
    const api = stubSettings();
    api.on('POST /settings-snapshots', () =>
      errorResponse(
        422,
        'SAFETY_SETTING_RELAXATION_REJECTED',
        '안전 기준은 느슨하게 바꿀 수 없습니다(판정 유효 시간 늘리기).',
      ),
    );
    await renderSettings();
    await userEvent.click(await checkCard().findByRole('button', { name: '설정 파일 다시 읽기' }));
    expect(await checkCard().findByRole('alert')).toHaveTextContent(
      '안전 기준은 느슨하게 바꿀 수 없습니다(판정 유효 시간 늘리기).',
    );
    await waitFor(() => expect(getRequests(api, 'GET /settings')).toHaveLength(2));
  });

  it('503 SETTINGS_INVALID → blocked 안내 띠에 봉투 message, 검사 카드에 fieldErrors, 값은 —', async () => {
    stubApi({
      'GET /call-usage': () => jsonResponse(callUsageList()),
      'GET /settings': () =>
        errorResponse(503, 'SETTINGS_INVALID', INVALID_MESSAGE, {
          fieldErrors: [
            { field: '/', message: 'JSON 문법 오류: 6번째 줄 5번째 칸 근처를 확인해 주세요.' },
          ],
        }),
    });
    await renderSettings();
    const banner = await screen.findByText(INVALID_MESSAGE);
    expect(banner.closest('[role="status"]')).not.toBeNull();
    expect(checkCard().getByText('오류 1건')).toBeInTheDocument();
    expect(
      checkCard().getByText('JSON 문법 오류: 6번째 줄 5번째 칸 근처를 확인해 주세요.'),
    ).toBeInTheDocument();
    expect(summary().getAllByText('—').length).toBeGreaterThanOrEqual(7);
    expect(summary().queryByRole('switch')).toBeNull();
    // 고친 뒤 다시 읽을 수 있게 버튼은 남는다
    expect(checkCard().getByRole('button', { name: '설정 파일 다시 읽기' })).toBeEnabled();
  });

  it('SSE settings.reloaded가 오면 설정을 다시 읽는다', async () => {
    const api = stubSettings();
    await renderSettings({ EventSourceImpl: FakeEventSource });
    await checkCard().findByText('오류 없음');
    act(() => {
      FakeEventSource.latest().open();
      FakeEventSource.latest().emit('settings.reloaded', {
        settingsSnapshotId: null,
        changedKeys: [],
        valid: false,
        errors: ['/costs/cardSurchargePct: 숫자여야 합니다.'],
        rerunRequiredStepCount: 0,
      });
    });
    await waitFor(() => expect(getRequests(api, 'GET /settings')).toHaveLength(2));
  });
});
