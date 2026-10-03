import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { aiCliCheckLatestList, aiCliCheckPage } from '@/test/fixtures/aiEngine';
import { callUsageList } from '@/test/fixtures/callUsage';
import { childTermList, collectionStatus, keywordSnapshotPage } from '@/test/fixtures/keywords';
import { filledProfile } from '@/test/fixtures/purchaseAgencyProfile';
import { registrationSwitch } from '@/test/fixtures/registration';
import { settingsView } from '@/test/fixtures/settings';
import { page, statusCounts } from '@/test/fixtures/stepEngine';
import { secretStatusList } from '@/test/fixtures/system';
import { renderRoute } from '@/test/renderRoute';

/**
 * D-29 사용 안내(1~4)를 화면을 가로질러 본다: 대시보드 카드 순서, 모든 화면의 '?' 도움말, 빈 상태 다음 행동 버튼.
 * 카드·도움말 부품 자체는 features/guide·shared/ui 테스트가 본다.
 */
afterEach(() => window.localStorage.clear());

const START_PATH = '/candidates?runnableStep=SOURCING';

function stubEmptyDashboard() {
  return stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList()),
    'GET /settings': () => jsonResponse(settingsView()),
    'GET /candidates': () => jsonResponse(page([])),
    'GET /candidates/resume-target': () => new Response(null, { status: 204 }),
    'GET /candidate-steps': () => jsonResponse(page([])),
    'GET /secrets': () => jsonResponse(secretStatusList()),
    'GET /ai-cli-checks/latest': () => jsonResponse(aiCliCheckLatestList()),
    'GET /ai-cli-checks': () => jsonResponse(aiCliCheckPage()),
    'GET /purchase-agency-profile': () => jsonResponse(filledProfile()),
    'GET /registration-switch': () => jsonResponse(registrationSwitch(true)),
  });
}

describe('대시보드의 사용 안내(F-DB-10·F-DB-11)', () => {
  it("머리 아래 맨 위에 '시작 준비', 그 아래 '작업 흐름', 그 아래 기존 표 순서다", async () => {
    stubEmptyDashboard();
    renderRoute('/');
    const readiness = await screen.findByRole('region', { name: '시작 준비' });
    const flow = screen.getByRole('region', { name: '작업 흐름' });
    const table = screen.getByRole('table', { name: '재실행 필요·멈춘 후보' });
    const heading = screen.getByRole('heading', { level: 1, name: '대시보드' });
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(heading, readiness)).toBe(true);
    expect(follows(readiness, flow)).toBe(true);
    expect(follows(flow, table)).toBe(true);
    expect(await within(readiness).findByText('5개 중 4개 완료')).toBeInTheDocument();
  });

  it('진행 중 후보가 없으면 표 안에 다음 행동 버튼 두 개(키워드 열기·검색어·URL로 시작)', async () => {
    stubEmptyDashboard();
    renderRoute('/');
    const progress = within(await screen.findByRole('table', { name: '진행 중 후보' }));
    expect(await progress.findByText('진행 중인 후보가 없습니다.')).toBeInTheDocument();
    expect(progress.getByRole('link', { name: '키워드 열기' })).toHaveAttribute(
      'href',
      '/keywords',
    );
    expect(progress.getByRole('link', { name: '검색어·URL로 시작' })).toHaveAttribute(
      'href',
      START_PATH,
    );
  });

  it("'?'를 누르면 대시보드 도움말(할 일·다음 단계·자주 막히는 곳)이 머리 아래에 열린다", async () => {
    stubEmptyDashboard();
    renderRoute('/');
    await screen.findByRole('heading', { level: 1, name: '대시보드' });
    await userEvent.click(screen.getByRole('button', { name: '이 화면 도움말' }));
    const help = within(screen.getByRole('region', { name: '이 화면 도움말' }));
    expect(help.getByRole('heading', { name: '이 화면에서 할 일' })).toBeInTheDocument();
    expect(help.getByRole('heading', { name: '다음 단계' })).toBeInTheDocument();
    expect(help.getByRole('heading', { name: '자주 막히는 곳' })).toBeInTheDocument();
    expect(help.getByText('시작 준비가 모두 끝났는지 봅니다.')).toBeInTheDocument();
    expect(help.getByRole('link', { name: '키워드' })).toHaveAttribute('href', '/keywords');
  });
});

