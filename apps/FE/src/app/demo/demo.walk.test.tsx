import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_GUIDE_TEXT, DEMO_TEXT } from '@/features/guide';
import { renderDemoRoute } from '@/test/renderDemoRoute';

/**
 * 따라 하기 걷기(D-32) — 화면 계층: 체험 화면을 실제로 그려 놓고 사용자가 누르는 그대로 빈 상태에서 ⑨ 등록까지 클릭한다.
 * 단계마다 띠의 '다음에 할 일' 글, 레일 상태, 대시보드·여정 목록 반영을 확인하고, 끝에서 [처음부터 다시]로 되돌린다.
 * 전체를 지연 0으로 돌리고(모델의 결과는 다음 틱에 나온다) 전역 fetch·EventSource는 한 번도 부르지 않는다.
 */
const user = userEvent.setup();

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch');
  vi.stubGlobal('EventSource', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const WAIT = { timeout: 5000 };

const banner = () => screen.getByRole('region', { name: DEMO_TEXT.label });
const guideText = () => within(banner()).getByRole('status');
const action = (id: keyof typeof DEMO_GUIDE_TEXT.actions) =>
  `${DEMO_GUIDE_TEXT.actions[id].step} ${DEMO_GUIDE_TEXT.actions[id].text}`;

async function expectGuide(id: keyof typeof DEMO_GUIDE_TEXT.actions, done: number) {
  await waitFor(() => expect(guideText()).toHaveTextContent(action(id)), WAIT);
  expect(banner()).toHaveTextContent(`${done}/19단계`);
}

/** 여정 틀의 단계 레일에서 한 단계 링크(jsdom은 칸 사이 공백을 접근 이름에 넣지 않아 공백을 뺀 글로 비교한다) */
const squash = (text: string) => text.replace(/\s/g, '');
const rail = () => within(screen.getByRole('navigation', { name: '단계' }));
const railLink = (label: string) =>
  rail()
    .getAllByRole('link')
    .find((link) =>
      squash(link.getAttribute('aria-label') ?? link.textContent ?? '').startsWith(squash(label)),
    )!;
async function expectStep(label: string, status: string) {
  await waitFor(() => {
    const link = rail()
      .getAllByRole('link')
      .find((l) =>
        squash(l.getAttribute('aria-label') ?? l.textContent ?? '').startsWith(squash(label)),
      );
    expect(squash(link?.getAttribute('aria-label') ?? link?.textContent ?? '')).toBe(
      squash(`${label} ${status}`),
    );
  }, WAIT);
}

describe('체험 따라 하기 걷기 — 빈 상태에서 ⑨ 등록까지 클릭', () => {
  it('①→⑨를 띠 안내대로 누르고, 처음부터 다시로 되돌린다', async () => {
    const { router, queryClient, demoApi } = renderDemoRoute('/');
    await screen.findByRole('heading', { level: 1, name: '대시보드' });
    await expectGuide('collect', 0);

    // ── ① 키워드 ──
    await user.click(within(banner()).getByRole('link', { name: '① 키워드 화면 열기' }));
    await screen.findByRole('heading', { level: 1, name: '키워드' });
    expect(router.state.location.pathname).toBe('/demo/keywords');
    expect(within(banner()).queryByRole('link', { name: /화면 열기$/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: '수집' }));
    await expectGuide('useKeyword', 1);
    // 여성신발이 먼저 보인다 — 남성신발로 바꾼다
    await user.click(screen.getByRole('button', { name: '남성신발' }));
    const row = (await screen.findByText('아식스 젤카야노14', undefined, WAIT)).closest('tr')!;
    // 아동 단어 줄은 목록에 없다
    expect(screen.queryByText('키즈 운동화')).toBeNull();
    // 줄마다 라디오 하나로 고른다 — [검색어로 쓰기] 버튼과 '동작' 열은 없다(D-33)
    expect(screen.queryByRole('button', { name: '검색어로 쓰기' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '동작' })).toBeNull();
    const query = screen.getByRole('region', { name: '라쿠텐 검색어 확인' });
    expect(within(query).getByRole('button', { name: '이 검색어로 소싱' })).toBeDisabled();
    // 다른 줄을 먼저 고르면 오른쪽 패널이 그 키워드로 바뀌고, 안내한 줄로 바꾸면 고른 줄이 바뀐다(하나만 고른다)
    const other = screen.getByRole('radio', { name: '뉴발란스 530 고르기' });
    await user.click(other);
    await waitFor(() => expect(query).toHaveTextContent('뉴발란스 530'), WAIT);
    await expectGuide('startSourcing', 2);
    const asics = within(row).getByRole('radio', { name: '아식스 젤카야노14 고르기' });
    await user.click(asics);
    await waitFor(() => expect(query).toHaveTextContent('아식스 젤카야노14'), WAIT);
    expect(query).not.toHaveTextContent('뉴발란스 530');
    expect(asics).toBeChecked();
    expect(other).not.toBeChecked();
    await waitFor(() => expect(query).toHaveTextContent('G1 키워드 선택 · 통과'), WAIT);
    expect(within(query).getByRole('button', { name: '이 검색어로 소싱' })).toBeEnabled();
    await expectGuide('startSourcing', 2);
    await user.click(within(query).getByRole('button', { name: '이 검색어로 소싱' }));
    // 검색이 끝나기 전엔 '같은 상품을 파는 샵 비교', 끝나면 '상품 고르기'(D-47)
    await screen.findByRole(
      'heading',
      { level: 1, name: /상품 고르기|같은 상품을 파는 샵 비교/ },
      WAIT,
    );
    expect(router.state.location.pathname).toBe('/demo/candidates/1/sourcing');
    await expectStep('② 소싱', '입력 대기');
    await expectGuide('anchor', 3);

    // 대시보드·여정 목록에 방금 만든 여정이 보인다
    await router.navigate('/');
    await screen.findByText(/이어서 할 곳:/, undefined, WAIT);
    await router.navigate('/candidates');
    // 여정 이름은 ② 상품을 고르기 전에는 라쿠텐 검색어다 — 소싱을 누를 때 AI가 일본어로 바꾼 검색어(체험은 정해 둔 예시)
    await screen.findAllByText('アシックス ゲルカヤノ14', undefined, WAIT);
    await router.navigate('/candidates/1/sourcing');

    // ── ② 소싱 ──
    await screen.findByRole('heading', { level: 1, name: '상품 고르기' }, WAIT);
    // 쇼핑몰 같은 검색 결과 목록: 관련도 순(ショップL이 맨 위, ショップA는 다섯 번째)이고 미리 골라진 항목은 없다
    const list = await screen.findByRole('list', { name: '라쿠텐 검색 결과' }, WAIT);
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(8);
    expect(items[0]).toHaveTextContent('ショップL');
    const pickA = items.find((item) => item.textContent?.includes('ショップA'))!;
    await user.click(within(pickA).getByRole('button', { name: '이 상품으로 정하기' }));
    await expectGuide('pickShop', 4);
    const table = await screen.findByRole('table', { name: '같은 상품을 파는 샵 비교' });
    await waitFor(() => expect(table).toHaveTextContent('재고 확인 4'), WAIT);
    // 같은 상품인지 확실하지 않은 ショップK는 접혀 있다
    expect(table).toHaveTextContent('같은 상품인지 확실하지 않은 1개');
    expect(within(table).queryByRole('row', { name: 'ショップK' })).toBeNull();
    const shopA = within(table).getByRole('row', { name: 'ショップA' });
    await user.click(within(shopA).getByRole('radio', { name: 'ショップA 고르기' }));
    await expectStep('② 소싱', '완료');
    await expectGuide('domesticPrice', 5);

    // ── ③ 판정 ──
    await user.click(railLink('③ 판정'));
    const pricing = await screen.findByRole('region', { name: '③ 판정' });
    await user.type(
      within(pricing).getByRole('textbox', { name: '국내 기준가 · 판매가 + 고객 배송비' }),
      '169000',
    );
    await user.click(within(pricing).getByRole('button', { name: '저장' }));
    await expectGuide('runPricing', 6);
    await user.click(within(pricing).getByRole('button', { name: '실행' }));
    await expectStep('③ 판정', '완료');
    await waitFor(
      () =>
        expect(within(pricing).getByRole('region', { name: '가격 요약' })).toHaveTextContent(
          '167,300원',
        ),
      WAIT,
    );
    await expectGuide('passG2', 7);
    const confirm = screen.getByRole('region', { name: '소싱 확정' });
    await user.click(within(confirm).getByRole('button', { name: '소싱 확정(G2)' }));
    await waitFor(() => expect(confirm).toHaveTextContent('G2 판정 확정 · 통과'), WAIT);
    await expectGuide('runCategory', 8);

    // ── ④ 카테고리 ──
    const category = screen.getByRole('region', { name: '④ 카테고리' });
    await user.click(within(category).getByRole('button', { name: '실행' }));
    await expectStep('④ 카테고리', '입력 대기');
    await expectGuide('chooseLeaf', 9);
    await user.click(
      await within(category).findByRole('radio', { name: '패션잡화 > 남성신발 > 운동화 > 러닝화' }),
    );
    await user.click(within(category).getByRole('button', { name: '이 카테고리로 확정' }));
    await expectStep('④ 카테고리', '완료');
    await expectGuide('runThumbnail', 10);

    // ── ⑤ 썸네일 ──
    await user.click(railLink('⑤ 썸네일'));
    const thumbnail = await screen.findByRole('region', { name: '⑤ 썸네일' });
    await user.click(within(thumbnail).getByRole('button', { name: '실행' }));
    await expectStep('⑤ 썸네일', '입력 대기');
    await expectGuide('references', 11);
    await user.click(await screen.findByRole('checkbox', { name: '원본 1 레퍼런스' }));
    await user.click(screen.getByRole('checkbox', { name: '레퍼런스에 사람·얼굴 없음' }));
    await expectGuide('generate', 12);
    await user.click(await screen.findByRole('button', { name: '만들기' }));
    await screen.findByRole('img', { name: '후보 2 생성 이미지' }, WAIT);
    await expectGuide('pickThumbnail', 13);
    await user.click(screen.getByRole('radio', { name: '후보 1 대표' }));
    await user.click(screen.getByRole('checkbox', { name: '후보 2 추가' }));
    const checklist = screen.getByRole('region', { name: '선택 전 확인' });
    for (const box of within(checklist).getAllByRole('checkbox')) {
      if (!(box as HTMLInputElement).checked && !(box as HTMLInputElement).disabled) {
        await user.click(box);
      }
    }
    await user.click(within(checklist).getByRole('button', { name: '썸네일 선택(G3)' }));
    await expectStep('⑤ 썸네일', '완료');
    await expectGuide('runChain', 14);

    // ── ⑥ 연속 실행 → ⑧까지 ──
    await user.click(railLink('⑥ 상세 콘텐츠'));
    const content = await screen.findByRole('region', { name: '⑥ 상세 콘텐츠' });
    await user.click(within(content).getAllByRole('button', { name: '여기부터 연속 실행' })[0]!);
    for (const label of [
      '⑥-1 카피',
      '⑥-2 원산지·소재',
      '⑥-3 고시·HTML',
      '⑦ 태그',
      '⑧ 이미지 업로드',
    ]) {
      await expectStep(label, '완료');
    }
    await expectGuide('approveDryRun', 15);
    // 필수 9단계가 끝나고 G2·G3가 유효해서 여정이 승인대기가 됐다
    expect(demoApi.world.s.candidate?.status).toBe('AWAITING_APPROVAL');

    // ── 최종 승인: 드라이런 → 차단 끄기 → 등록 → 차단 켜기 ──
    await user.click(railLink('⑧ 이미지 업로드'));
    await screen.findByRole('heading', { level: 1, name: '최종 승인' });
    const register = await screen.findByRole('region', { name: '⑨ 등록' });
    const approve = () => within(register).getByRole('button', { name: '승인·등록' });
    await waitFor(() => expect(approve()).toBeEnabled(), WAIT);
    await user.click(approve());
    await waitFor(
      () =>
        expect(screen.getByRole('region', { name: '⑧ 이미지 업로드' })).toHaveTextContent(
          '여정 상태 검증완료',
        ),
      WAIT,
    );
    await expectGuide('switchOff', 16);
    const toggle = screen.getByRole('switch', { name: '등록 API 차단' });
    await user.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked(), WAIT);
    await expectGuide('approve', 17);
    await waitFor(() => expect(approve()).toBeEnabled(), WAIT);
    await user.click(approve());
    await waitFor(() => expect(register).toHaveTextContent('상품 번호'), WAIT);
    await expectGuide('switchOn', 18);
    expect(within(banner()).getByRole('link', { name: DEMO_TEXT.candidate })).toBeInTheDocument();
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked(), WAIT);
    await waitFor(() => expect(guideText()).toHaveTextContent(DEMO_GUIDE_TEXT.finished), WAIT);
    expect(banner()).toHaveTextContent('19/19단계');

    // 등록된 여정은 여정 목록(진행 중)에서 빠진다
    await router.navigate('/candidates');
    await screen.findByRole('heading', { level: 1, name: '여정' });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0), WAIT);
    expect(screen.queryByText('아식스 젤카야노14 · 크림/블랙')).toBeNull();

    // ── 처음부터 다시 ──
    await user.click(within(banner()).getByRole('button', { name: DEMO_GUIDE_TEXT.restart }));
    await screen.findByRole('heading', { level: 1, name: '키워드' }, WAIT);
    expect(router.state.location.pathname).toBe('/demo/keywords');
    await expectGuide('collect', 0);
    // 첫 할 일이 이 화면에 있어 이동 링크가 없다
    expect(within(banner()).queryByRole('link', { name: /화면 열기$/ })).toBeNull();
    expect(within(banner()).queryByRole('link', { name: DEMO_TEXT.candidate })).toBeNull();
    expect(demoApi.world.s.candidate).toBeNull();
    expect(demoApi.world.s.keywords.snapshot).toBeNull();

    // 끝까지 네트워크·표 밖 요청·모델 오류가 없었다
    expect(fetch).not.toHaveBeenCalled();
    expect(demoApi.unknownRequests).toEqual([]);
    expect(demoApi.serverErrors).toEqual([]);
    expect(demoApi.readOnlyRequests).toEqual([]);
  }, 60_000);

  it('마음대로 돌아다녀도 띠는 지금 상태를 따르고, 순서를 어기면 실제 앱의 오류가 보인다', async () => {
    const { router } = renderDemoRoute('/keywords');
    await screen.findByRole('heading', { level: 1, name: '키워드' });
    await user.click(screen.getByRole('button', { name: '수집' }));
    await expectGuide('useKeyword', 1);
    // 여정 화면에는 아직 갈 수 없다(여정 없음)
    await router.navigate('/candidates/1/judgement');
    expect(
      await screen.findByRole('heading', { level: 1, name: '여정을 찾을 수 없습니다' }),
    ).toBeInTheDocument();
    // 띠는 어디에서나 같은 말을 한다
    await expectGuide('useKeyword', 1);
    // 설정 같은 길 밖 화면에서도 띠가 같고 [① 키워드 화면 열기]가 키워드로 간다
    await router.navigate('/settings');
    await screen.findByRole('heading', { level: 1, name: '설정' });
    await user.click(within(banner()).getByRole('link', { name: '① 키워드 화면 열기' }));
    await screen.findByRole('heading', { level: 1, name: '키워드' });
    expect(router.state.location.pathname).toBe('/demo/keywords');
  });

  it('키워드는 묶음에서 하나만 고른다 — 분야를 바꾸거나 다른 화면에 다녀와도 같은 줄이 골라져 있다', async () => {
    const { router, demoApi } = renderDemoRoute('/keywords');
    await screen.findByRole('heading', { level: 1, name: '키워드' });
    await user.click(screen.getByRole('button', { name: '수집' }));
    await expectGuide('useKeyword', 1);
    await user.click(screen.getByRole('button', { name: '남성신발' }));
    const query = screen.getByRole('region', { name: '라쿠텐 검색어 확인' });
    await user.click(await screen.findByRole('radio', { name: '아식스 젤카야노14 고르기' }));
    await waitFor(() => expect(query).toHaveTextContent('아식스 젤카야노14'), WAIT);
    await expectGuide('startSourcing', 2);

    // 다른 분야에서 고르면 묶음 전체에서 그 줄 하나가 지금 고른 키워드다(앞서 고른 줄은 고른 채로 남지 않는다)
    await user.click(screen.getByRole('button', { name: '여성신발' }));
    await user.click(await screen.findByRole('radio', { name: '나이키 에어포스1 고르기' }));
    await waitFor(() => expect(query).toHaveTextContent('나이키 에어포스1'), WAIT);
    expect(query).not.toHaveTextContent('아식스 젤카야노14');
    await user.click(screen.getByRole('button', { name: '남성신발' }));
    expect(
      await screen.findByRole('radio', { name: '아식스 젤카야노14 고르기' }),
    ).not.toBeChecked();
    // 앞서 고른 아식스의 고른 시각(승인 이력)은 남아 있다
    expect(Object.keys(demoApi.world.s.keywords.selected).sort()).toEqual(['101', '200']);

    // 다른 화면에 다녀와도(새로고침과 같다) 지금 고른 줄이 그대로다
    await router.navigate('/settings');
    await screen.findByRole('heading', { level: 1, name: '설정' });
    await router.navigate('/keywords');
    await screen.findByRole('heading', { level: 1, name: '키워드' });
    await waitFor(
      () =>
        expect(screen.getByRole('region', { name: '라쿠텐 검색어 확인' })).toHaveTextContent(
          '나이키 에어포스1',
        ),
      WAIT,
    );
    await expectGuide('startSourcing', 2);
  });
});
