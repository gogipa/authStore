import type { Page } from '@playwright/test';
import { expect, test } from './support/flow-fixtures';
import {
  approve,
  blockSwitch,
  candidateIdOf,
  DOMESTIC_PRICE_KRW,
  expectCandidateStatus,
  expectStep,
  KEYWORD,
  OTHER_KEYWORD,
  passG3Checklist,
  railStep,
  registerRegion,
  RUNNING_LEAF,
  searchResultItem,
  SHOP_A_ITEM_NAME,
  SHOP_A_NAME,
  turnOffBlockSwitch,
} from './support/flow-steps';

/**
 * 체험(`/demo`, F-GD-05, D-31·D-32) — 실제 브라우저에서 빈 상태부터 ⑨ 등록까지 실제 클릭으로 따라 한다.
 * 공통 fixture가 127.0.0.1 밖 요청을 막고 세며, 여기서는 체험이 `/api`(조회·진행 알림 SSE 모두)를 한 번도 부르지 않는지와 서비스
 * 워커가 없는지를 본다. 화면 하나하나(예시 데이터·띠·글)는 Vitest(app/demo/*.test.tsx)가 본다. [체험 끝내기]로 나간 보통 앱은
 * 가짜 BE를 부른다.
 */
const banner = (page: Page) => page.getByRole('region', { name: '체험', exact: true });
const guide = (page: Page) => banner(page).getByRole('status');

/** ① [수집] → 남성신발 '아식스 젤카야노14' 줄 고르기 → [이 검색어로 소싱] = 여정 만들기 + ② 실행 */
async function collectAndStartSourcing(page: Page) {
  await page.getByRole('button', { name: '수집', exact: true }).click();
  // 받는 동안 띠는 기다리라고 하고 [수집]은 꺼져 있다(수집 중)
  await expect(guide(page)).toContainText('잠시 기다려 주세요');
  await expect(page.getByRole('button', { name: '수집', exact: true })).toBeDisabled();
  await expect(banner(page)).toContainText('1/19단계', { timeout: 15_000 });
  await page.getByRole('button', { name: '남성신발', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: KEYWORD });
  await expect(row).toBeVisible();
  // 아동 단어 줄은 목록에서 빠지고 '제외됨'에만 있다(F-KW-06)
  await expect(page.getByRole('row').filter({ hasText: '키즈 운동화' })).toHaveCount(0);
  await expect(guide(page)).toContainText(`'${KEYWORD}' 줄을 고르세요`);
  // 키워드는 줄마다 라디오 하나로 하나만 고른다 — [검색어로 쓰기] 버튼은 없다(D-33)
  await expect(page.getByRole('button', { name: '검색어로 쓰기' })).toHaveCount(0);
  const panel = page.getByRole('region', { name: '라쿠텐 검색어 확인' });
  await expect(panel.getByRole('button', { name: '이 검색어로 소싱' })).toBeDisabled();
  // 다른 줄을 먼저 고르면 패널이 그 키워드로 바뀌고, 안내한 줄로 바꾸면 고른 줄이 바뀐다
  const other = page.getByRole('radio', { name: `${OTHER_KEYWORD} 고르기` });
  await other.click();
  await expect(panel).toContainText(OTHER_KEYWORD);
  const pick = row.getByRole('radio', { name: `${KEYWORD} 고르기` });
  await pick.click();
  await expect(pick).toBeChecked();
  await expect(other).not.toBeChecked();
  await expect(panel).toContainText(KEYWORD);
  await expect(panel).toContainText('G1 키워드 선택 · 통과');
  await expect(guide(page)).toContainText('[이 검색어로 소싱]');
  await panel.getByRole('button', { name: '이 검색어로 소싱' }).click();
  await page.waitForURL(/\/demo\/candidates\/\d+\/sourcing$/);
  await expectStep(page, '② 소싱', '입력 대기');
}

