import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import {
  approvalPreview,
  preValidationResult,
  registrationPage,
  registrationSummary,
  registrationSwitch,
  uploadResultOutput,
} from '@/test/fixtures/registration';
import { candidateDetail, disabled, gateList, stepRail } from '@/test/fixtures/stepEngine';
import { renderRoute } from '@/test/renderRoute';
import { stepPath } from '@/shared/lib/steps';

/**
 * ⑧·⑨ 맨 위 안내(D-41): 하는 일 · 지금 할 일 · 낯선 말 풀이, 그리고 지금 할 일이 있는 자리의 '지금 여기' 표시.
 * 글 자체는 content.ts(= 안내문구.md §10.5), 어떤 글을 고르는지는 approvalNow.test.ts가 본다 — 여기서는 화면에 맞게 붙는지만 본다.
 */
const CANDIDATE_ID = 12;
const GUIDE_NAME = '⑧·⑨ 최종 승인 안내';

type Rail = Parameters<typeof stepRail>[0];
type CandidateStatus = NonNullable<Parameters<typeof candidateDetail>[0]['status']>;

interface SetupOptions {
  status?: CandidateStatus;
  rail?: Rail;
  preview?: Response;
  result?: ReturnType<typeof preValidationResult>;
  registrations?: ReturnType<typeof registrationPage>;
  apiBlocked?: boolean;
}

const UPLOAD_DONE: Rail = { UPLOAD: { status: 'COMPLETED', currentStepRunId: 108 } };
const NOT_APPROVABLE = errorResponse(
  409,
  'CANDIDATE_STATUS_INVALID',
  '지금 여정 상태에서는 할 수 없습니다.',
);

function setup(options: SetupOptions = {}) {
  return stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList(38)),
    'GET /registration-switch': () => jsonResponse(registrationSwitch(options.apiBlocked ?? true)),
    [`GET /candidates/${CANDIDATE_ID}`]: () =>
      jsonResponse(
        candidateDetail({
          id: CANDIDATE_ID,
          resumeStepCode: null,
          status: options.status ?? 'AWAITING_APPROVAL',
        }),
      ),
    [`GET /candidates/${CANDIDATE_ID}/steps`]: () =>
      jsonResponse(stepRail(options.rail ?? UPLOAD_DONE)),
    [`GET /candidates/${CANDIDATE_ID}/gates`]: () => jsonResponse(gateList({ G2: true, G3: true })),
    [`GET /candidates/${CANDIDATE_ID}/upload-result`]: () =>
      jsonResponse(uploadResultOutput({ candidateId: CANDIDATE_ID })),
    [`GET /candidates/${CANDIDATE_ID}/approval`]: () =>
      options.preview ?? jsonResponse(approvalPreview(CANDIDATE_ID)),
    [`POST /candidates/${CANDIDATE_ID}/pre-validations`]: () =>
      jsonResponse(options.result ?? preValidationResult(CANDIDATE_ID)),
    [`GET /candidates/${CANDIDATE_ID}/registrations`]: () =>
      jsonResponse(options.registrations ?? registrationPage()),
  });
}

const open = () => renderRoute(`/candidates/${CANDIDATE_ID}/approval`, { demo: true });

/** 안내 판 */
const intro = async () => within(await screen.findByRole('region', { name: GUIDE_NAME }));

/** 지금 할 일 줄에 이 글이 나올 때까지 기다린다(상태를 읽는 대로 글이 바뀐다) */
async function expectNow(text: string) {
  const panel = await intro();
  await waitFor(() => expect(panel.getByRole('status')).toHaveTextContent(text));
  return panel;
}

/** '지금 여기' 표시가 정확히 하나이고 그 표시가 든 껍데기를 돌려준다 */
async function onlyMark() {
  const marks = await screen.findAllByText('지금 여기');
  expect(marks).toHaveLength(1);
  return within(marks[0]!.parentElement!);
}

