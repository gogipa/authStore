import { expect, test } from './support/flow-fixtures';
import {
  approve,
  expectCandidateStatus,
  expectStep,
  keywordCandidateToUpload,
  openApproval,
  PRODUCT_NO,
  registerRegion,
  turnOffBlockSwitch,
} from './support/flow-steps';

/**
 * 앱 재시작(P5-01 규칙 5 — US-29 AC3, F-BS-18, PRD §5.2): ⑨ 등록요청중(가짜 커머스 등록 서버가 응답을 붙잡은 채)에 BE를 끄고(SIGTERM)
 * 다시 켜면 후보는 '결과확인필요', 실행 중이던 ⑨는 '실패(중단됨)'다. 재시작 뒤 자동 결과 조회(P4-03)가 판매자관리코드 조회에 실패해도
 * 그대로이고, 오너가 '결과 확인'을 누르면(조회에서 찾음) 등록됨으로 이어진다 — 다시 등록 요청을 보내지 않는다.
 */
test('⑨ 등록요청중에 BE를 끄고 켜면 결과확인필요 · ⑨ 실패(중단됨)', async ({ page, flow }) => {
  const candidateId = await keywordCandidateToUpload(page);
  await openApproval(page, candidateId);
  await turnOffBlockSwitch(page);
  await flow.fakes({ createMode: 'HOLD' });
  await approve(page);
  await expect(registerRegion(page)).toContainText('등록요청중');
  await expectCandidateStatus(page, '등록요청중');
  await expect.poll(async () => (await flow.state()).commerce.productCreates).toBe(1);

  // 응답을 받기 전에 BE를 끄고 다시 켠다(재시작 뒤 자동 결과 조회는 조회 실패로 둔다)
  await flow.restart({ searchMode: '500' });
  await page.reload();
  await expectCandidateStatus(page, '결과확인필요');
  await expectStep(page, '⑨ 등록', '실패(중단됨)');
  await expect(registerRegion(page)).toContainText('결과확인필요');
  const afterRestart = await flow.state();
  // 새 BE는 등록 요청을 다시 보내지 않는다(자동 재시도 없음 — 조회만)
  expect(afterRestart.commerce.productCreates).toBe(0);
  expect(afterRestart.commerce.sellerCodeSearches).toBeGreaterThanOrEqual(1);

  // 오너가 '결과 확인' → 판매자관리코드로 찾음 → 등록됨
  await flow.fakes({ searchMode: 'FOUND' });
  await registerRegion(page).getByRole('button', { name: '결과 확인' }).click();
  await expect(registerRegion(page)).toContainText(`상품 번호 ${PRODUCT_NO}`);
  await expectCandidateStatus(page, '등록됨');
  expect((await flow.state()).commerce.productCreates).toBe(0);
});
