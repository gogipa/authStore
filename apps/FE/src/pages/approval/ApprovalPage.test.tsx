import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import {
  approvalPreview,
  preValidationResult,
  registrationPage,
  registrationSwitch,
  uploadResultOutput,
} from '@/test/fixtures/registration';
import { candidateDetail, gateList, stepRail } from '@/test/fixtures/stepEngine';
import { renderRoute } from '@/test/renderRoute';

const CANDIDATE_ID = 12;

function setup(
  options: {
    preview?: Response;
    result?: ReturnType<typeof preValidationResult>;
  } = {},
) {
  return stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList(38)),
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
    [`GET /candidates/${CANDIDATE_ID}/registrations`]: () => jsonResponse(registrationPage()),
    'GET /registration-switch': () => jsonResponse(registrationSwitch(true)),
  });
}

const open = () => renderRoute(`/candidates/${CANDIDATE_ID}/approval`);

describe('SCR-08 최종 승인 — 미리보기·사전 검증·승인 버튼(P4-02)', () => {
  it("모두 통과하면 '13개 모두 통과'이고 '승인·등록'이 켜진다(시안 문구·설명)", async () => {
    const stub = setup();
    open();
    expect(await screen.findByRole('heading', { level: 1, name: '최종 승인' })).toBeInTheDocument();
    expect(
      screen.getByText(
        '상품 전체와 사전 검증 결과를 확인하고 승인합니다. 등록은 이 화면의 승인으로만 됩니다.',
      ),
    ).toBeInTheDocument();
    const panel = within(await screen.findByRole('region', { name: '사전 검증 결과' }));
    expect(await panel.findByText('13개 모두 통과')).toBeInTheDocument();
    expect(
      panel.getByText('화면을 열 때 검사했고, 승인 직전에 한 번 더 검사합니다.'),
    ).toBeInTheDocument();
    expect(panel.getAllByText('통과')).toHaveLength(13);
    const button = await screen.findByRole('button', { name: '승인·등록' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByText('사전 검증 13개 모두 통과')).toBeInTheDocument();
    // ⑧ 줄의 '여정 상태 승인대기'·'G4 최종 승인 · 확인 필요'(시안)
    const upload = within(screen.getByRole('region', { name: '⑧ 이미지 업로드' }));
    expect(await upload.findByText('승인대기')).toBeInTheDocument();
    expect(upload.getByText(/G4 최종 승인 · 확인 필요/)).toBeInTheDocument();
    const posts = stub.requests.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(await posts[0]!.clone().json()).toEqual({ optionType: 'COMBINATION' });
  });

  it("한 항목이 실패하면 '승인·등록'이 disabled이고 이유 글이 보인다", async () => {
    setup({
      result: preValidationResult(CANDIDATE_ID, {
        REQUIRED_FIELDS: { reason: '상품명이 101자로 100자를 넘습니다', stepCode: 'NOTICE_HTML' },
      }),
    });
    open();
    const panel = within(await screen.findByRole('region', { name: '사전 검증 결과' }));
    expect(await panel.findByText('13개 중 1개 실패')).toBeInTheDocument();
    expect(panel.getByText('상품명이 101자로 100자를 넘습니다')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: '승인·등록' });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(/사전 검증 1개 항목을 통과하지 못했습니다\(상품명 100자 이내\)/),
    ).toBeInTheDocument();
  });

  it('STEP_FRESHNESS(stepCode TAGS) 실패 줄의 링크가 /candidates/12/tags다', async () => {
    setup({
      result: preValidationResult(CANDIDATE_ID, {
        STEP_FRESHNESS: {
          reason: '최신이 아닌 단계가 있습니다: ⑦ 태그(재실행 필요)',
          stepCode: 'TAGS',
        },
      }),
    });
    open();
    const panel = within(await screen.findByRole('region', { name: '사전 검증 결과' }));
    const reason = await panel.findByText('최신이 아닌 단계가 있습니다: ⑦ 태그(재실행 필요)');
    const line = reason.closest('li[data-line]') as HTMLElement;
    expect(line).toHaveAttribute('data-line', 'STEP_FRESHNESS');
    expect(within(line).getByRole('link', { name: '⑦ 태그' })).toHaveAttribute(
      'href',
      `/candidates/${CANDIDATE_ID}/tags`,
    );
  });

  it("판정 유효 실패면 '재조회' 버튼이 보이고, 승인 꺼짐 이유는 JUDGEMENT_EXPIRED 문구다", async () => {
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
    const panel = within(await screen.findByRole('region', { name: '사전 검증 결과' }));
    const reason = await panel.findByText('라쿠텐 페이지를 받은 지 6시간이 넘었습니다');
    const line = reason.closest('li[data-line]') as HTMLElement;
    expect(within(line).getByRole('button', { name: '재조회' })).toBeEnabled();
    expect(within(line).getByText('라쿠텐 페이지 14:02 받음 · 20:02까지 유효')).toBeInTheDocument();
    expect(
      within(line).getByText(/다시 읽고 다시 판정합니다 · 하루 조회 38\/110에 포함/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '승인·등록' })).toBeDisabled();
    expect(
      screen.getAllByText(
        "판정에 쓴 라쿠텐 페이지가 6시간이 넘었습니다. '재조회'로 다시 판정해 주세요.",
      ).length,
    ).toBeGreaterThan(0);
    // M2 '자동으로 다시 읽고'(F-AP-52) 대신 M1 동작 문구
    expect(
      screen.getByText(/판정 유효 시간\(20:02까지\)이 지나면 승인할 수 없습니다/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/자동으로 다시 읽고/)).toBeNull();
  });

  it("'모아 승인'·'내려받기' 글자가 화면에 없다(M2)", async () => {
    setup();
    open();
    await screen.findByRole('region', { name: '전체 미리보기' });
    expect(screen.queryByText(/모아 승인/)).toBeNull();
    expect(screen.queryByText(/내려받기/)).toBeNull();
  });

  it('미리보기 이미지와 상세 렌더링에 외부 URL src가 없다(로컬 /api/v1/image-assets/…/file만)', async () => {
    setup();
    open();
    const preview = within(await screen.findByRole('region', { name: '전체 미리보기' }));
    const image = await preview.findByRole('img', { name: '대표 이미지' });
    expect(image.getAttribute('src')).toBe('/api/v1/image-assets/31/file');
    for (const img of document.querySelectorAll('img')) {
      expect(img.getAttribute('src') ?? '').not.toMatch(
        /shop-phinf|^\/\/|^[a-z]+:\/\/(?!localhost)/i,
      );
    }
    const frame = preview.getByTitle('상세 페이지 미리보기');
    expect(frame).toHaveAttribute('sandbox', '');
    const doc = frame.getAttribute('srcdoc') ?? '';
    expect(doc).not.toContain('shop-phinf');
    const sources = [...doc.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]);
    expect(sources).toEqual([
      `${window.location.origin}/api/v1/image-assets/31/file`,
      `${window.location.origin}/api/v1/image-assets/32/file`,
    ]);
    // 요청 JSON은 URL 그대로 글로만 보인다(부르지 않는다) — 시안대로 '⑨ 등록' 영역에 있다(P4-03)
    const register = within(screen.getByRole('region', { name: '⑨ 등록' }));
    expect(register.getByLabelText('요청 JSON 초안').textContent).toContain('"statusType": "SALE"');
  });

  it("미리보기 요약: 상품명 n/100자·순이익·소싱 방식·사이즈 옵션 '각 2개, 합 10개'·태그·상세·배송", async () => {
    setup();
    open();
    const preview = within(await screen.findByRole('region', { name: '전체 미리보기' }));
    expect(await preview.findByText(/상품명 33\/100자 · 대표이미지 1000×1000/)).toBeInTheDocument();
    expect(preview.getAllByText('167,300원').length).toBeGreaterThan(0);
    expect(preview.getAllByText('27,418원').length).toBeGreaterThan(0);
    expect(preview.getByText('비교함 · shop-a:10000123')).toBeInTheDocument();
    expect(preview.getByText('패션잡화 > 남성신발 > 운동화 > 러닝화')).toBeInTheDocument();
    expect(preview.getByText('조합형 · 각 2개, 합 10개')).toBeInTheDocument();
    expect(preview.getByText('태그 10개')).toBeInTheDocument();
    expect(preview.getByText(/원산지 베트남/)).toBeInTheDocument();
    expect(preview.getByText('무료배송 · 관부가세 포함 · 개인통관')).toBeInTheDocument();
  });

  it('승인대기가 아니면(409) 그 문구를 띠로 보이고 버튼을 끄며 사전 검증을 부르지 않는다', async () => {
    const stub = setup({
      preview: errorResponse(
        409,
        'CANDIDATE_STATUS_INVALID',
        '지금 여정 상태(작업중)에서는 할 수 없습니다.',
        {
          details: { status: 'WORKING', allowed: ['AWAITING_APPROVAL'] },
        },
      ),
    });
    open();
    const banner = await screen.findByRole('status', {
      name: (_name, el) =>
        el.textContent?.includes('지금 여정 상태(작업중)에서는 할 수 없습니다.') ?? false,
    });
    expect(banner).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '승인·등록' })).toBeDisabled();
    expect(stub.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('필수 단계가 재실행 필요라 작업중이면 막는 단계와 그 단계로 가는 링크를 보인다(US-33 AC6, P5-01)', async () => {
    const stub = setup({
      preview: errorResponse(
        409,
        'CANDIDATE_STATUS_INVALID',
        '지금 여정 상태(작업중)에서는 할 수 없습니다.',
        { details: { status: 'WORKING', allowed: ['AWAITING_APPROVAL'] } },
      ),
    });
    const done = { status: 'COMPLETED' as const };
    stub.on(`GET /candidates/${CANDIDATE_ID}/steps`, () =>
      jsonResponse(
        stepRail({
          SOURCING: done,
          PRICING: done,
          CATEGORY: done,
          THUMBNAIL: done,
          COPY: done,
          NOTICE_RAW: done,
          NOTICE_HTML: done,
          TAGS: done,
          UPLOAD: { status: 'RERUN_REQUIRED' },
        }),
      ),
    );
    open();
    const blockers = await screen.findByRole('list', { name: '승인 전에 끝낼 곳' });
    const links = within(blockers).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('⑧ 이미지 업로드 · 재실행 필요');
    expect(links[0]).toHaveAttribute('href', `/candidates/${CANDIDATE_ID}/approval`);
    expect(screen.getByRole('button', { name: '승인·등록' })).toBeDisabled();
  });
});
