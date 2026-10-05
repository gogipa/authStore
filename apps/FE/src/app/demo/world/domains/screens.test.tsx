import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY_DOC } from '@/test/fixtures/content';
import { renderDemoRoute } from '@/test/renderDemoRoute';
import type { DemoApi } from '../../demoApi';
import { reachThumbnailDone, reachUploadDone, startDemoKit } from '../testkit';

/**
 * ⑥~⑨ 화면 계층(D-32): 체험 화면을 실제로 그려 놓고 버튼을 누른다 — 내용 화면의 [여기부터 연속 실행], 최종 승인의 [승인·등록]과
 * 등록 API 차단 스위치. 전역 fetch·EventSource는 한 번도 부르지 않고, 표에 없는 요청도 모델 오류도 없다.
 */
const user = userEvent.setup();
const WAIT = { timeout: 5000 };

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch');
  vi.stubGlobal('EventSource', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 걸어 둔 체험 API(지연 없음)로 그린다. 요청 수를 센다 */
async function renderAfter(path: string, prepare: (demo: DemoApi) => Promise<void>) {
  const { demo, off } = startDemoKit();
  await prepare(demo);
  off();
  const requests: string[] = [];
  const rendered = renderDemoRoute(path, {
    demoApi: demo,
    override: (request) => {
      requests.push(`${request.method} ${new URL(request.url).pathname}`);
      return undefined;
    },
  });
  return { ...rendered, requests, demo };
}

function expectClean(demo: DemoApi) {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(demo.unknownRequests).toEqual([]);
  expect(demo.serverErrors).toEqual([]);
}

describe('⑥ 내용 화면', () => {
  it('[여기부터 연속 실행] → ⑥-1~⑧까지 돌고, 카피·원산지·고시가 그려진다', async () => {
    const { demo, queryClient } = await renderAfter('/candidates/1/content', reachThumbnailDone);
    await screen.findByRole('heading', { level: 1, name: '상세 콘텐츠' });
    // 실행 전: 세 구획 모두 안내 문구
    expect(
      await screen.findByText(
        '⑥-1을 실행하면 라쿠텐 상품명·설명·SKU 속성의 사실만으로 한국어 카피를 만듭니다.',
      ),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '여기부터 연속 실행' }, WAIT));

    // 카피 → 원산지·소재 → 고시·HTML 순으로 채워진다
    expect(await screen.findByDisplayValue(COPY_DOC.headline, undefined, WAIT)).toBeInTheDocument();
    const fact = within(screen.getByRole('region', { name: '⑥-2 원산지·소재' }));
    expect(await fact.findByText('베트남', undefined, WAIT)).toBeInTheDocument();
    expect(fact.getByText('색상 표기')).toBeInTheDocument();
    expect(fact.getAllByText('설명문에서 찾음').length).toBeGreaterThan(0);
    const notice = within(screen.getByRole('region', { name: '⑥-3 고시·HTML' }));
    expect(
      await notice.findByDisplayValue(
        '아식스 젤카야노14 1201A019-108 러닝화 크림 남성',
        undefined,
        WAIT,
      ),
    ).toBeInTheDocument();
    const frame = await screen.findByTitle('상세페이지 미리보기');
    expect(frame.getAttribute('src')).toMatch(/^data:text\/html/);

    await waitFor(() => expect(demo.world.s.steps.UPLOAD.status).toBe('COMPLETED'), WAIT);
    await waitFor(() => expect(demo.world.s.candidate?.status).toBe('AWAITING_APPROVAL'), WAIT);
    await waitFor(() => expect(queryClient.isFetching()).toBe(0), WAIT);
    expectClean(demo);
    // 눌렀을 때만 쓰는 요청 외에는 403 안내를 받은 일이 없다
    expect(demo.readOnlyRequests).toEqual([]);
  });

  it('⑥ 묶음 [실행]: ⑥-1 → ⑥-2 → ⑥-3만 돌고 ⑦은 시작하지 않는다', async () => {
    const { demo } = await renderAfter('/candidates/1/content', reachThumbnailDone);
    await screen.findByRole('heading', { level: 1, name: '상세 콘텐츠' });
    // 묶음 [실행] = 머리 줄의 첫 '실행' 버튼
    const buttons = await screen.findAllByRole('button', { name: '실행' });
    await user.click(buttons[0]!);
    await waitFor(() => expect(demo.world.s.steps.NOTICE_HTML.status).toBe('COMPLETED'), WAIT);
    expect(demo.world.s.steps.TAGS.status).toBe('NOT_RUN');
    expect(demo.world.s.steps.COPY.runs).toHaveLength(1);
    expectClean(demo);
  });
});

describe('⑦ 태그 화면', () => {
  it('[실행] → 최종 태그 10개, 경쟁 태그 입력은 비어 있다', async () => {
    const { demo } = await renderAfter('/candidates/1/tags', async (d) => {
      await reachThumbnailDone(d);
    });
    await screen.findByRole('heading', { level: 1, name: '태그' });
    await user.click(await screen.findByRole('button', { name: '실행' }));
    await waitFor(() => expect(demo.world.s.steps.TAGS.status).toBe('COMPLETED'), WAIT);
    expect(await screen.findByRole('list', { name: '최종 태그 10개' }, WAIT)).toBeInTheDocument();
    expect(await screen.findByText('10/10')).toBeInTheDocument();
    expectClean(demo);
  });
});

