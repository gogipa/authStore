import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import {
  addressbookEntry,
  metaSyncStatusList,
  page,
  returnDeliveryCompanyEntry,
} from '@/test/fixtures/commerceMeta';
import {
  dispatchCompanyList,
  emptyProfile,
  filledProfile,
  profileSaveResult,
} from '@/test/fixtures/purchaseAgencyProfile';
import { settingsView } from '@/test/fixtures/settings';
import { renderRoute } from '@/test/renderRoute';

type Profile = ReturnType<typeof filledProfile>;

const OVERSEAS = addressbookEntry();
const DOMESTIC = addressbookEntry({
  id: 2,
  addressBookNo: '100000002',
  name: '[국내 반품지]',
  addressType: 'REFUND_OR_EXCHANGE',
  isOverseas: false,
});

const IMPORTER_TEXT =
  '수입자가 비어 있어 ⑥-3을 시작할 수 없습니다. 수입자를 넣고 저장해 주세요. 기본값은 없습니다.';

function stubProfileTab(
  options: {
    profile?: Profile;
    addressbooks?: ReturnType<typeof addressbookEntry>[];
  } = {},
) {
  const addressbooks = options.addressbooks ?? [OVERSEAS, DOMESTIC];
  return stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList()),
    'GET /settings': () => jsonResponse(settingsView()),
    'GET /purchase-agency-profile': () => jsonResponse(options.profile ?? filledProfile()),
    'GET /commerce-addressbooks': (req) => {
      const overseas = new URL(req.url).searchParams.get('overseas') === 'true';
      return jsonResponse(page(overseas ? addressbooks.filter((a) => a.isOverseas) : addressbooks));
    },
    'GET /commerce-return-delivery-companies': () =>
      jsonResponse(page([returnDeliveryCompanyEntry()])),
    'GET /dispatch-delivery-companies': () => jsonResponse(dispatchCompanyList()),
    'GET /commerce-meta-sync-runs/latest': () => jsonResponse(metaSyncStatusList()),
  });
}

async function renderProfileTab() {
  const view = renderRoute('/settings');
  await screen.findByRole('heading', { level: 1, name: '설정' });
  await screen.findByLabelText('상호');
  return view;
}

const panel = () => within(screen.getByRole('tabpanel'));
const requestsTo = (api: ReturnType<typeof stubApi>, method: string, path: string) =>
  api.requests.filter((r) => r.method === method && new URL(r.url).pathname === `/api/v1${path}`);

async function lastPutBody(api: ReturnType<typeof stubApi>): Promise<Record<string, unknown>> {
  const puts = requestsTo(api, 'PUT', '/purchase-agency-profile');
  expect(puts.length).toBeGreaterThan(0);
  return (await puts.at(-1)!.clone().json()) as Record<string, unknown>;
}

