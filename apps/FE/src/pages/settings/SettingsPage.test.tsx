import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { FakeEventSource } from '@/test/fakeEventSource';
import { callUsageList } from '@/test/fixtures/callUsage';
import {
  addressbookEntry,
  metaSyncStatusList,
  page,
  returnDeliveryCompanyEntry,
} from '@/test/fixtures/commerceMeta';
import { dispatchCompanyList, filledProfile } from '@/test/fixtures/purchaseAgencyProfile';
import {
  FX_FETCH_FAILED_WARNING,
  fxLatest,
  fxPage,
  rateTableDetail,
  rateTablePage,
  rateTableSummary,
} from '@/test/fixtures/pricing';
import { settingsContent, settingsReloadResult, settingsView } from '@/test/fixtures/settings';
import { renderRoute } from '@/test/renderRoute';

const INVALID_MESSAGE =
  '설정 파일에 오류가 있어 설정을 읽지 못했습니다. 설정 화면의 검사 결과를 확인해 주세요.';

/** 프로필 탭(P1-09)이 함께 부르는 API: 프로필(수입자까지 채움)·선택 목록·메타 동기화 상태 */
const PROFILE_TAB_ROUTES = {
  'GET /purchase-agency-profile': () => jsonResponse(filledProfile()),
  'GET /commerce-addressbooks': () => jsonResponse(page([addressbookEntry()])),
  'GET /commerce-return-delivery-companies': () =>
    jsonResponse(page([returnDeliveryCompanyEntry()])),
  'GET /dispatch-delivery-companies': () => jsonResponse(dispatchCompanyList()),
  'GET /commerce-meta-sync-runs/latest': () => jsonResponse(metaSyncStatusList()),
  // P2-04: 탭 캡션·요약의 배대지 요금표·환율
  'GET /fx-rates/latest': () => jsonResponse(fxLatest()),
  'GET /fx-rates': () => jsonResponse(fxPage()),
  'GET /forwarder-rate-tables': () => jsonResponse(rateTablePage([rateTableSummary()])),
  'GET /forwarder-rate-tables/1': () => jsonResponse(rateTableDetail()),
};

