import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { FakeEventSource } from '@/test/fakeEventSource';
import { callUsageChanged, callUsageList } from '@/test/fixtures/callUsage';
import { renderRoute } from '@/test/renderRoute';

const NAV_LABELS = [
  '대시보드',
  '키워드',
  '후보 작업',
  '등록 상품',
  '설정',
  'AI 엔진',
  '시스템 상태',
];

function mainNav() {
  return screen.getByRole('navigation', { name: '주 메뉴' });
}

/** 내비 상태 상자의 '오늘 페이지 조회 …' 줄(글이 여러 요소로 나뉘어 textContent로 찾는다). */
function pageFetchLine(text: string) {
  return within(mainNav()).getByText(
    (_, element) => element?.tagName === 'SPAN' && element.textContent === text,
  );
}

describe('왼쪽 내비', () => {
  it('시안 순서대로 항목을 보여 준다(아이콘은 Icon 부품, 하위 항목 AI 엔진은 아이콘 없음)', () => {
    renderRoute('/');
    const links = within(mainNav()).getAllByRole('link');
    expect(links.map((a) => a.textContent?.trim())).toEqual(NAV_LABELS);
    expect(links.map((a) => a.querySelector('svg')?.getAttribute('data-icon') ?? null)).toEqual([
      'grid',
      'search',
      'list',
      'package',
      'sliders',
      null,
      'activity',
    ]);
  });

  it('AI 엔진 하위 항목은 /settings/ai-engine으로 간다', () => {
    renderRoute('/');
    const link = within(mainNav()).getByRole('link', { name: 'AI 엔진' });
    expect(link).toHaveAttribute('href', '/settings/ai-engine');
  });

  it('AI 엔진 화면에서는 AI 엔진만 현재 항목이고 설정은 아니다', () => {
    renderRoute('/settings/ai-engine');
    const nav = within(mainNav());
    expect(nav.getByRole('link', { name: 'AI 엔진' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: '설정' })).not.toHaveAttribute('aria-current');
  });

  it('단계 화면에서는 후보 작업이 현재 항목이다', () => {
    renderRoute('/candidates/7/judgement');
    const nav = within(mainNav());
    expect(nav.getByRole('link', { name: '후보 작업' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: '대시보드' })).not.toHaveAttribute('aria-current');
  });

  it('대시보드(/)는 정확히 / 일 때만, 설정은 /settings일 때만 현재 항목이다(05-2 layout §5)', () => {
    renderRoute('/settings');
    const nav = within(mainNav());
    expect(nav.getByRole('link', { name: '설정' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: 'AI 엔진' })).not.toHaveAttribute('aria-current');
    expect(nav.getByRole('link', { name: '대시보드' })).not.toHaveAttribute('aria-current');
  });
});

describe('내비 상태 상자(오늘 페이지 조회)', () => {
  it('RAKUTEN_PAGE 38/110을 받으면 "오늘 페이지 조회 38/110"을 보인다', async () => {
    const api = stubApi({ 'GET /call-usage': () => jsonResponse(callUsageList(38)) });
    renderRoute('/');
    await waitFor(() => expect(pageFetchLine('오늘 페이지 조회 38/110')).toBeInTheDocument());
    expect(api.requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      'GET /api/v1/call-usage',
    ]);
    // 등록 차단 칩은 getRegistrationSwitch(P4-03)를 붙일 때까지 지금 문구를 둔다.
    expect(within(mainNav()).getByText('등록 API 차단 · 확인 전')).toBeInTheDocument();
  });

  it('call-usage.changed 알림 뒤 다시 읽어 39/110으로 바뀐다(폴링 없음)', async () => {
    let count = 38;
    const api = stubApi({ 'GET /call-usage': () => jsonResponse(callUsageList(count)) });
    renderRoute('/', { EventSourceImpl: FakeEventSource });
    await waitFor(() => expect(pageFetchLine('오늘 페이지 조회 38/110')).toBeInTheDocument());
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.latest().url).toBe('/api/v1/events');

    count = 39;
    act(() => FakeEventSource.latest().emit('call-usage.changed', callUsageChanged(39)));

    await waitFor(() => expect(pageFetchLine('오늘 페이지 조회 39/110')).toBeInTheDocument());
    expect(api.requests).toHaveLength(2);
  });

  it('API가 실패하면 "—"를 보인다', async () => {
    const api = stubApi({
      'GET /call-usage': () => errorResponse(500, 'INTERNAL_ERROR', '서버 오류가 났습니다.'),
    });
    renderRoute('/');
    await waitFor(() => expect(api.requests).toHaveLength(1));
    await waitFor(() => expect(pageFetchLine('오늘 페이지 조회 —')).toBeInTheDocument());
  });

  it('받기 전에도 "—"를 보인다', () => {
    stubApi({ 'GET /call-usage': () => new Promise<Response>(() => {}) });
    renderRoute('/');
    expect(pageFetchLine('오늘 페이지 조회 —')).toBeInTheDocument();
  });
});
