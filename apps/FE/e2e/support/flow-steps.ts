import { expect, type Page } from '@playwright/test';

/**
 * 흐름 테스트 화면 단계(P5-01). 오너가 화면에서 하는 순서 그대로 누른다 — API를 바로 부르지 않는다.
 * 값은 앞 문서들의 fixture와 짝이다(합성 — 실제 상품 아님).
 * - ① 붙여넣기: datalab/paste/with-child-terms.txt 모양(아동 단어 줄은 '제외됨'으로 빠진다)
 * - ② 검색: rakuten/search/anchor-match12-p1·p2.json, 앵커 = 샵 A(型番 1201A019 · 색상 108), 페이지 fixture shop-a 등
 * - ③ 국내 기준가 169,000원 → PRD §8.3 예시 값(판매가 167,300원·순이익 27,418원)
 * - ④ 매핑표(category/mapping.json) 러닝화 장르 → 남성 러닝화·워킹화(KC) 중 러닝화
 */
export const KEYWORD = '아식스 젤카야노14';
export const OTHER_KEYWORD = '뉴발란스 530';
export const KEYWORD_PASTE = ['1 뉴발란스 530', '2 아식스 젤카야노14', '3 키즈 운동화'].join('\n');
export const RAKUTEN_QUERY = 'アシックス ゲルカヤノ14 1201A019';
/** ② 상품 고르기 목록에서 기준 상품으로 정할 샵 A 줄(샵 이름 + 상품명) */
export const SHOP_A_NAME = 'ショップA';
export const SHOP_A_ITEM_NAME =
  'アシックス ゲルカヤノ 14 1201A019-108 クリーム×ブラック メンズ スニーカー';
export const RAKUTEN_URL = 'https://item.rakuten.co.jp/shop-a/asics-1201a019-108/';
export const DOMESTIC_PRICE_KRW = '169000';
export const RUNNING_LEAF = '패션잡화 > 남성신발 > 운동화 > 러닝화';
/** 가짜 커머스 등록 응답의 원상품 번호(fixture products.200 · products-search.found) */
export const PRODUCT_NO = '10000000001';

export type StepLabel =
  | '② 소싱'
  | '③ 판정'
  | '④ 카테고리'
  | '⑤ 썸네일'
  | '⑥ 상세 콘텐츠'
  | '⑥-1 카피'
  | '⑥-2 원산지·소재'
  | '⑥-3 고시·HTML'
  | '⑦ 태그'
  | '⑧ 이미지 업로드'
  | '⑨ 등록';

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 단계 레일의 그 단계 링크(접근 이름 = '{단계} {상태}') */
export function railStep(page: Page, label: StepLabel) {
  return page
    .getByRole('navigation', { name: '단계' })
    .getByRole('link', { name: new RegExp(`^${escapeRe(label)} `) });
}

/** 레일의 단계 상태 글자(완료·입력 대기·재실행 필요·실패(중단됨) …)가 될 때까지 기다린다 */
export async function expectStep(page: Page, label: StepLabel, status: string, timeout?: number) {
  await expect(railStep(page, label)).toHaveAccessibleName(`${label} ${status}`, { timeout });
}

export function candidateIdOf(page: Page): number {
  const match = /\/candidates\/(\d+)\//.exec(page.url());
  if (!match) throw new Error(`여정 화면이 아닙니다:${page.url()}`);
  return Number(match[1]);
}

