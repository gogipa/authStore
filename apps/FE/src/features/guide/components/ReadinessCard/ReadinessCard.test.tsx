import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi, type StubRoutes } from '@/test/apiStub';
import {
  aiCliCheck,
  aiCliCheckLatestList,
  aiCliCheckPage,
  boardChecks,
} from '@/test/fixtures/aiEngine';
import { emptyProfile, filledProfile } from '@/test/fixtures/purchaseAgencyProfile';
import { registrationSwitch } from '@/test/fixtures/registration';
import { secretStatusList } from '@/test/fixtures/system';
import { createTestQueryClient } from '@/test/renderRoute';
import { ReadinessCard } from './ReadinessCard';

function renderCard() {
  const router = createMemoryRouter([{ path: '/', element: <ReadinessCard /> }]);
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const agyPassed = aiCliCheck({ engineCode: 'AGY', cliVersion: '1.2.9' });

function routes(overrides: StubRoutes = {}): StubRoutes {
  return {
    'GET /secrets': () => jsonResponse(secretStatusList()),
    'GET /ai-cli-checks/latest': () =>
      jsonResponse(aiCliCheckLatestList({ ...boardChecks(), AGY: agyPassed })),
    'GET /ai-cli-checks': () => jsonResponse(aiCliCheckPage()),
    'GET /purchase-agency-profile': () => jsonResponse(filledProfile()),
    'GET /registration-switch': () => jsonResponse(registrationSwitch(true)),
    ...overrides,
  };
}

const card = () => within(screen.getByRole('region', { name: '시작 준비' }));
const itemsList = () => within(card().getByRole('list', { name: '시작 준비' }));
const item = (key: string) =>
  itemsList()
    .getAllByRole('listitem')
    .find((li) => li.getAttribute('data-item') === key)!;

describe("대시보드 '시작 준비' 카드(F-DB-10, D-29)", () => {
  it('받는 중이면 다섯 항목 모두 확인 중이고 펼쳐져 있다', async () => {
    const never = () => new Promise<Response>(() => {});
    stubApi({
      'GET /secrets': never,
      'GET /ai-cli-checks/latest': never,
      'GET /ai-cli-checks': never,
      'GET /purchase-agency-profile': never,
      'GET /registration-switch': never,
    });
    renderCard();
    expect(await screen.findByText('5개 중 0개 완료')).toBeInTheDocument();
    expect(itemsList().getAllByText('확인 중')).toHaveLength(5);
    expect(card().getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true');
    expect(card().getByText('확인 전입니다.')).toBeInTheDocument();
    // 받는 중에는 [설정 마법사]를 아직 두지 않는다(다 끝났을 수도 있다)
    expect(card().queryByRole('link', { name: '설정 마법사' })).toBeNull();
  });

  it('조회가 실패한 항목은 확인 못함과 서버 문구를 보이고 펼친 채로 둔다', async () => {
    stubApi(
      routes({
        'GET /secrets': () =>
          errorResponse(503, 'KEYCHAIN_UNAVAILABLE', '키체인을 열 수 없습니다.'),
      }),
    );
    renderCard();
    expect(await screen.findByText('5개 중 3개 완료')).toBeInTheDocument();
    expect(within(item('COMMERCE_KEYS')).getByText('확인 못함')).toBeInTheDocument();
    expect(within(item('COMMERCE_KEYS')).getByText('키체인을 열 수 없습니다.')).toBeInTheDocument();
    expect(card().getByRole('button', { name: '접기' })).toBeInTheDocument();
    // '확인 못함'이 남아 있어도 [설정 마법사](D-30)
    expect(card().getByRole('link', { name: '설정 마법사' })).toHaveAttribute('href', '/setup');
  });

  it('일부만 됐으면 항목별 할 일과 고칠 곳 링크, 세지 않는 참고 줄 2개를 보인다', async () => {
    stubApi(
      routes({
        'GET /secrets': () =>
          jsonResponse(secretStatusList(['RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY'])),
        'GET /ai-cli-checks/latest': () => jsonResponse(aiCliCheckLatestList()),
        'GET /purchase-agency-profile': () => jsonResponse(emptyProfile()),
      }),
    );
    renderCard();
    expect(await screen.findByText('5개 중 2개 완료')).toBeInTheDocument();
    // 할 일이 남아 있는 동안 카드 머리에 [설정 마법사](D-30)
    expect(card().getByRole('link', { name: '설정 마법사' })).toHaveAttribute('href', '/setup');
    const commerce = within(item('COMMERCE_KEYS'));
    expect(commerce.getByText('할 일')).toBeInTheDocument();
    expect(
      commerce.getByText('빠진 키: client_id, client_secret. 시스템 상태에서 넣어 주세요.'),
    ).toBeInTheDocument();
    expect(commerce.getByRole('link', { name: '키 넣기' })).toHaveAttribute(
      'href',
      '/system#secret-COMMERCE_CLIENT_ID',
    );
    expect(within(item('RAKUTEN_KEYS')).getByText('완료')).toBeInTheDocument();
    expect(within(item('AI_ENGINE')).getByText('완료')).toBeInTheDocument();
    expect(within(item('IMAGE_TOOL')).getByText('할 일')).toBeInTheDocument();
    expect(within(item('PROFILE')).getByRole('link', { name: '설정' })).toHaveAttribute(
      'href',
      '/settings',
    );
    // 세지 않는 줄: 등록 API 차단(켜짐) · 학습 끄기(앱이 확인할 수 없음)
    expect(
      card().getByText('켜짐 · 승인해도 실제로 등록하지 않고 요청 내용만 저장합니다(드라이런).'),
    ).toBeInTheDocument();
    expect(card().getByRole('link', { name: '뜻 보기' })).toHaveAttribute('href', '/guide#safety');
    expect(card().getByRole('link', { name: '끄는 곳' })).toHaveAttribute(
      'href',
      '/guide#training',
    );
  });

  it('모두 끝나면 한 줄로 접히고, [펼치기]로 항목을 다시 본다', async () => {
    stubApi(routes({ 'GET /registration-switch': () => jsonResponse(registrationSwitch(false)) }));
    renderCard();
    expect(await screen.findByText('5개 중 5개 완료')).toBeInTheDocument();
    const expand = await card().findByRole('button', { name: '펼치기' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(card().queryByRole('link', { name: '설정 마법사' })).toBeNull();
    expect(
      card().getByText('준비를 모두 마쳤습니다. 펼치면 항목을 다시 봅니다.'),
    ).toBeInTheDocument();
    const region = document.getElementById(expand.getAttribute('aria-controls')!);
    expect(region).not.toBeVisible();

    await userEvent.click(expand);
    expect(card().getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true');
    expect(region).toBeVisible();
    expect(itemsList().getAllByText('완료')).toHaveLength(5);
    expect(card().getByText('꺼짐 · 승인하면 실제 스마트스토어에 등록합니다.')).toBeInTheDocument();
  });
});
