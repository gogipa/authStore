import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import {
  emptyMetaSyncStatusList,
  metaSyncRun,
  metaSyncStatusList,
} from '@/test/fixtures/commerceMeta';
import { createTestQueryClient } from '@/test/renderRoute';
import { MetaSyncPanel, type MetaSyncPanelProps } from './MetaSyncPanel';

const LATEST = 'GET /commerce-meta-sync-runs/latest';
const START = 'POST /commerce-meta-sync-runs';
const AT = (hhmm: string) => `2026-09-28T${hhmm}:00.000+09:00`;

function renderPanel(props: MetaSyncPanelProps = {}) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MetaSyncPanel {...props} />
    </QueryClientProvider>,
  );
}

const panel = () => within(screen.getByRole('region', { name: '메타데이터 동기화' }));
const row = (key: string) =>
  screen.getByRole('region', { name: '메타데이터 동기화' }).querySelector(`[data-row="${key}"]`)!;
const requestsTo = (api: ReturnType<typeof stubApi>, method: string, path: string) =>
  api.requests.filter((r) => r.method === method && new URL(r.url).pathname === `/api/v1${path}`);

describe('MetaSyncPanel — 메타데이터 동기화(SCR-11 (3), P1-08)', () => {
  it('보드 그대로: 카테고리·주소록·택배사 줄, 성공 칩, 09:10, 캡션', async () => {
    stubApi({ [LATEST]: () => jsonResponse(metaSyncStatusList()) });
    renderPanel();
    expect(await panel().findByText('카테고리')).toBeInTheDocument();
    const items = panel().getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      '카테고리성공09:10',
      '주소록성공09:10',
      '택배사성공09:10',
    ]);
    expect(
      panel().getByText('하루 한 번 자동으로 받습니다 · 마지막 09:10 성공'),
    ).toBeInTheDocument();
    expect(panel().getByRole('button', { name: '지금 동기화' })).toBeEnabled();
  });

  it('성공·실패·동기화 중이 섞이면 줄마다 상태·시각. 묶은 줄의 실패는 대상별로 펼쳐 본다', async () => {
    stubApi({
      [LATEST]: () =>
        jsonResponse(
          metaSyncStatusList(
            {
              CATEGORY_DETAIL: metaSyncRun('CATEGORY_DETAIL', 'FAILED', AT('10:00')),
              ADDRESSBOOK: metaSyncRun('ADDRESSBOOK', 'FAILED', AT('10:02')),
              RETURN_DELIVERY_COMPANY: metaSyncRun(
                'RETURN_DELIVERY_COMPANY',
                'RUNNING',
                AT('10:05'),
              ),
            },
            { RETURN_DELIVERY_COMPANY: AT('09:10') },
          ),
        ),
    });
    renderPanel();
    await panel().findByText('카테고리');
    expect(row('category')).toHaveAttribute('data-state', 'failed');
    // 줄 머리: 이름·칩·시각(묶은 줄은 가장 늦게 끝난 실패 시각)
    expect(row('category').firstElementChild).toHaveTextContent('카테고리실패10:00');
    expect(row('addressbook').firstElementChild).toHaveTextContent('주소록실패10:02');
    expect(
      within(row('addressbook') as HTMLElement).getByText(
        '커머스API 응답 오류(HTTP 500 · GW.INTERNAL_SERVER_ERROR)',
      ),
    ).toBeInTheDocument();
    expect(row('returnDeliveryCompany').firstElementChild).toHaveTextContent(
      '택배사동기화 중10:05',
    );

    const category = within(row('category') as HTMLElement);
    expect(category.getByText('6개 중 1개 실패')).toBeInTheDocument();
    const toggle = category.getByRole('button', { name: /펼치기/ });
    expect(category.queryByText('카테고리 상세')).not.toBeVisible();
    await userEvent.click(toggle);
    expect(category.getByText('카테고리 상세')).toBeVisible();
    expect(category.getByText('원산지 코드')).toBeVisible();
    expect(category.getAllByText('성공')).toHaveLength(5);
    expect(
      (row('category').querySelector('[data-target="CATEGORY_DETAIL"]') as HTMLElement).textContent,
    ).toBe('카테고리 상세실패10:00커머스API 응답 오류(HTTP 500 · GW.INTERNAL_SERVER_ERROR)');
  });

  it("'지금 동기화' → POST /commerce-meta-sync-runs 1회(본문 {}), 끝나면 상태를 다시 읽는다", async () => {
    const api = stubApi({
      [LATEST]: () => jsonResponse(metaSyncStatusList()),
      [START]: () => jsonResponse({ items: [metaSyncRun('CATEGORY', 'RUNNING')] }, 202),
    });
    renderPanel();
    await userEvent.click(await panel().findByRole('button', { name: '지금 동기화' }));
    await waitFor(() =>
      expect(requestsTo(api, 'POST', '/commerce-meta-sync-runs')).toHaveLength(1),
    );
    const post = requestsTo(api, 'POST', '/commerce-meta-sync-runs')[0]!;
    expect(await post.clone().json()).toEqual({});
    await waitFor(() =>
      expect(requestsTo(api, 'GET', '/commerce-meta-sync-runs/latest')).toHaveLength(2),
    );
  });

  it('RUNNING이 있으면 버튼을 끄고 이유를 보인다', async () => {
    stubApi({
      [LATEST]: () =>
        jsonResponse(
          metaSyncStatusList({ CATEGORY: metaSyncRun('CATEGORY', 'RUNNING', AT('10:05')) }),
        ),
    });
    renderPanel();
    await panel().findByText('동기화 중');
    const button = panel().getByRole('button', { name: '지금 동기화' });
    expect(button).toBeDisabled();
    const reason = panel().getByText('동기화 중입니다. 끝나면 다시 누를 수 있습니다.');
    expect(button).toHaveAttribute('aria-describedby', reason.id);
  });

  it('409 SECRET_NOT_CONFIGURED면 message와 키 입력 링크(화면이 넣은 슬롯)', async () => {
    stubApi({
      [LATEST]: () => jsonResponse(emptyMetaSyncStatusList()),
      [START]: () =>
        errorResponse(
          409,
          'SECRET_NOT_CONFIGURED',
          '커머스API client_id·client_secret 키가 아직 없습니다. 시스템 상태 화면에서 넣어 주세요.',
          { details: { secretKeys: ['COMMERCE_CLIENT_ID', 'COMMERCE_CLIENT_SECRET'] } },
        ),
    });
    let received: string[] = [];
    renderPanel({
      renderSecretLink: (keys) => {
        received = keys;
        return <a href="#secret-COMMERCE_CLIENT_ID">키 입력으로 가기</a>;
      },
    });
    expect(
      await panel().findByText('하루 한 번 자동으로 받습니다 · 아직 받은 적이 없습니다'),
    ).toBeInTheDocument();
    expect(panel().getAllByText('받기 전')).toHaveLength(3);
    await userEvent.click(panel().getByRole('button', { name: '지금 동기화' }));
    const alert = await panel().findByRole('alert');
    expect(alert).toHaveTextContent(
      '커머스API client_id·client_secret 키가 아직 없습니다. 시스템 상태 화면에서 넣어 주세요.',
    );
    expect(within(alert).getByRole('link', { name: '키 입력으로 가기' })).toBeInTheDocument();
    expect(received).toEqual(['COMMERCE_CLIENT_ID', 'COMMERCE_CLIENT_SECRET']);
  });

  it('409 ALREADY_IN_PROGRESS는 message만(키 링크 없음)', async () => {
    stubApi({
      [LATEST]: () => jsonResponse(metaSyncStatusList()),
      [START]: () =>
        errorResponse(
          409,
          'ALREADY_IN_PROGRESS',
          '메타데이터 동기화가 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
          { details: { job: 'META_SYNC', targets: ['CATEGORY'] } },
        ),
    });
    renderPanel({ renderSecretLink: () => <a href="#keys">키 입력으로 가기</a> });
    await userEvent.click(await panel().findByRole('button', { name: '지금 동기화' }));
    const alert = await panel().findByRole('alert');
    expect(alert).toHaveTextContent('메타데이터 동기화가 이미 진행 중입니다.');
    expect(within(alert).queryByRole('link')).toBeNull();
  });
});