/** ① 순위 붙여넣기 → 키워드 하나 고르기(G1, 라디오 — D-33) → 오른쪽 '라쿠텐 검색어 확인'에 나온다 */
export async function pickKeyword(page: Page): Promise<void> {
  await page.goto('/keywords');
  await page.getByRole('button', { name: '순위 붙여넣기' }).click();
  await page.getByLabel('데이터랩 화면에서 복사한 순위와 키워드').fill(KEYWORD_PASTE);
  await page.getByRole('radio', { name: '남성신발' }).check();
  await page.getByRole('button', { name: '목록 만들기' }).click();
  const row = page.getByRole('row').filter({ hasText: KEYWORD });
  await expect(row).toBeVisible();
  // 아동 단어 줄은 목록에서 빠지고 '제외됨'에만 있다(F-KW-06)
  await expect(page.getByRole('row').filter({ hasText: '키즈 운동화' })).toHaveCount(0);
  // 키워드는 하나만 고른다(D-33): 다른 줄을 먼저 골랐다가 바꿔도 고른 줄은 하나이고, 새로고침해도 마지막에 고른 줄이다
  const panel = page.getByRole('region', { name: '라쿠텐 검색어 확인' });
  const other = page.getByRole('radio', { name: `${OTHER_KEYWORD} 고르기` });
  await other.check();
  // 한국어 원문은 칸 위에 보이고 일본어 검색어 칸은 비어 있다(소싱을 누를 때 AI가 채운다)
  await expect(panel).toContainText(OTHER_KEYWORD);
  await expect(panel.getByRole('textbox', { name: '라쿠텐 검색어' })).toHaveValue('');
  await expect(page.getByText('고름', { exact: true })).toHaveCount(1);
  const radio = row.getByRole('radio', { name: `${KEYWORD} 고르기` });
  await radio.check();
  await expect(row.getByText('고름')).toBeVisible();
  await expect(panel).toContainText(KEYWORD);
  await expect(panel.getByRole('textbox', { name: '라쿠텐 검색어' })).toHaveValue('');
  await expect(other).not.toBeChecked();
  await expect(page.getByText('고름', { exact: true })).toHaveCount(1);
  await expect(panel).toContainText('G1 키워드 선택 · 통과');
  await page.reload();
  await expect(radio).toBeChecked();
  await expect(other).not.toBeChecked();
  await expect(panel).toContainText('G1 키워드 선택 · 통과');
}

/** ② 라쿠텐 검색어(오너가 일본어로 고침) → '이 검색어로 소싱' = 여정 만들기 + ② 실행 → 앵커 입력 대기 */
export async function startSourcing(page: Page): Promise<number> {
  const panel = page.getByRole('region', { name: '라쿠텐 검색어 확인' });
  await panel.getByRole('textbox', { name: '라쿠텐 검색어' }).fill(RAKUTEN_QUERY);
  await expect(panel).toContainText('사용 가능');
  await panel.getByRole('button', { name: '이 검색어로 소싱' }).click();
  await page.waitForURL(/\/candidates\/\d+\/sourcing$/);
  await expectStep(page, '② 소싱', '입력 대기');
  return candidateIdOf(page);
}

/** ② 상품 고르기 목록의 한 줄(샵 이름과 상품명으로 찾는다) */
export function searchResultItem(page: Page, shopName: string, itemName: string) {
  return page
    .getByRole('list', { name: '라쿠텐 검색 결과' })
    .getByRole('listitem')
    .filter({ hasText: shopName })
    .filter({ hasText: itemName });
}

/** ② 상품 고르기(샵 A 줄의 [이 상품으로 정하기]) → 상품 페이지 조회·재고·실질가 → 샵 A 고르기 = ② 완료 */
export async function anchorAndPickShopA(page: Page): Promise<void> {
  await searchResultItem(page, SHOP_A_NAME, SHOP_A_ITEM_NAME)
    .getByRole('button', { name: '이 상품으로 정하기' })
    .click();
  const table = page.getByRole('table', { name: '같은 상품을 파는 샵 비교' });
  // 페이지 조회가 끝나 재고 확인 행 5개(재고 통과 3)가 서면 고른다
  await expect(table).toContainText('재고 확인 5', { timeout: 60_000 });
  const shopA = table.getByRole('row', { name: 'ショップA', exact: true });
  await expect(shopA.getByRole('cell').nth(1)).toHaveText('같은 상품');
  await expect(shopA).toContainText('¥11,455');
  await shopA.getByRole('radio', { name: 'ショップA 고르기' }).click();
  await expectStep(page, '② 소싱', '완료');
}

/** ③ 국내 기준가 입력 → 실행 → (URL 여정이면 '비교 없이 확정') → 소싱 확정(G2) */
export async function judgeAndPassG2(page: Page, options: { noComparison?: boolean } = {}) {
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
  if (options.noComparison) {
    const box = confirm.getByRole('checkbox', { name: '비교 없이 확정' });
    await box.click();
    await expect(box).toBeChecked();
  }
  await confirm.getByRole('button', { name: '소싱 확정(G2)' }).click();
  await expect(confirm).toContainText('G2 판정 확정 · 통과');
}