function stubSettings(view = settingsView()) {
  return stubApi({
    ...PROFILE_TAB_ROUTES,
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
  it('머리: 제목 "설정"과 시안 설명, 탭은 M1 3개만, 프로필 탭이면 되돌리기·저장', async () => {
    stubSettings();
    await renderSettings();
    expect(
      screen.getByText(
        '모든 상품에 공통으로 쓰는 값입니다. 저장할 때 형식을 검사하고, 안전장치를 끄거나 기준을 낮추는 값은 저장하지 않습니다.',
      ),
    ).toBeInTheDocument();
    const tabs = within(screen.getByRole('tablist', { name: '설정 항목' })).getAllByRole('tab');
    // 탭 캡션(보드): '요금표 v2026-09', '원가 8.76원/엔 · 09:00'(P2-04)
    await waitFor(() =>
      expect(tabs.map((t) => t.textContent)).toEqual([
        '구매대행 프로필',
        '비용·요금표요금표 v2026-09',
        '환율원가 8.76원/엔 · 09:00',
      ]),
    );
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('구매대행 프로필');
    // 머리의 '되돌리기'·'저장'은 구매대행 프로필 탭의 것이다(P1-09)
    expect(await screen.findByRole('button', { name: '저장' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '되돌리기' })).toBeInTheDocument();
    // D-30: 머리 오른쪽 [설정 마법사](시작 준비가 다 끝나도 늘 있다)
    expect(screen.getByRole('link', { name: '설정 마법사' })).toHaveAttribute('href', '/setup');
  });

  it('탭을 고르면 그 패널을 보인다(프로필 탭이 아니면 저장 버튼이 없고 [설정 마법사]는 남는다)', async () => {
    stubSettings();
    const { router } = await renderSettings();
    await userEvent.click(screen.getByRole('tab', { name: /^환율/ }));
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/^환율/);
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: '설정 마법사' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/setup'));
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
    await summary().findByText('v2026-09');
    await summary().findByText('8.76원/엔');
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
      'v2026-09',
      '15,000원',
      '8.76원/엔',
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
      '버전',
      '신발 박스 1.2kg',
      '원가 환율',
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
        '아동용 단어·실존 인물 차단어·고지 필수 블록은 더할 수만 있고 뺄 수 없습니다.',
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
      ...PROFILE_TAB_ROUTES,
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

  describe('P2-04 배대지 요금표·환율', () => {
    const rateTableGroup = () => within(summary().getByRole('region', { name: '배대지 요금표' }));
    const fxGroup = () => within(summary().getByRole('region', { name: '환율' }));

    it("요약 '배대지 요금표'·'환율' 묶음: 보드 문구(CSV 열 안내, 'HH:mm 자동 수집. …')와 단추", async () => {
      stubSettings();
      await renderSettings();
      expect(await rateTableGroup().findByText('v2026-09')).toBeInTheDocument();
      expect(
        rateTableGroup().getByText(
          'CSV 열: 무게 상한 · 요금 · 통화(엔/원) · 부피무게 나눗수 · 적용 조건',
        ),
      ).toBeInTheDocument();
      expect(rateTableGroup().getByRole('button', { name: 'CSV 가져오기' })).toBeInTheDocument();
      expect(await fxGroup().findByText('8.76원/엔')).toBeInTheDocument();
      expect(
        fxGroup().getByText(
          '09:00 자동 수집. 수집이 실패하면 마지막 값을 계속 쓰고 경고를 띄웁니다.',
        ),
      ).toBeInTheDocument();
      expect(fxGroup().getByRole('button', { name: '환율 직접 입력' })).toBeInTheDocument();
    });

    it("활성 요금표가 없으면 버전 '없음', 신발 박스는 기본값(가정값), 탭 캡션 '요금표 없음 · 기본값'", async () => {
      const api = stubSettings();
      api.on('GET /forwarder-rate-tables', () => jsonResponse(rateTablePage([])));
      await renderSettings();
      expect(await rateTableGroup().findByText('없음')).toBeInTheDocument();
      expect(rateTableGroup().getByText('15,000원 · 가정값')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /비용·요금표/ })).toHaveTextContent(
        '요금표 없음 · 기본값',
      );
    });

    it("요약 'CSV 가져오기' → 비용·요금표 탭(요금표 패널·구간 표), 파일 칸에 초점", async () => {
      stubSettings();
      await renderSettings();
      await userEvent.click(await rateTableGroup().findByRole('button', { name: 'CSV 가져오기' }));
      expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/^비용·요금표/);
      expect(await screen.findByRole('table', { name: '무게 구간' })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText('요금표 CSV')).toHaveFocus());
      expect(screen.queryByRole('button', { name: '저장' })).toBeNull();
    });

    it("요약 '환율 직접 입력' → 환율 탭(최신 3종·직접 입력·기록), 종류 칸에 초점. 경고가 있으면 띠", async () => {
      const api = stubSettings();
      api.on('GET /fx-rates/latest', () => jsonResponse(fxLatest([FX_FETCH_FAILED_WARNING])));
      await renderSettings();
      expect(
        await fxGroup().findByText('경고 1건 · 환율 탭에서 확인해 주세요'),
      ).toBeInTheDocument();
      await userEvent.click(fxGroup().getByRole('button', { name: '환율 직접 입력' }));
      expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/^환율/);
      const cells = within(await screen.findByRole('list', { name: '최신 환율' })).getAllByRole(
        'listitem',
      );
      expect(cells.map((c) => c.textContent)).toEqual([
        '원가 환율 · 자동 09:008.76원/엔직접 넣기',
        '과세환율(엔) · 자동 09:008.76원/엔직접 넣기',
        '과세환율(달러) · 자동 09:001,358.72원/달러직접 넣기',
      ]);
      expect(screen.getByText(FX_FETCH_FAILED_WARNING.message)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText('종류')).toHaveFocus());
      expect(await screen.findByRole('table', { name: '환율 기록' })).toBeInTheDocument();
    });

    it("과세환율(달러) '직접 넣기' → 입력 칸이 과세환율·달러·1달러로 바뀐다", async () => {
      stubSettings();
      await renderSettings();
      await userEvent.click(screen.getByRole('tab', { name: /^환율/ }));
      const cells = within(await screen.findByRole('list', { name: '최신 환율' })).getAllByRole(
        'listitem',
      );
      await userEvent.click(within(cells[2]!).getByRole('button', { name: '직접 넣기' }));
      expect(screen.getByLabelText('종류')).toHaveValue('CUSTOMS');
      expect(screen.getByLabelText('통화')).toHaveValue('USD');
      expect(screen.getByRole('radio', { name: '1달러' })).toBeChecked();
      expect(screen.getByRole('radio', { name: '100달러' })).toBeDisabled();
    });
  });
});