describe("모든 화면에 '?' 도움말이 하나씩 있다(F-GD-02)", () => {
  it.each([
    ['/', '대시보드', '시작 준비가 모두 끝났는지 봅니다.'],
    ['/keywords', '키워드', '표에서 키워드를 고르고 [검색어로 쓰기]를 누릅니다.'],
    ['/candidates', '후보 작업', '팔지 않을 후보는 [후보 제외]합니다.'],
    ['/candidates/7/sourcing', '라쿠텐 후보 비교', '재고를 확인하지 않은 행은 고를 수 없습니다.'],
    [
      '/candidates/7/judgement',
      '판정 · 소싱 확정 · 카테고리',
      '국내 기준가가 없으면 판정할 수 없습니다.',
    ],
    [
      '/candidates/7/thumbnail',
      '썸네일 스튜디오',
      '프롬프트에 실존 인물 이름이 있으면 만들 수 없습니다.',
    ],
    ['/candidates/7/content', '상세 콘텐츠', '원산지가 정해지지 않으면 승인할 수 없습니다.'],
    ['/candidates/7/tags', '태그', '최종 태그 10개를 확인하고 고칩니다.'],
    ['/candidates/7/approval', '최종 승인', '[승인·등록]을 누릅니다(G4).'],
    ['/products', '등록 상품', '등록 상품 화면은 M2에서 만듭니다.'],
    ['/settings', '설정', '배대지 요금표 CSV를 가져옵니다.'],
    ['/settings/ai-engine', 'AI 엔진', '통과한 뒤 [저장]합니다.'],
    ['/system', '시스템 상태', 'AI 도구 상태를 봅니다.'],
    ['/guide', '사용 안내', 'AI 계정 학습 끄는 곳을 확인합니다.'],
  ])('%s(%s)', async (path, title, line) => {
    renderRoute(path);
    await screen.findByRole('heading', { level: 1, name: title });
    const buttons = screen.getAllByRole('button', { name: '이 화면 도움말' });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(buttons[0]!);
    const help = within(screen.getByRole('region', { name: '이 화면 도움말' }));
    expect(help.getByText(line)).toBeInTheDocument();
  });
});