describe("설정 '구매대행 프로필' 탭(SCR-10, P1-09)", () => {
  it('보드의 세 묶음·라벨·도움말, 배송비는 읽기 전용 무료배송', async () => {
    stubProfileTab();
    await renderProfileTab();
    for (const heading of ['출고·반품', '배송비·반품비·수량', '판매자·고시']) {
      expect(panel().getByRole('heading', { level: 3, name: heading })).toBeInTheDocument();
    }
    expect(panel().getByText('모든 상품의 배송·반품·고시에 같이 들어갑니다')).toBeInTheDocument();
    for (const label of [
      '해외 출고지',
      '반품·교환지',
      '반품 택배사',
      '발송 택배사',
      '주문당 최대 구매수량',
      '반품비',
      '교환비',
      'A/S 연락처',
      'A/S 안내',
      '수입자 · 필수',
      '고시 고정 문구 · 품질보증기준',
      '고시 고정 문구 · 나머지 항목',
    ]) {
      expect(panel().getByLabelText(label)).toBeInTheDocument();
    }
    const fee = panel().getByLabelText('배송비');
    expect(fee).toHaveValue('무료배송');
    expect(fee).toHaveAttribute('readonly');
    expect(panel().getByText('판매가에 포함합니다 · 고정')).toBeInTheDocument();
    expect(panel().getByText('여러 켤레를 받으면 합산 과세될 수 있습니다')).toBeInTheDocument();
    expect(panel().getByText('고지의 반송비 안내에 들어갑니다')).toBeInTheDocument();
    expect(panel().getByText('교환은 반품 뒤 재주문으로 받습니다')).toBeInTheDocument();
    expect(panel().getByText('동기화한 택배사 목록에서 고릅니다')).toBeInTheDocument();
    expect(panel().getByText('출처를 밝힌 코드 목록에서 고릅니다')).toBeInTheDocument();
    expect(
      await panel().findByText(/주소록의 해외 주소만 고를 수 있습니다 · 주소록 동기화 09:10/),
    ).toBeInTheDocument();
    // 외부 링크는 두지 않는다(런타임 외부 주소 없음, 규칙 15)
    expect(panel().getByText(/없으면 스마트스토어센터에서 먼저 등록/)).toBeInTheDocument();
    expect(panel().queryByRole('link', { name: '스마트스토어센터' })).toBeNull();
  });

  it('해외 출고지 선택지 요청에 overseas=true가 붙고, 해외 주소만 선택지다', async () => {
    const api = stubProfileTab();
    await renderProfileTab();
    await waitFor(() =>
      expect(
        requestsTo(api, 'GET', '/commerce-addressbooks').some(
          (r) => new URL(r.url).searchParams.get('overseas') === 'true',
        ),
      ).toBe(true),
    );
    const shipping = panel().getByLabelText('해외 출고지');
    await within(shipping).findByRole('option', { name: '[배대지 창고] 해외 출고지 · 해외' });
    expect(
      within(shipping)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['고르지 않음', '[배대지 창고] 해외 출고지 · 해외']);
    const returns = panel().getByLabelText('반품·교환지');
    await within(returns).findByRole('option', { name: '[국내 반품지] · 국내' });
    expect(shipping).toHaveValue('1');
    expect(returns).toHaveValue('2');
  });

  it('importer가 빈 응답 → 탭 칩 "수입자 입력 필요"와 안내 문구', async () => {
    stubProfileTab({ profile: emptyProfile() });
    await renderProfileTab();
    const tab = screen.getByRole('tab', { name: /구매대행 프로필/ });
    expect(within(tab).getByText('수입자 입력 필요')).toBeInTheDocument();
    expect(panel().getByText(IMPORTER_TEXT)).toBeInTheDocument();
    expect(panel().getByLabelText('수입자 · 필수')).toHaveValue('');
  });

  it('수입자가 있으면 칩·안내가 없다', async () => {
    stubProfileTab();
    await renderProfileTab();
    expect(screen.queryByText('수입자 입력 필요')).toBeNull();
    expect(screen.queryByText(IMPORTER_TEXT)).toBeNull();
  });

  it("'저장' → PUT 본문에 12개 키가 모두 있고 deliveryFeeKrw는 없다. 빈 칸은 null", async () => {
    const api = stubProfileTab({ profile: emptyProfile() });
    api.on('PUT /purchase-agency-profile', () => jsonResponse(profileSaveResult(emptyProfile())));
    await renderProfileTab();
    await userEvent.type(panel().getByLabelText('상호'), '테스트 상호');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));

    const body = await lastPutBody(api);
    expect(Object.keys(body).sort()).toEqual(
      [
        'overseasShippingCommerceAddressbookId',
        'returnCommerceAddressbookId',
        'dispatchDeliveryCompanyCode',
        'commerceReturnDeliveryCompanyId',
        'returnFeeKrw',
        'exchangeFeeKrw',
        'businessName',
        'afterServicePhone',
        'afterServiceGuide',
        'importer',
        'noticeFixedTexts',
        'maxPurchaseQuantityPerOrder',
      ].sort(),
    );
    expect(body).not.toHaveProperty('deliveryFeeKrw');
    expect(body).toMatchObject({
      businessName: '테스트 상호',
      importer: null,
      returnFeeKrw: null,
      overseasShippingCommerceAddressbookId: null,
      noticeFixedTexts: {},
      maxPurchaseQuantityPerOrder: 1,
    });
    expect(
      requestsTo(api, 'PUT', '/purchase-agency-profile')[0]?.headers.get('X-AutoStore-Client'),
    ).toBe('1');
  });

  it('고른 값·숫자·고시 두 칸이 API 값으로 간다', async () => {
    const api = stubProfileTab({ profile: emptyProfile() });
    api.on('PUT /purchase-agency-profile', () => jsonResponse(profileSaveResult(filledProfile())));
    await renderProfileTab();
    const shipping = panel().getByLabelText('해외 출고지');
    await within(shipping).findByRole('option', { name: '[배대지 창고] 해외 출고지 · 해외' });
    await userEvent.selectOptions(shipping, '1');
    await within(panel().getByLabelText('발송 택배사')).findByRole('option', {
      name: '[가짜 발송 택배사 A] (FAKE_DISPATCH_A)',
    });
    await userEvent.selectOptions(panel().getByLabelText('발송 택배사'), 'FAKE_DISPATCH_A');
    await userEvent.type(panel().getByLabelText('반품비'), '30,000');
    await userEvent.type(panel().getByLabelText('고시 고정 문구 · 나머지 항목'), '상품상세 참조');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    const body = await lastPutBody(api);
    expect(body).toMatchObject({
      overseasShippingCommerceAddressbookId: 1,
      dispatchDeliveryCompanyCode: 'FAKE_DISPATCH_A',
      returnFeeKrw: 30000,
      noticeFixedTexts: {
        returnCostReason: '상품상세 참조',
        noRefundReason: '상품상세 참조',
        qualityAssuranceStandard: '상품상세 참조',
        compensationProcedure: '상품상세 참조',
        troubleShootingContents: '상품상세 참조',
      },
    });
    expect(await screen.findByText('저장했습니다.')).toBeInTheDocument();
  });

  it('숫자 칸이 정수가 아니면 보내지 않고 칸에 오류', async () => {
    const api = stubProfileTab();
    await renderProfileTab();
    const qty = panel().getByLabelText('주문당 최대 구매수량');
    await userEvent.clear(qty);
    await userEvent.type(qty, '0');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(qty).toHaveAttribute('aria-invalid', 'true');
    expect(panel().getByText('1 이상 정수로 넣어 주세요.')).toBeInTheDocument();
    expect(requestsTo(api, 'PUT', '/purchase-agency-profile')).toHaveLength(0);
  });

  it('422 fieldErrors → 그 칸 aria-invalid와 문구(안내 띠 없음)', async () => {
    const api = stubProfileTab();
    api.on('PUT /purchase-agency-profile', () =>
      errorResponse(422, 'VALIDATION_FAILED', '입력값을 확인해 주세요.', {
        fieldErrors: [{ field: 'importer', message: '100자 이하여야 합니다.' }],
      }),
    );
    await renderProfileTab();
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    const importer = panel().getByLabelText('수입자 · 필수');
    await waitFor(() => expect(importer).toHaveAttribute('aria-invalid', 'true'));
    expect(panel().getByText('100자 이하여야 합니다.')).toBeInTheDocument();
    expect(panel().queryByRole('alert')).toBeNull();
  });

  it('도메인 오류(422 ADDRESS_NOT_OVERSEAS·404)는 안내 띠로, 칸도 표시한다', async () => {
    const api = stubProfileTab();
    api.on('PUT /purchase-agency-profile', () =>
      errorResponse(422, 'ADDRESS_NOT_OVERSEAS', '해외 출고지 주소가 아닙니다.', {
        fieldErrors: [
          {
            field: 'overseasShippingCommerceAddressbookId',
            message: '해외 출고지 주소가 아닙니다.',
          },
        ],
      }),
    );
    await renderProfileTab();
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await panel().findByRole('alert')).toHaveTextContent('해외 출고지 주소가 아닙니다.');
    expect(panel().getByLabelText('해외 출고지')).toHaveAttribute('aria-invalid', 'true');

    api.on('PUT /purchase-agency-profile', () =>
      errorResponse(404, 'ADDRESSBOOK_NOT_FOUND', '주소록 항목을 찾을 수 없습니다.'),
    );
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await panel().findByRole('alert')).toHaveTextContent('주소록 항목을 찾을 수 없습니다.');
  });

  it("'되돌리기' → 서버 값으로 돌아간다", async () => {
    stubProfileTab();
    await renderProfileTab();
    const name = panel().getByLabelText('상호');
    await userEvent.clear(name);
    await userEvent.type(name, '고친 상호');
    expect(name).toHaveValue('고친 상호');
    await userEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    expect(panel().getByLabelText('상호')).toHaveValue('[내 상호]');
  });

  it('저장 뒤 재실행 필요가 생기면 안내한다(Proposed 문구)', async () => {
    const api = stubProfileTab();
    api.on('PUT /purchase-agency-profile', () =>
      jsonResponse(profileSaveResult(filledProfile({ importer: '다른 수입자' }), 3)),
    );
    await renderProfileTab();
    const importer = panel().getByLabelText('수입자 · 필수');
    await userEvent.clear(importer);
    await userEvent.type(importer, '다른 수입자');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(
      await panel().findByText(/후보 단계 3개\(⑥-3·⑧·⑨\)가 '재실행 필요'가 되었습니다/),
    ).toBeInTheDocument();
    expect(panel().getByLabelText('수입자 · 필수')).toHaveValue('다른 수입자');
  });

  it('주소록 캐시가 빈 응답 → 선택지 대신 "지금 동기화" 안내 링크', async () => {
    stubProfileTab({ addressbooks: [] });
    await renderProfileTab();
    const links = await panel().findAllByRole('link', { name: '시스템 상태에서 지금 동기화' });
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]).toHaveAttribute('href', '/system#meta-sync');
    expect(panel().queryByRole('combobox', { name: '해외 출고지' })).toBeNull();
    expect(panel().getByRole('group', { name: '해외 출고지' })).toBeInTheDocument();
  });

  it('주소 경고(addressWarnings)를 안내 띠로 보인다', async () => {
    stubProfileTab({
      profile: filledProfile({
        addressWarnings: [
          {
            field: 'overseasShippingCommerceAddressbookId',
            code: 'ADDRESSBOOK_NOT_FOUND',
            message:
              '해외 출고지 주소록이 최신 동기화에서 사라졌습니다. 다른 해외 주소를 골라 저장해 주세요.',
          },
        ],
      }),
    });
    await renderProfileTab();
    expect(
      within(panel().getByRole('list', { name: '주소록 경고' })).getByText(
        /해외 출고지 주소록이 최신 동기화에서 사라졌습니다/,
      ),
    ).toBeInTheDocument();
  });
});