describe('최종 승인 화면', () => {
  it('열면 사전 검증이 한 번 돌고(끝없이 되풀이하지 않고) 13개 모두 통과, [승인·등록]이 켜진다', async () => {
    const { demo, queryClient, requests } = await renderAfter(
      '/candidates/1/approval',
      reachUploadDone,
    );
    await screen.findByRole('heading', { level: 1, name: '최종 승인' });
    expect((await screen.findAllByText('13개 모두 통과', undefined, WAIT)).length).toBeGreaterThan(
      0,
    );
    expect(await screen.findByRole('button', { name: '승인·등록' })).toBeEnabled();
    expect(
      screen.getByText(
        '등록 API 차단이 켜져 있어 지금 누르면 등록하지 않고 요청 내용과 검증 결과만 저장합니다.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '등록 API 차단' })).toBeChecked();
    // 되풀이 점검: 잠시 두어도 사전 검증 POST는 늘지 않는다
    await new Promise((r) => setTimeout(r, 80));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0), WAIT);
    const count = requests.filter((r) => r === 'POST /api/v1/candidates/1/pre-validations').length;
    expect(count).toBe(1);
    await new Promise((r) => setTimeout(r, 80));
    expect(requests.filter((r) => r.endsWith('/pre-validations')).length).toBe(count);
    expectClean(demo);
    expect(demo.readOnlyRequests).toEqual([]);
  });

  it('[승인·등록](차단 켬) → 검증완료 → 차단 끄기 → 다시 [승인·등록] → 등록요청중 → 등록됨(상품 번호)', async () => {
    const { demo, queryClient } = await renderAfter('/candidates/1/approval', reachUploadDone);
    await screen.findByRole('heading', { level: 1, name: '최종 승인' });
    const approve = await screen.findByRole('button', { name: '승인·등록' }, WAIT);
    await waitFor(() => expect(approve).toBeEnabled(), WAIT);
    await user.click(approve);

    // 드라이런: ⑨ 칩·직전 결과가 '검증완료', 여정은 검증완료라 승인 미리보기는 409 안내
    const register = within(screen.getByRole('region', { name: '⑨ 등록' }));
    expect((await register.findAllByText('검증완료', undefined, WAIT)).length).toBeGreaterThan(0);
    expect(
      await register.findByText(/검증완료\(드라이런\)로 저장했습니다/, undefined, WAIT),
    ).toBeInTheDocument();
    // 위 안내 띠와 승인 바의 꺼진 이유, 두 곳에 같은 문구가 보인다
    expect(
      (
        await screen.findAllByText(
          '지금 여정 상태(검증완료)에서는 할 수 없습니다.',
          undefined,
          WAIT,
        )
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: '승인·등록' })).toBeDisabled();
    expect(demo.world.s.candidate?.status).toBe('VALIDATED');

    // 차단 끄기 → 승인대기로 돌아와 다시 승인할 수 있다
    await user.click(screen.getByRole('switch', { name: '등록 API 차단' }));
    await waitFor(() => expect(demo.world.s.candidate?.status).toBe('AWAITING_APPROVAL'), WAIT);
    expect(
      await screen.findByText(
        '등록 API 차단이 꺼져 있습니다. 승인하면 실제 스마트스토어에 등록합니다.',
        undefined,
        WAIT,
      ),
    ).toBeInTheDocument();
    const again = await screen.findByRole('button', { name: '승인·등록' });
    await waitFor(() => expect(again).toBeEnabled(), WAIT);
    // 차단이 꺼져 있으면 '드라이런' 안내 글이 없다. 버튼 글자는 그대로다
    expect(screen.queryByText(/지금 누르면 등록하지 않고/)).toBeNull();
    await user.click(again);

    // 실등록: 지연 뒤 등록됨 + 상품 번호
    await waitFor(() => expect(demo.world.s.candidate?.status).toBe('REGISTERED'), WAIT);
    expect(await register.findByText(/상품 번호 10000000001/, undefined, WAIT)).toBeInTheDocument();
    expect(register.getAllByText('등록됨').length).toBeGreaterThan(0);
    await waitFor(() => expect(queryClient.isFetching()).toBe(0), WAIT);
    expect(demo.world.s.registration.records.map((r) => r.status)).toEqual([
      'VALIDATED',
      'REGISTERED',
    ]);
    expectClean(demo);
    expect(demo.readOnlyRequests).toEqual([]);

    // 스위치를 다시 켠다 — 여정은 그대로 등록됨
    await user.click(screen.getByRole('switch', { name: '등록 API 차단' }));
    await waitFor(() => expect(demo.world.s.registration.apiBlocked).toBe(true), WAIT);
    expect(demo.world.s.candidate?.status).toBe('REGISTERED');
    expect(demo.world.progress().registered).toBe(true);
  });
});
