import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORK_FLOW_HIDDEN_KEY } from '@/features/guide';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import { registrationSwitch } from '@/test/fixtures/registration';
import { renderRoute } from '@/test/renderRoute';

afterEach(() => window.localStorage.clear());

function stubNav() {
  return stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList()),
    'GET /registration-switch': () => jsonResponse(registrationSwitch(true)),
  });
}

describe('사용 안내(SCR-14 /guide, F-GD-01)', () => {
  it('머리·작업 흐름·하루 작업 순서·화면 안내·안전장치·학습 끄기를 보이고, API는 내비 것만 부른다', async () => {
    const api = stubNav();
    renderRoute('/guide');
    expect(await screen.findByRole('heading', { level: 1, name: '사용 안내' })).toBeInTheDocument();
    expect(document.title).toBe('사용 안내 · 스마트스토어 정복');
    for (const [id, name] of [
      ['flow', '작업 흐름'],
      ['day', '하루 작업 순서'],
      ['screens', '화면 안내'],
      ['safety', '안전장치'],
      ['training', 'AI 계정 학습 끄기'],
    ]) {
      expect(screen.getByRole('region', { name })).toHaveAttribute('id', id);
    }
    // 사용 안내에서는 작업 흐름을 숨길 수 없다
    const flow = within(screen.getByRole('region', { name: '작업 흐름' }));
    expect(flow.queryByRole('button', { name: '다시 보지 않기' })).toBeNull();
    expect(flow.getAllByRole('tab')).toHaveLength(10);

    const day = within(screen.getByRole('region', { name: '하루 작업 순서' }));
    expect(day.getAllByRole('listitem').length).toBeGreaterThanOrEqual(5);
    expect(day.getByRole('link', { name: '검색어·URL로 시작' })).toHaveAttribute(
      'href',
      '/candidates?runnableStep=SOURCING',
    );

    const safety = within(screen.getByRole('region', { name: '안전장치' }));
    expect(safety.getByRole('heading', { name: '등록 API 차단 스위치' })).toHaveAttribute(
      'id',
      'kill-switch',
    );
    expect(safety.getByText(/G4 최종 승인: .*건너뛸 수 없습니다/)).toBeInTheDocument();

    const training = within(screen.getByRole('region', { name: 'AI 계정 학습 끄기' }));
    expect(training.getByText(/Help improve Claude/)).toBeInTheDocument();
    expect(training.getByText(/Enable Telemetry/)).toBeInTheDocument();
    expect(training.getByText(/Improve the model for everyone/)).toBeInTheDocument();

    const screens = within(screen.getByRole('region', { name: '화면 안내' }));
    expect(screens.getByRole('link', { name: 'AI 엔진' })).toHaveAttribute(
      'href',
      '/settings/ai-engine',
    );

    const paths = api.requests.map((r) => new URL(r.url).pathname.replace('/api/v1', ''));
    expect(new Set(paths)).toEqual(new Set(['/call-usage', '/registration-switch']));
  });

  it('주소 조각(#training)으로 오면 그 패널로 옮긴다', async () => {
    // jsdom에는 scrollIntoView가 없다(화면은 `?.`로 부른다) — 이 테스트에서만 넣고 뺀다
    const scrolled: string[] = [];
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(function (this: Element) {
        scrolled.push(this.id);
      }),
    });
    try {
      stubNav();
      renderRoute('/guide#training');
      await screen.findByRole('heading', { level: 1, name: '사용 안내' });
      await waitFor(() => expect(scrolled).toContain('training'));
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("대시보드에서 숨긴 작업 흐름은 여기서 '대시보드에 다시 보이기'로 되돌린다", async () => {
    window.localStorage.setItem(WORK_FLOW_HIDDEN_KEY, '1');
    stubNav();
    renderRoute('/guide');
    const flow = within(await screen.findByRole('region', { name: '작업 흐름' }));
    await userEvent.click(flow.getByRole('button', { name: '대시보드에 다시 보이기' }));
    expect(window.localStorage.getItem(WORK_FLOW_HIDDEN_KEY)).toBeNull();
    expect(flow.getByRole('status')).toHaveTextContent('대시보드에 다시 보입니다.');
  });
});
