import { expect, test } from './support/flow-fixtures';
import {
  approve,
  candidateIdOf,
  expectCandidateStatus,
  expectStep,
  judgeAndPassG2,
  makeThumbnailAndPassG3,
  openApproval,
  pickCategory,
  PRODUCT_NO,
  RAKUTEN_URL,
  registerRegion,
  runContentChainToUpload,
  turnOffBlockSwitch,
} from './support/flow-steps';

/**
 * 흐름 B(URL 경로, P5-01 규칙 3 — PRD §17, US-06 AC3, F-AP-08): 라쿠텐 URL → 색상 선택 → '비교 안 함' 배지(① 생략, 비교표 없이 ② 완료)
 * → G2에서 '비교 없이 확정' → … → ⑨ 등록됨. 승인 화면에 소싱 방식 '비교 없이 확정'이 보인다.
 */
test('라쿠텐 URL로 만든 여정도 비교 없이 확정으로 ⑨ 등록까지 간다', async ({ page, flow }) => {
  await page.goto('/candidates?runnableStep=SOURCING');
  const entry = page.getByRole('region', { name: 'URL로 바로 여정 만들기' });
  await entry.getByRole('textbox', { name: '라쿠텐 URL' }).fill(RAKUTEN_URL);
  await entry.getByRole('button', { name: '넣기' }).click();
  const color = entry.getByRole('combobox', { name: '색상' });
  await expect(color).toBeVisible();
  await color.selectOption({ label: 'クリーム×ブラック(108)' });
  await entry.getByRole('button', { name: '이 색상으로 여정 만들기' }).click();
  await page.waitForURL(/\/candidates\/\d+\/sourcing$/);
  const candidateId = candidateIdOf(page);

  // ②는 비교표 없이 완료 · '비교 안 함' 배지(레일·비교 칸)
  await expectStep(page, '② 소싱', '완료');
  await expect(page.getByRole('navigation', { name: '단계' })).toContainText('비교 안 함');
  await expect(page.getByRole('region', { name: '같은 상품을 파는 샵 비교' })).toContainText(
    'URL로 만든 여정이라 비교표 없이 ②를 마쳤습니다',
  );
  // 검색을 하지 않는다(URL 한 건의 상품 페이지만 읽는다)
  expect((await flow.state()).rakuten.search).toBe(0);

  // ③ → '비교 없이 확정' → G2
  await judgeAndPassG2(page, { noComparison: true });
  await pickCategory(page);
  await makeThumbnailAndPassG3(page);
  await runContentChainToUpload(page);

  const result = await openApproval(page, candidateId);
  expect(result.checks).toHaveLength(15);
  expect(result.checks.filter((c) => !c.passed)).toEqual([]);
  // 승인 화면: 소싱 방식 '비교 없이 확정'
  const preview = page.getByRole('region', { name: '전체 미리보기' });
  await expect(preview.getByRole('definition').first()).toContainText('비교 없이 확정');

  await turnOffBlockSwitch(page);
  await approve(page);
  await expect(registerRegion(page)).toContainText(`상품 번호 ${PRODUCT_NO}`);
  await expectCandidateStatus(page, '등록됨');
  await expectStep(page, '⑨ 등록', '완료');
  expect((await flow.state()).commerce.productCreates).toBe(1);
});
