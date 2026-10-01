import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import {
  approvalPreview,
  preValidationResult,
  registrationDetail,
  registrationPage,
  registrationSummary,
  registrationSwitch,
  uploadResultOutput,
} from '@/test/fixtures/registration';
import { candidateDetail, gateList, stepRail } from '@/test/fixtures/stepEngine';
import { renderRoute } from '@/test/renderRoute';

const CANDIDATE_ID = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface SetupOptions {
  preview?: Response;
  result?: ReturnType<typeof preValidationResult>;
  registrations?: ReturnType<typeof registrationPage>;
  detail?: ReturnType<typeof registrationDetail>;
  apiBlocked?: boolean;
}

function setup(options: SetupOptions = {}) {
  return stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList(38)),
    'GET /registration-switch': () => jsonResponse(registrationSwitch(options.apiBlocked ?? true)),
    [`GET /candidates/${CANDIDATE_ID}`]: () =>
      jsonResponse(
        candidateDetail({ id: CANDIDATE_ID, resumeStepCode: null, status: 'AWAITING_APPROVAL' }),
      ),
    [`GET /candidates/${CANDIDATE_ID}/steps`]: () =>
      jsonResponse(stepRail({ UPLOAD: { status: 'COMPLETED', currentStepRunId: 108 } })),
    [`GET /candidates/${CANDIDATE_ID}/gates`]: () => jsonResponse(gateList({ G2: true, G3: true })),
    [`GET /candidates/${CANDIDATE_ID}/upload-result`]: () =>
      jsonResponse(uploadResultOutput({ candidateId: CANDIDATE_ID })),
    [`GET /candidates/${CANDIDATE_ID}/approval`]: () =>
      options.preview ?? jsonResponse(approvalPreview(CANDIDATE_ID)),
    [`POST /candidates/${CANDIDATE_ID}/pre-validations`]: () =>
      jsonResponse(options.result ?? preValidationResult(CANDIDATE_ID)),
    [`GET /candidates/${CANDIDATE_ID}/registrations`]: () =>
      jsonResponse(options.registrations ?? registrationPage()),
    'GET /registrations/31': () => jsonResponse(options.detail ?? registrationDetail(CANDIDATE_ID)),
  });
}

const open = () => renderRoute(`/candidates/${CANDIDATE_ID}/approval`);
const registerRegion = async () => within(await screen.findByRole('region', { name: '⑨ 등록' }));