/** ② 상품 고르기(ショップA 줄의 [이 상품으로 정하기]) → 페이지 조회 → ショップA 고르기 = ② 완료 */
async function anchorAndPickShopA(page: Page) {
  await expect(guide(page)).toContainText('[이 상품으로 정하기]');
  // 쇼핑몰 같은 목록: 맨 위 줄을 미리 고르지 않고, 관련도 순에서 ショップA 줄을 찾아 누른다
  await expect(page.getByRole('heading', { level: 1, name: '상품 고르기' })).toBeVisible();
  await searchResultItem(page, SHOP_A_NAME, SHOP_A_ITEM_NAME)
    .getByRole('button', { name: '이 상품으로 정하기' })
    .click();
  const table = page.getByRole('table', { name: '같은 상품을 파는 샵 비교' });
  await expect(table).toContainText('재고 확인 4', { timeout: 15_000 });
  // 같은 상품인지 확실하지 않은 ショップK 줄은 접혀 있다
  await expect(table).toContainText('같은 상품인지 확실하지 않은 1개');
  const shopA = table.getByRole('row', { name: 'ショップA', exact: true });
  await expect(shopA).toContainText('¥11,455');
  await expect(guide(page)).toContainText('ショップA 줄을 고르세요');
  await shopA.getByRole('radio', { name: 'ショップA 고르기' }).click();
  await expectStep(page, '② 소싱', '완료');
}

/** ③ 국내 기준가 [저장] → [실행] → [소싱 확정(G2)] */
async function judgeAndPassG2(page: Page) {
  await railStep(page, '③ 판정').click();
  const pricing = page.getByRole('region', { name: '③ 판정' });
  await pricing
    .getByRole('textbox', { name: '국내 기준가 · 판매가 + 고객 배송비' })
    .fill(DOMESTIC_PRICE_KRW);
  await pricing.getByRole('button', { name: '저장' }).click();
  await expect(pricing.getByRole('region', { name: '국내 기준가' })).toContainText('입력 ·');
  await pricing.getByRole('button', { name: '실행', exact: true }).click();
  await expectStep(page, '③ 판정', '완료');
  await expect(pricing.getByRole('region', { name: '가격 요약' })).toContainText('167,300원');
  const confirm = page.getByRole('region', { name: '소싱 확정' });
  await confirm.getByRole('button', { name: '소싱 확정(G2)' }).click();
  await expect(confirm).toContainText('G2 판정 확정 · 통과');
}

/** ④ [실행] → 러닝화 → [이 카테고리로 확정] */
async function pickCategory(page: Page) {
  const category = page.getByRole('region', { name: '④ 카테고리' });
  await category.getByRole('button', { name: '실행', exact: true }).click();
  await expectStep(page, '④ 카테고리', '입력 대기');
  await category.getByRole('radio', { name: RUNNING_LEAF }).check();
  await category.getByRole('button', { name: '이 카테고리로 확정' }).click();
  await expectStep(page, '④ 카테고리', '완료');
}

/** ⑤ [실행] → 레퍼런스·사람 없음 → [만들기] → 대표·추가 → 체크리스트 → G3 */
async function makeThumbnailAndPassG3(page: Page) {
  await railStep(page, '⑤ 썸네일').click();
  const thumbnail = page.getByRole('region', { name: '⑤ 썸네일' });
  await thumbnail.getByRole('button', { name: '실행', exact: true }).click();
  await expectStep(page, '⑤ 썸네일', '입력 대기');
  await page.getByRole('checkbox', { name: '원본 1 레퍼런스' }).check();
  const noPerson = page.getByRole('checkbox', { name: '레퍼런스에 사람·얼굴 없음' });
  await noPerson.click();
  await expect(noPerson).toBeChecked();
  await page.getByRole('button', { name: '만들기' }).click();
  await expect(page.getByRole('img', { name: '후보 2 생성 이미지' })).toBeVisible();
  await page.getByRole('radio', { name: '후보 1 대표' }).check();
  await page.getByRole('checkbox', { name: '후보 2 추가' }).check();
  await passG3Checklist(page);
  await expectStep(page, '⑤ 썸네일', '완료');
}

/** ⑥ [여기부터 연속 실행] → ⑥-1·⑥-2·⑥-3·⑦·⑧이 차례로 완료(약 4초, 최종 승인 앞에서 멈춤) */
async function runContentChain(page: Page) {
  await railStep(page, '⑥ 상세 콘텐츠').click();
  await page
    .getByRole('region', { name: '⑥ 상세 콘텐츠' })
    .getByRole('button', { name: '여기부터 연속 실행' })
    .first()
    .click();
  for (const label of [
    '⑥-1 카피',
    '⑥-2 원산지·소재',
    '⑥-3 고시·HTML',
    '⑦ 태그',
    '⑧ 이미지 업로드',
  ] as const) {
    await expectStep(page, label, '완료', 30_000);
  }
}