/** ④ 실행 → 리프 후보 중 러닝화 → 확정 */
export async function pickCategory(page: Page): Promise<void> {
  const category = page.getByRole('region', { name: '④ 카테고리' });
  await category.getByRole('button', { name: '실행', exact: true }).click();
  await expectStep(page, '④ 카테고리', '입력 대기');
  await category.getByRole('radio', { name: RUNNING_LEAF }).check();
  await category.getByRole('button', { name: '이 카테고리로 확정' }).click();
  await expectStep(page, '④ 카테고리', '완료');
}

/** 선택 전 확인 7개(+ 같은 상품·색상 확인)를 모두 체크하고 G3 */
export async function passG3Checklist(page: Page): Promise<void> {
  const checklist = page.getByRole('region', { name: '선택 전 확인' });
  await expect(checklist).toContainText('기준');
  const boxes = checklist.getByRole('checkbox');
  const count = await boxes.count();
  for (let i = 0; i < count; i += 1) {
    const box = boxes.nth(i);
    if ((await box.isEnabled()) && !(await box.isChecked())) await box.check();
  }
  await checklist.getByRole('button', { name: '썸네일 선택(G3)' }).click();
}

/** ⑤ 실행(원본 받기) → 레퍼런스·사람 없음 → 만들기(가짜 생성) → 대표·추가 → 체크리스트 → G3 */
export async function makeThumbnailAndPassG3(page: Page): Promise<void> {
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

/** ⑥ '여기부터 연속 실행' → ⑥-1·⑥-2·⑥-3·⑦·⑧이 차례로 완료(G4에서 멈춤) */
export async function runContentChainToUpload(page: Page): Promise<void> {
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
    await expectStep(page, label, '완료', 60_000);
  }
  await expectStep(page, '⑥ 상세 콘텐츠', '완료');
}

/** 키워드 경로로 승인 화면 직전(⑧ 완료)까지 — 실패 경로·재시작 시험의 앞부분 */
export async function keywordCandidateToUpload(page: Page): Promise<number> {
  await pickKeyword(page);
  const candidateId = await startSourcing(page);
  await anchorAndPickShopA(page);
  await judgeAndPassG2(page);
  await pickCategory(page);
  await makeThumbnailAndPassG3(page);
  await runContentChainToUpload(page);
  return candidateId;
}

export interface PreValidationBody {
  approvable: boolean;
  checks: { checkCode: string; passed: boolean }[];
}

/** 승인 화면을 열고 화면이 부른 사전 검증 결과(POST pre-validations)를 돌려준다 */
export async function openApproval(page: Page, candidateId: number): Promise<PreValidationBody> {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      r.url().endsWith(`/api/v1/candidates/${candidateId}/pre-validations`),
  );
  await railStep(page, '⑧ 이미지 업로드').click();
  await page.waitForURL(new RegExp(`/candidates/${candidateId}/approval$`));
  const res = await response;
  expect(res.status()).toBe(200);
  return (await res.json()) as PreValidationBody;
}

export function registerRegion(page: Page) {
  return page.getByRole('region', { name: '⑨ 등록' });
}

export function blockSwitch(page: Page) {
  return page.getByRole('switch', { name: '등록 API 차단' });
}

/** 승인 바 '승인·등록'(Idempotency-Key는 화면이 누를 때 만든다) */
export async function approve(page: Page): Promise<void> {
  const button = registerRegion(page).getByRole('button', { name: '승인·등록' });
  await expect(button).toBeEnabled();
  await button.click();
}

/** 차단 스위치 끄기(드라이런 → 실제 등록) */
export async function turnOffBlockSwitch(page: Page): Promise<void> {
  const toggle = blockSwitch(page);
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toContainText(
    '등록 API 차단 꺼짐',
  );
}

/** ⑧ 줄의 '여정 상태' 배지 글 */
export async function expectCandidateStatus(page: Page, status: string): Promise<void> {
  await expect(page.getByRole('region', { name: '⑧ 이미지 업로드' })).toContainText(
    `여정 상태 ${status}`,
  );
}