describe('SCR-08 ⑨ 등록(P4-03)', () => {
  it("'승인·등록'을 누르면 Idempotency-Key가 UUID이고, 두 번 빨리 눌러도 요청은 1건이다", async () => {
    const stub = setup();
    let release: () => void = () => undefined;
    stub.on(
      `POST /candidates/${CANDIDATE_ID}/registrations`,
      () =>
        new Promise<Response>((resolve) => {
          release = () =>
            resolve(
              jsonResponse(
                {
                  registrationId: 31,
                  stepRunId: 210,
                  candidateId: CANDIDATE_ID,
                  status: 'VALIDATED',
                  sellerManagementCode: 'RKT:shop-a:10000123:108',
                  displayStatusType: 'SUSPENSION',
                  approvedAt: '2026-09-28T06:00:00.000Z',
                },
                202,
              ),
            );
        }),
    );
    open();
    const region = await registerRegion();
    const button = region.getByRole('button', { name: '승인·등록' });
    await waitFor(() => expect(button).toBeEnabled());
    // 상태가 다시 그려지기 전의 빠른 두 번 누름
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() =>
      expect(
        stub.requests.filter((r) => r.url.endsWith('/registrations') && r.method === 'POST'),
      ).toHaveLength(1),
    );
    expect(button).toBeDisabled();
    const sent = stub.requests.find(
      (r) => r.method === 'POST' && r.url.endsWith('/registrations'),
    )!;
    expect(sent.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(sent.headers.get('X-AutoStore-Client')).toBe('1');
    expect(await sent.clone().json()).toEqual({
      optionType: 'COMBINATION',
      expectedUploadResultId: 1,
      expectedPriceJudgementId: 7,
    });
    act(() => release());
    await waitFor(() => expect(button).toBeEnabled());
    expect(
      stub.requests.filter((r) => r.method === 'POST' && r.url.endsWith('/registrations')),
    ).toHaveLength(1);
  });

  it("중복이면 '기존 상품 보기'와 상품 번호·등록 시각이 보이고 '승인·등록'은 없다(새 창으로 연다)", async () => {
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    setup({
      preview: jsonResponse(
        approvalPreview(CANDIDATE_ID, {
          approveEnabled: false,
          approveDisabledReason: {
            code: 'DUPLICATE_REGISTRATION',
            message: '같은 상품·색상이 이미 등록돼 있습니다. 기존 상품을 확인해 주세요.',
          },
          duplicate: {
            duplicated: true,
            existingRegistrationId: 5,
            originProductNo: '10000000001',
            channelProductNo: '20000000001',
            source: 'LOCAL',
            registeredAt: '2026-09-27T01:00:00.000Z',
            smartstoreProductUrl: 'store.example/products/edit/10000000001',
          },
        }),
      ),
    });
    open();
    const region = await registerRegion();
    const view = await region.findByRole('button', { name: '기존 상품 보기' });
    expect(region.getByText(/상품 번호 10000000001 · 09-27 10:00 등록/)).toBeInTheDocument();
    expect(region.queryByRole('button', { name: '승인·등록' })).toBeNull();
    await userEvent.click(view);
    expect(opened).toHaveBeenCalledWith(
      'store.example/products/edit/10000000001',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it("결과확인필요면 '결과 확인' 버튼이 보이고, 누르면 result-checks를 부른다", async () => {
    const stub = setup({
      registrations: registrationPage([
        registrationSummary({
          status: 'RESULT_CHECK_REQUIRED',
          httpStatus: 500,
          errorCode: 'HTTP_500',
          errorMessage:
            "커머스API 응답을 받지 못해 등록됐는지 알 수 없습니다(HTTP 500). 다시 승인하지 말고 '결과 확인'으로 판매자관리코드를 조회해 주세요.",
        }),
      ]),
      detail: registrationDetail(CANDIDATE_ID, {
        status: 'RESULT_CHECK_REQUIRED',
        traceId: 'fixture-trace-products-500',
        errorMessage: '커머스API 응답을 받지 못해 등록됐는지 알 수 없습니다(HTTP 500).',
      }),
    });
    stub.on('POST /registrations/31/result-checks', () =>
      jsonResponse({
        registrationId: 31,
        found: true,
        status: 'REGISTERED',
        originProductNo: '10000000001',
        channelProductNo: null,
        lastResultCheckAt: '2026-09-28T07:00:00.000Z',
        failedAt: null,
        failureKind: null,
        candidateStatus: 'REGISTERED',
      }),
    );
    open();
    const region = await registerRegion();
    const check = await region.findByRole('button', { name: '결과 확인' });
    expect(region.getAllByText('결과확인필요').length).toBeGreaterThan(0);
    expect(await region.findByText('fixture-trace-products-500')).toBeInTheDocument();
    await userEvent.click(check);
    await waitFor(() =>
      expect(
        stub.requests.filter((r) => r.method === 'POST' && r.url.endsWith('/result-checks')),
      ).toHaveLength(1),
    );
  });

  it('4xx 결과면 한국어 오류와 추적 번호가 보이고 결과 확인 버튼은 없다', async () => {
    const message =
      '커머스API가 등록 요청을 거절했습니다(HTTP 400 · BadRequest).\n- 태그: 쓸 수 없는 값입니다(제한)';
    setup({
      registrations: registrationPage([
        registrationSummary({
          status: 'REGISTERING',
          failedAt: '2026-09-28T06:01:00.000Z',
          failureKind: 'INVALID_INPUT_4XX',
          httpStatus: 400,
          errorCode: 'BadRequest',
          errorMessage: message,
        }),
      ]),
      detail: registrationDetail(CANDIDATE_ID, {
        status: 'REGISTERING',
        failedAt: '2026-09-28T06:01:00.000Z',
        failureKind: 'INVALID_INPUT_4XX',
        httpStatus: 400,
        errorCode: 'BadRequest',
        errorMessage: message,
        traceId: 'fixture-trace-products-400',
      }),
    });
    open();
    const region = await registerRegion();
    expect((await region.findAllByText('입력 오류로 종결')).length).toBeGreaterThan(0);
    expect(
      region.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === message),
    ).toBeInTheDocument();
    expect(await region.findByText('fixture-trace-products-400')).toBeInTheDocument();
    expect(region.queryByRole('button', { name: '결과 확인' })).toBeNull();
  });

  it("등록 모드 '처음 10건은 전시중지로 등록 (3/10)'과 차단 스위치 띠(role=switch)가 보이고, 스위치를 끄면 PUT을 부른다", async () => {
    const stub = setup();
    stub.on('PUT /registration-switch', () =>
      jsonResponse({ ...registrationSwitch(false), revertedCandidateIds: [] }),
    );
    open();
    const region = await registerRegion();
    expect(await region.findByText('처음 10건은 전시중지로 등록')).toBeInTheDocument();
    expect(region.getByText('(3/10)')).toBeInTheDocument();
    expect(
      screen.getByText('등록 API 차단이 켜져 있어 드라이런만 합니다. 실제로 등록하려면 끄세요.'),
    ).toBeInTheDocument();
    const toggle = await screen.findByRole('switch', { name: '등록 API 차단' });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    await waitFor(() => expect(stub.requests.filter((r) => r.method === 'PUT')).toHaveLength(1));
    const put = stub.requests.find((r) => r.method === 'PUT')!;
    expect(await put.clone().json()).toEqual({ apiBlocked: false });
  });

  it("드라이런 뒤(VALIDATED — 미리보기 409)에도 직전 결과 '검증완료'와 스위치 안내가 보인다", async () => {
    setup({
      preview: errorResponse(
        409,
        'CANDIDATE_STATUS_INVALID',
        '지금 후보 상태(검증완료)에서는 할 수 없습니다.',
      ),
      registrations: registrationPage([registrationSummary()]),
    });
    open();
    const region = await registerRegion();
    expect(await region.findByText(/등록 API 차단을 끄면 승인대기로 돌아가/)).toBeInTheDocument();
    expect(region.getAllByText('검증완료').length).toBeGreaterThan(0);
    expect(region.getByRole('button', { name: '승인·등록' })).toBeDisabled();
  });

  it("카테고리가 표준형을 지원하면 '표준형으로 바꾸기'가 ?optionType=STANDARD로 바꾼다", async () => {
    setup({
      preview: jsonResponse(approvalPreview(CANDIDATE_ID, { standardOptionSupported: true })),
    });
    const { router } = open();
    const preview = within(await screen.findByRole('region', { name: '전체 미리보기' }));
    await userEvent.click(await preview.findByRole('button', { name: '표준형으로 바꾸기' }));
    await waitFor(() => expect(router.state.location.search).toBe('?optionType=STANDARD'));
  });
});