test('체험 따라 하기: 빈 상태 → ①~⑨ 등록까지 실제 클릭, /api·EventSource·서비스 워커 없음, [처음부터 다시]·[체험 끝내기]', async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  // ── 빈 상태로 시작 ──
  await page.goto('/demo');
  await expect(page.getByRole('heading', { level: 1, name: '대시보드' })).toBeVisible();
  await expect(banner(page)).toContainText(
    '체험 — 직접 눌러 보며 따라 하는 연습입니다. 서버를 부르지 않고 예시 결과가 나오며 실제로 등록되지 않습니다.',
  );
  await expect(page).toHaveTitle('대시보드 · 스마트스토어 정복 (체험)');
  await expect(banner(page)).toContainText('0/19단계');
  await expect(guide(page)).toContainText('① 키워드 [수집]을 누르세요.');
  // 시작 준비는 5개 모두 완료(설정 마법사가 저절로 열리지 않는다), 여정은 아직 없다
  await expect(page.getByRole('region', { name: '시작 준비' })).toContainText('5개 중 5개 완료');
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole('link', { name: '등록된 여정 보기' })).toHaveCount(0);

  // ── ① 키워드: 대시보드에서 시작했으니 띠의 [① 키워드 화면 열기]로 간다(입구 버튼은 처음부터 키워드를 연다) ──
  await banner(page).getByRole('link', { name: '① 키워드 화면 열기' }).click();
  await expect(page).toHaveURL(/\/demo\/keywords$/);
  await expect(page.getByRole('heading', { level: 1, name: '키워드' })).toBeVisible();
  await collectAndStartSourcing(page);
  const candidateId = candidateIdOf(page);

  // 대시보드에 방금 만든 여정이 진행 중으로 보인다(띠는 어느 화면에서나 같은 상태를 말한다)
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('link', { name: '대시보드' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: '대시보드' })).toBeVisible();
  await expect(page.getByText('이어서 할 곳:')).toBeVisible();
  await expect(banner(page)).toContainText('3/19단계');
  await expect(banner(page).getByRole('link', { name: '② 소싱 화면 열기' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/demo\/candidates\/\d+\/sourcing$/);
  await expectStep(page, '② 소싱', '입력 대기');

  // ── ② ~ ⑤ ──
  await anchorAndPickShopA(page);
  await judgeAndPassG2(page);
  await pickCategory(page);
  await makeThumbnailAndPassG3(page);

  // ── ⑥ 연속 실행 → ⑥-1·⑥-2·⑥-3·⑦·⑧이 차례로 완료(최종 승인 앞에서 멈춤) ──
  await runContentChain(page);

  // ── 최종 승인: 차단 켬 = 드라이런 → 차단 끄기 → 등록 → 차단 켜기 ──
  await railStep(page, '⑧ 이미지 업로드').click();
  await page.waitForURL(new RegExp(`/demo/candidates/${candidateId}/approval$`));
  // 사전 검증은 화면을 열 때 한 번 돌아 15개를 13줄로 합쳐 모두 통과로 보인다
  await expect(page.getByRole('region', { name: '사전 검증 결과' })).toContainText(
    '13개 모두 통과',
  );
  await expect(page.getByRole('region', { name: '⑧ 이미지 업로드' })).toContainText('승인대기');
  await approve(page);
  await expectCandidateStatus(page, '검증완료');
  await expect(registerRegion(page)).toContainText('검증완료');
  await expect(guide(page)).toContainText("'등록 API 차단' 스위치를 끄세요");
  await turnOffBlockSwitch(page);
  await expectCandidateStatus(page, '승인대기');
  await approve(page);
  await expect(registerRegion(page)).toContainText('상품 번호', { timeout: 15_000 });
  await expectCandidateStatus(page, '등록됨');
  await expect(guide(page)).toContainText("'등록 API 차단' 스위치를 다시 켜 두세요");
  await blockSwitch(page).click();
  await expect(blockSwitch(page)).toBeChecked();
  await expect(banner(page)).toContainText('19/19단계');
  await expect(guide(page)).toContainText('끝까지 따라 하셨습니다.');

  // 등록된 여정은 M1 목록에 보이지 않고, 띠 [등록된 여정 보기]로 연다
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('link', { name: '여정' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: '여정' })).toBeVisible();
  await expect(page.getByText(KEYWORD)).toHaveCount(0);
  await banner(page).getByRole('link', { name: '등록된 여정 보기' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '최종 승인' })).toBeVisible();
  await expect(registerRegion(page)).toContainText('등록됨');

  expect(await page.evaluate(() => navigator.serviceWorker?.controller ?? null)).toBeNull();
  expect(apiRequests, '체험이 /api를 불렀다').toEqual([]);
  expect(pageErrors).toEqual([]);

  // ── [처음부터 다시]: 빈 상태로 되돌리고 첫 할 일이 있는 키워드 화면에 머문다 ──
  await banner(page).getByRole('button', { name: '처음부터 다시' }).click();
  await expect(page).toHaveURL(/\/demo\/keywords$/);
  await expect(page.getByRole('heading', { level: 1, name: '키워드' })).toBeVisible();
  await expect(banner(page)).toContainText('0/19단계');
  await expect(guide(page)).toContainText('① 키워드 [수집]을 누르세요.');
  await expect(page.getByRole('link', { name: '등록된 여정 보기' })).toHaveCount(0);

  // 새로 고쳐도(전체 로드) 체험이 빈 상태로 다시 켜진다
  await page.reload();
  await expect(banner(page)).toContainText('0/19단계');

  // 따라 하기 길 밖 동작은 체험 글을 보인다
  await page
    .getByRole('navigation', { name: '주 메뉴' })
    .getByRole('link', { name: '시스템 상태' })
    .click();
  const metaSync = page.getByRole('region', { name: '메타데이터 동기화' });
  await metaSync.getByRole('button', { name: '지금 동기화' }).click();
  await expect(metaSync.getByRole('alert')).toContainText(
    '체험에서는 이 동작을 실행하지 않습니다. 띠에서 안내하는 순서대로 눌러 보세요.',
  );
  expect(apiRequests, '체험이 /api를 불렀다').toEqual([]);

  // 끝내기: basename 밖 앱 첫 화면으로 전체 이동(보통 앱 — 여기부터는 가짜 BE를 부른다)
  // (시작 준비에 할 일이 남아 있으면 대시보드가 설정 마법사를 이 탭에서 한 번 연다 — D-30)
  await banner(page).getByRole('link', { name: '체험 끝내기' }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(setup)?$/);
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^(대시보드|설정 마법사)$/);
  await expect(banner(page)).toHaveCount(0);
  await expect(page).not.toHaveTitle(/\(체험\)/);
});