describe('⑧·⑨ 맨 위 안내: 하는 일 · 지금 할 일 · 낯선 말 풀이(D-41)', () => {
  it('하는 일 한 문장이 보이고, 풀이는 접혀 있다가 펼치면 이 화면의 말이 나온다', async () => {
    setup();
    open();
    const panel = await intro();
    expect(
      panel.getByText(
        '이미지를 올리고(⑧), 등록될 상품 전체를 미리 본 뒤 직접 승인해(G4) 스마트스토어에 등록하는(⑨) 단계입니다.',
      ),
    ).toBeInTheDocument();
    const toggle = panel.getByRole('button', { name: /펼치기/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const term of [
      '이미지 업로드(⑧)',
      '최종 승인(G4) · [승인·등록]',
      '등록 API 차단 · 드라이런',
      '소싱 방식(비교함 · 비교 없이 확정)',
      '사이즈 옵션(조합형 · 표준형)',
      '비용 분해',
      '사전 검증',
      '판정 유효 시간 · 재조회',
      '등록 모드(전시중지)',
      '직전 결과 · 결과확인필요',
    ]) {
      expect(panel.getByText(term)).toBeVisible();
    }
    // 화면에 '앵커'라는 말을 쓰지 않는다(기준 상품)
    expect(panel.queryByText(/앵커/)).toBeNull();
  });

  it("모두 통과하고 차단이 켜져 있으면 [승인·등록]을 누르라고 하고(드라이런), '지금 여기'는 승인 바에만 붙는다", async () => {
    setup();
    open();
    const panel = await expectNow(
      "[승인·등록]을 누르세요. '등록 API 차단'이 켜져 있어 실제로 등록하지 않고 요청 내용과 검증 결과만 저장하는 연습(드라이런)이 됩니다.",
    );
    expect(panel.getByRole('status')).toHaveTextContent(/^지금 할 일 \[승인·등록\]을 누르세요\./);
    const holder = await onlyMark();
    expect(holder.getByRole('button', { name: '승인·등록' })).toBeInTheDocument();
    expect(holder.queryByRole('switch')).toBeNull();
  });

  it('차단이 꺼져 있으면 연습이 아니라 실제 등록이라고 말한다', async () => {
    setup({ apiBlocked: false });
    open();
    await expectNow(
      "'등록 API 차단'이 꺼져 있어 연습이 아니라 실제 스마트스토어에 등록합니다. 연습만 하려면 먼저 스위치를 켜세요.",
    );
    expect((await onlyMark()).getByRole('button', { name: '승인·등록' })).toBeInTheDocument();
  });

  it("⑧이 재실행 필요면 ⑧ 상태 줄의 [다시 실행]에 '지금 여기'가 붙는다(승인 바에는 없다)", async () => {
    setup({
      status: 'WORKING',
      rail: { UPLOAD: { status: 'RERUN_REQUIRED', currentStepRunId: 108 } },
      preview: NOT_APPROVABLE,
    });
    open();
    await expectNow('썸네일(⑤)이나 상세 HTML(⑥-3)이 바뀌었습니다. ⑧의 [다시 실행]을 눌러');
    const holder = await onlyMark();
    expect(holder.getByRole('button', { name: '다시 실행' })).toBeInTheDocument();
    expect(holder.queryByRole('button', { name: '승인·등록' })).toBeNull();
  });

  it('⑧ 실행 버튼이 꺼져 있으면 누르라고 하지 않고 이유를 보라고 하며, 표시는 붙이지 않는다', async () => {
    setup({
      status: 'WORKING',
      rail: {
        UPLOAD: {
          status: 'NOT_RUN',
          actions: {
            run: disabled('GATE_NOT_PASSED', 'G3 썸네일 선택을 먼저 통과해 주세요.'),
            continuousRun: disabled('GATE_NOT_PASSED', 'G3 썸네일 선택을 먼저 통과해 주세요.'),
            edit: disabled('INVALID_STEP_CODE', '이 단계는 값을 직접 고칠 수 없습니다.'),
          },
        },
      },
      preview: NOT_APPROVABLE,
    });
    open();
    await expectNow('⑧ 이미지 업로드의 실행 버튼은 지금 쓸 수 없습니다.');
    expect(screen.getByText('G3 썸네일 선택을 먼저 통과해 주세요.')).toBeInTheDocument();
    expect(screen.queryByText('지금 여기')).toBeNull();
  });

  it("사전 검증이 실패하면 고치라고 하고 맨 위 실패 줄의 단계 링크를 달며, 표시는 '사전 검증 결과'에 붙는다", async () => {
    setup({
      result: preValidationResult(CANDIDATE_ID, {
        REQUIRED_FIELDS: { reason: '상품명이 101자로 100자를 넘습니다', stepCode: 'NOTICE_HTML' },
      }),
    });
    open();
    const panel = await expectNow('사전 검증에서 통과하지 못한 줄이 있습니다.');
    expect(panel.getByRole('link', { name: '고칠 단계 열기' })).toHaveAttribute(
      'href',
      stepPath(CANDIDATE_ID, 'NOTICE_HTML'),
    );
    const holder = await onlyMark();
    expect(holder.getByRole('region', { name: '사전 검증 결과' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '승인·등록' })).toBeDisabled();
  });

  it('판정 유효 시간만 실패하면 [재조회]를 누르라고 한다(링크 없음)', async () => {
    setup({
      preview: jsonResponse(
        approvalPreview(CANDIDATE_ID, {
          approveEnabled: false,
          approveDisabledReason: {
            code: 'JUDGEMENT_EXPIRED',
            message: "판정에 쓴 라쿠텐 페이지가 6시간이 넘었습니다. '재조회'로 다시 판정해 주세요.",
          },
        }),
      ),
      result: preValidationResult(CANDIDATE_ID, {
        JUDGEMENT_FRESHNESS: {
          reason: '라쿠텐 페이지를 받은 지 6시간이 넘었습니다',
          stepCode: 'SOURCING',
        },
      }),
    });
    open();
    const panel = await expectNow(
      '판정 유효 시간(6시간)이 지났습니다. 사전 검증의 [재조회]를 눌러',
    );
    expect(panel.queryByRole('link', { name: '고칠 단계 열기' })).toBeNull();
    const holder = await onlyMark();
    expect(holder.getByRole('button', { name: '재조회' })).toBeInTheDocument();
  });

  it("승인대기가 아니라 앞 단계가 남았으면 '승인 전에 끝낼 곳'을 보라고 하고 첫 단계 링크를 단다", async () => {
    setup({
      status: 'WORKING',
      preview: NOT_APPROVABLE,
      rail: {
        SOURCING: { status: 'COMPLETED' },
        PRICING: { status: 'COMPLETED' },
        CATEGORY: { status: 'COMPLETED' },
        THUMBNAIL: { status: 'COMPLETED' },
        COPY: { status: 'COMPLETED' },
        NOTICE_RAW: { status: 'COMPLETED' },
        NOTICE_HTML: { status: 'COMPLETED' },
        TAGS: { status: 'RERUN_REQUIRED' },
        UPLOAD: { status: 'COMPLETED', currentStepRunId: 108 },
      },
    });
    open();
    const panel = await expectNow("맨 아래 '승인 전에 끝낼 곳'의 링크로 해당 단계를 여세요.");
    expect(panel.getByRole('link', { name: '막힌 단계 열기' })).toHaveAttribute(
      'href',
      stepPath(CANDIDATE_ID, 'TAGS'),
    );
    const holder = await onlyMark();
    expect(holder.getByRole('list', { name: '승인 전에 끝낼 곳' })).toBeInTheDocument();
  });

  it("같은 상품이 이미 등록돼 있으면 [기존 상품 보기] 상자에 '지금 여기'가 붙는다", async () => {
    setup({
      preview: jsonResponse(
        approvalPreview(CANDIDATE_ID, {
          approveEnabled: false,
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
    await expectNow(
      '같은 상품·색상이 이미 등록돼 있어 [승인·등록] 대신 [기존 상품 보기]가 나옵니다.',
    );
    expect((await onlyMark()).getByRole('button', { name: '기존 상품 보기' })).toBeInTheDocument();
  });

  it("드라이런 뒤(검증완료)에는 '아직 실제로 등록하지 않았다'고 알리고 표시는 차단 스위치 띠에 붙는다", async () => {
    setup({
      status: 'VALIDATED',
      preview: NOT_APPROVABLE,
      registrations: registrationPage([registrationSummary()]),
    });
    open();
    await expectNow('연습(드라이런)으로 저장했습니다. 아직 실제로 등록하지 않았습니다.');
    const holder = await onlyMark();
    expect(holder.getByRole('switch', { name: '등록 API 차단' })).toBeInTheDocument();
  });

  it("응답이 없어 결과확인필요이면 [결과 확인]이 있는 '직전 결과' 칸에 '지금 여기'가 붙는다", async () => {
    setup({
      status: 'RESULT_CHECK_REQUIRED',
      preview: NOT_APPROVABLE,
      registrations: registrationPage([
        registrationSummary({
          status: 'RESULT_CHECK_REQUIRED',
          errorMessage: '커머스API 응답을 받지 못해 등록됐는지 알 수 없습니다(HTTP 500).',
        }),
      ]),
    });
    open();
    await expectNow('등록 요청에 응답이 없어 등록됐는지 알 수 없습니다.');
    const holder = await onlyMark();
    expect(holder.getByRole('button', { name: '결과 확인' })).toBeInTheDocument();
    expect(holder.getByText('직전 결과')).toBeInTheDocument();
  });

  it('등록됨이면 G5(스마트스토어센터에서 전시 켜기)를 알리고, 표시는 없다', async () => {
    setup({
      status: 'REGISTERED',
      preview: NOT_APPROVABLE,
      registrations: registrationPage([
        registrationSummary({
          status: 'REGISTERED',
          originProductNo: '10000000001',
          registeredAt: '2026-09-28T06:01:00.000Z',
        }),
      ]),
    });
    open();
    await expectNow('등록을 마쳤습니다. 전시중지로 올라간 상품(처음 10건)은');
    expect(screen.queryByText('지금 여기')).toBeNull();
  });

  it('여정 상태를 읽기 전에는 지금 할 일 줄이 비어 있다(하는 일 문장·풀이는 있다)', async () => {
    const stub = setup();
    stub.on(`GET /candidates/${CANDIDATE_ID}`, () =>
      errorResponse(404, 'CANDIDATE_NOT_FOUND', '여정을 찾을 수 없습니다.'),
    );
    open();
    const panel = await intro();
    expect(panel.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.queryByText('지금 여기')).toBeNull();
  });
});