describe('빈 상태 다음 행동(F-GD-03)', () => {
  it('후보가 하나도 없으면 후보 목록 자리에 키워드 열기·검색어·URL로 시작', async () => {
    stubApi({
      'GET /call-usage': () => jsonResponse(callUsageList()),
      'GET /candidates/status-counts': () => jsonResponse(statusCounts()),
      'GET /candidates': () => jsonResponse(page([])),
    });
    renderRoute('/candidates');
    const list = within(await screen.findByRole('region', { name: '후보' }));
    expect(await list.findByText('진행 중인 후보가 없습니다.')).toBeInTheDocument();
    expect(list.getByRole('link', { name: '키워드 열기' })).toHaveAttribute('href', '/keywords');
    expect(list.getByRole('link', { name: '검색어·URL로 시작' })).toHaveAttribute(
      'href',
      START_PATH,
    );
  });

  it("다른 필터에서 비면 버튼 없이 '이 조건의 후보가 없습니다.'", async () => {
    stubApi({
      'GET /call-usage': () => jsonResponse(callUsageList()),
      'GET /candidates/status-counts': () => jsonResponse(statusCounts()),
      'GET /candidates': () => jsonResponse(page([])),
    });
    renderRoute('/candidates?status=EXCLUDED');
    const list = within(await screen.findByRole('region', { name: '후보' }));
    expect(await list.findByText('이 조건의 후보가 없습니다.')).toBeInTheDocument();
    expect(list.queryByRole('link', { name: '키워드 열기' })).toBeNull();
  });

  it("'입력 고르기'에 실행할 수 있는 후보가 없으면 이유와 '후보 목록 보기'", async () => {
    stubApi({
      'GET /call-usage': () => jsonResponse(callUsageList()),
      'GET /candidates/status-counts': () => jsonResponse(statusCounts()),
      'GET /candidates': () => jsonResponse(page([])),
    });
    renderRoute('/candidates?runnableStep=PRICING');
    const picker = within(await screen.findByRole('region', { name: '입력 고르기' }));
    expect(
      await picker.findByText('지금 ③ 판정 단계를 실행할 수 있는 후보가 없습니다.'),
    ).toBeInTheDocument();
    expect(picker.getByText('앞 단계를 먼저 끝낸 후보가 여기에 보입니다.')).toBeInTheDocument();
    expect(picker.getByRole('link', { name: '후보 목록 보기' })).toHaveAttribute(
      'href',
      '/candidates',
    );
  });

  it('키워드 묶음이 없으면 표 안에 키워드 없이 시작하는 버튼', async () => {
    stubApi({
      'GET /call-usage': () => jsonResponse(callUsageList()),
      'GET /keyword-snapshots': () => jsonResponse(keywordSnapshotPage([])),
      'GET /keyword-collection-status': () =>
        jsonResponse(collectionStatus({ lastKeywordSnapshotId: null, lastCollectedAt: null })),
      'GET /child-keyword-terms': () => jsonResponse(childTermList()),
    });
    renderRoute('/keywords');
    expect(await screen.findByText('아직 키워드가 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '검색어·URL로 시작' })).toHaveAttribute(
      'href',
      START_PATH,
    );
  });

  it('등록 상품(M2)은 지금 할 곳을 말하고 후보 작업으로 잇는다', async () => {
    renderRoute('/products');
    await screen.findByRole('heading', { level: 1, name: '등록 상품' });
    const panel = within(screen.getByRole('region', { name: '준비 중' }));
    expect(panel.getByText('등록 상품 화면은 M2에서 만듭니다.')).toBeInTheDocument();
    expect(panel.getByRole('link', { name: '후보 작업 열기' })).toHaveAttribute(
      'href',
      '/candidates',
    );
  });
});

describe('후보 작업 틀의 도움말 자리', () => {
  it("단계 화면의 '?'는 후보 머리 오른쪽('후보 목록' 앞)에 있다", async () => {
    renderRoute('/candidates/7/tags');
    await screen.findByRole('heading', { level: 1, name: '태그' });
    const header = within(screen.getByRole('region', { name: '후보 정보' }));
    const help = header.getByRole('button', { name: '이 화면 도움말' });
    const back = header.getByRole('link', { name: '후보 목록' });
    expect(Boolean(help.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true,
    );
    await waitFor(() => expect(help).toHaveAttribute('aria-expanded', 'false'));
  });

  it("다른 단계로 옮기면 열어 둔 '?' 판이 닫힌 채로 열린다(틀은 그대로라도, 화면시안_명세 §8.5)", async () => {
    const { router } = renderRoute('/candidates/7/tags');
    await screen.findByRole('heading', { level: 1, name: '태그' });
    const helpButton = () =>
      within(screen.getByRole('region', { name: '후보 정보' })).getByRole('button', {
        name: '이 화면 도움말',
      });
    await userEvent.click(helpButton());
    expect(helpButton()).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(screen.getByRole('region', { name: '이 화면 도움말' })).getByText(
        '최종 태그 10개를 확인하고 고칩니다.',
      ),
    ).toBeInTheDocument();

    await act(() => router.navigate('/candidates/7/content'));
    await screen.findByRole('heading', { level: 1, name: '상세 콘텐츠' });
    expect(helpButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: '이 화면 도움말' })).toBeNull();

    // 다시 열면 지금 단계(⑥) 도움말이다
    await userEvent.click(helpButton());
    expect(
      within(screen.getByRole('region', { name: '이 화면 도움말' })).getByText(
        '원산지가 정해지지 않으면 승인할 수 없습니다.',
      ),
    ).toBeInTheDocument();

    // 다른 후보로 옮겨도 닫힌다
    await act(() => router.navigate('/candidates/8/content'));
    await waitFor(() => expect(helpButton()).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.queryByRole('region', { name: '이 화면 도움말' })).toBeNull();
  });
});