/** 왼쪽 단계 목록 아래 [재실행 필요 단계 모두 실행] */
const rerunAll = (page: Page) =>
  page.getByRole('button', { name: '재실행 필요 단계 모두 실행', exact: true });

test('체험 되돌아가기: ⑤ 대표를 다시 고르면 ⑧이, ④ 리프를 바꾸면 ⑥-3·⑦이, ③ 금액을 바꾸면 ③이 재실행 필요 — [재실행 필요 단계 모두 실행]이 고친다', async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/demo/keywords');
  await collectAndStartSourcing(page);
  await anchorAndPickShopA(page);
  await judgeAndPassG2(page);
  await pickCategory(page);
  await makeThumbnailAndPassG3(page);
  await runContentChain(page);
  await railStep(page, '⑧ 이미지 업로드').click();
  await expectCandidateStatus(page, '승인대기');
  await expect(rerunAll(page)).toBeDisabled();

  // ── (1) ⑤ 대표를 후보 2로 다시 고르고 G3을 다시 통과 → ⑧만 재실행 필요, 승인 막힘 (실제 BE flow-failures #4) ──
  await railStep(page, '⑤ 썸네일').click();
  await page.getByRole('radio', { name: '후보 2 대표' }).check();
  await passG3Checklist(page);
  await expectStep(page, '⑧ 이미지 업로드', '재실행 필요');
  for (const label of [
    '⑤ 썸네일',
    '⑥-1 카피',
    '⑥-2 원산지·소재',
    '⑥-3 고시·HTML',
    '⑦ 태그',
  ] as const) {
    await expectStep(page, label, '완료');
  }
  await expect(guide(page)).toContainText('재실행 필요');
  await expect(guide(page)).toContainText('⑧ 이미지 업로드');
  await expect(guide(page)).toContainText('[재실행 필요 단계 모두 실행]');
  await railStep(page, '⑧ 이미지 업로드').click();
  await page.waitForURL(/\/demo\/candidates\/\d+\/approval$/);
  await expectCandidateStatus(page, '작업중');
  await expect(registerRegion(page).getByRole('button', { name: '승인·등록' })).toBeDisabled();
  await expect(registerRegion(page)).toContainText('지금 여정 상태(작업중)에서는 할 수 없습니다.');
  await expect(rerunAll(page)).toBeEnabled();
  await rerunAll(page).click();
  await expectStep(page, '⑧ 이미지 업로드', '완료', 30_000);
  await expectCandidateStatus(page, '승인대기');
  await expect(registerRegion(page).getByRole('button', { name: '승인·등록' })).toBeEnabled();
  await expect(rerunAll(page)).toBeDisabled();

  // ── (2) ④를 다시 실행해 워킹화(KC 면제 확인)를 고르면 ⑥-3·⑦만 재실행 필요 → 모두 실행하면 ⑥-3 → ⑦, ⑧은 완료 그대로(실제 BE와 같다) ──
  await railStep(page, '④ 카테고리').click();
  const category = page.getByRole('region', { name: '④ 카테고리' });
  await category.getByRole('button', { name: '다시 실행', exact: true }).click();
  await expectStep(page, '④ 카테고리', '입력 대기');
  await category.getByRole('radio', { name: '패션잡화 > 남성신발 > 운동화 > 워킹화' }).check();
  await category.getByRole('checkbox', { name: 'KC 면제 성인용 확인' }).check();
  await category.getByRole('button', { name: '이 카테고리로 확정' }).click();
  await expectStep(page, '④ 카테고리', '완료');
  await expectStep(page, '⑥-3 고시·HTML', '재실행 필요');
  await expectStep(page, '⑦ 태그', '재실행 필요');
  await expectStep(page, '⑧ 이미지 업로드', '완료');
  await expect(guide(page)).toContainText('⑥-3 고시·HTML, ⑦ 태그');
  await rerunAll(page).click();
  for (const label of ['⑥-3 고시·HTML', '⑦ 태그'] as const) {
    await expectStep(page, label, '완료', 30_000);
  }
  // ⑧은 리프를 읽지 않아(⑥-3 HTML 값이 그대로) 낡지도 다시 돌지도 않는다 — 묶음은 최종 승인 앞에서 멈춘다
  await expectStep(page, '⑧ 이미지 업로드', '완료');
  await railStep(page, '⑧ 이미지 업로드').click();
  await expectCandidateStatus(page, '승인대기');
  await expect(guide(page)).toContainText('[승인·등록]');
  await expect(rerunAll(page)).toBeDisabled();

  // ── (3) ③ 국내 기준가를 170000으로 바꾸면 ③이 재실행 필요 → 모두 실행하면 ③만 돌고 G2 앞에서 멈춘다 → [소싱 확정(G2)] ──
  await railStep(page, '③ 판정').click();
  const pricing = page.getByRole('region', { name: '③ 판정' });
  await pricing.getByRole('textbox', { name: '국내 기준가 · 판매가 + 고객 배송비' }).fill('170000');
  await pricing.getByRole('button', { name: '저장' }).click();
  await expectStep(page, '③ 판정', '재실행 필요');
  await expect(guide(page)).toContainText('③ 판정');
  await rerunAll(page).click();
  await expectStep(page, '③ 판정', '완료', 30_000);
  await expect(pricing.getByRole('region', { name: '가격 요약' })).toContainText('168,300원');
  const confirm = page.getByRole('region', { name: '소싱 확정' });
  await expect(guide(page)).toContainText('[소싱 확정(G2)]');
  await confirm.getByRole('button', { name: '소싱 확정(G2)' }).click();
  await expect(confirm).toContainText('G2 판정 확정 · 통과');
  await railStep(page, '⑧ 이미지 업로드').click();
  await expectCandidateStatus(page, '승인대기');
  await expect(guide(page)).toContainText('[승인·등록]');

  expect(apiRequests, '체험이 /api를 불렀다').toEqual([]);
  expect(pageErrors).toEqual([]);
});
