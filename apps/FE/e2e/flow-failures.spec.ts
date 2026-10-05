import { expect, test } from './support/flow-fixtures';
import {
  approve,
  expectCandidateStatus,
  expectStep,
  keywordCandidateToUpload,
  openApproval,
  passG3Checklist,
  PRODUCT_NO,
  railStep,
  registerRegion,
  turnOffBlockSwitch,
} from './support/flow-steps';

/**
 * 실패 경로(P5-01 규칙 4 — US-20 AC4, US-19 AC2, US-33 AC3·AC6). 키워드 경로로 ⑧까지 간 여정에서:
 * - 등록 5xx → '결과확인필요' → '결과 확인'(판매자관리코드로 찾음) → '등록됨', 등록 호출은 1번뿐(자동 재시도 없음)
 * - 등록 4xx → 한국어 오류·추적 번호 → ⑦ 태그 수정 → 재승인 '등록됨', 이미지는 다시 올리지 않는다
 * - ⑤ 다시 고르기 → ⑧만 '재실행 필요'(카피·태그는 '완료'), 승인 버튼 꺼짐 + 이유 글 + ⑧ 링크
 */
test.describe('실패 경로', () => {
  test('등록 5xx면 결과확인필요 → 결과 확인으로 찾으면 등록됨(등록 호출 1번)', async ({
    page,
    flow,
  }) => {
    const candidateId = await keywordCandidateToUpload(page);
    await openApproval(page, candidateId);
    await turnOffBlockSwitch(page);
    await flow.fakes({ createMode: '500' });
    await approve(page);

    const register = registerRegion(page);
    await expect(register).toContainText('결과확인필요');
    await expectCandidateStatus(page, '결과확인필요');
    expect((await flow.state()).commerce.productCreates).toBe(1);

    // 오너가 '결과 확인' → 판매자관리코드(SELLER_CODE) 조회에서 찾음 → 등록됨
    await flow.fakes({ searchMode: 'FOUND' });
    await register.getByRole('button', { name: '결과 확인' }).click();
    await expect(register).toContainText(`상품 번호 ${PRODUCT_NO}`);
    await expectCandidateStatus(page, '등록됨');
    // 닫힌 ⑨ 실행(5xx로 실패)은 바꾸지 않는다 — 결과는 등록 기록·여정 상태로 본다(P4-03 결정, ERD 대응 ⑤)
    await expectStep(page, '⑨ 등록', '실패');
    // 같은 상품을 두 번 등록 요청하지 않는다
    expect((await flow.state()).commerce.productCreates).toBe(1);
  });

  test('등록 4xx면 한국어 오류·추적 번호 → ⑦ 태그를 고쳐 다시 승인하면 등록됨(재업로드 없음)', async ({
    page,
    flow,
  }) => {
    const candidateId = await keywordCandidateToUpload(page);
    await openApproval(page, candidateId);
    await turnOffBlockSwitch(page);
    await flow.fakes({ createMode: '400' });
    await approve(page);

    const register = registerRegion(page);
    await expect(register).toContainText('입력 오류로 종결');
    await expect(register).toContainText('태그');
    await expect(register).toContainText('추적 번호 fixture-trace-products-400');
    await expectCandidateStatus(page, '승인대기');
    const afterFirst = await flow.state();
    expect(afterFirst.commerce.productCreates).toBe(1);

    // ⑦ 태그 수정: 마지막 태그 하나를 뺀다(오너 수정 → 제한 태그 재검증 → ⑦ 새 버전)
    await railStep(page, '⑦ 태그').click();
    const finalTags = page.getByRole('list', { name: /^최종 태그 \d+개$/ });
    await expect(finalTags).toBeVisible();
    const before = await finalTags.getByRole('listitem').count();
    await finalTags
      .getByRole('button', { name: /태그 삭제$/ })
      .last()
      .click();
    await expect(page.getByRole('list', { name: `최종 태그 ${before - 1}개` })).toBeVisible();
    await expectStep(page, '⑦ 태그', '완료');
    await expectStep(page, '⑧ 이미지 업로드', '완료');

    // 다시 승인(새 Idempotency-Key) → 등록됨
    await flow.fakes({ createMode: '200' });
    const result = await openApproval(page, candidateId);
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    await approve(page);
    await expect(register).toContainText(`상품 번호 ${PRODUCT_NO}`);
    await expectCandidateStatus(page, '등록됨');
    const afterSecond = await flow.state();
    expect(afterSecond.commerce.productCreates).toBe(2);
    // 이미지는 ⑧에서 한 번만 올렸다 — 재승인은 같은 업로드 URL을 쓴다
    expect(afterSecond.commerce.imageUploadRequests).toBe(afterFirst.commerce.imageUploadRequests);
    expect(afterSecond.commerce.imageUploadRequests).toBe(1);
  });

  test('⑤ 썸네일을 다시 고르면 ⑧만 재실행 필요 · 승인 버튼이 꺼지고 ⑧로 가는 링크', async ({
    page,
    flow,
  }) => {
    const candidateId = await keywordCandidateToUpload(page);
    await railStep(page, '⑤ 썸네일').click();
    await page.getByRole('radio', { name: '후보 2 대표' }).check();
    await passG3Checklist(page);

    await expectStep(page, '⑧ 이미지 업로드', '재실행 필요');
    await expectStep(page, '⑤ 썸네일', '완료');
    for (const label of ['⑥-1 카피', '⑥-2 원산지·소재', '⑥-3 고시·HTML', '⑦ 태그'] as const) {
      await expectStep(page, label, '완료');
    }

    // 승인 화면: 상태가 작업중이라 승인 버튼이 꺼지고, 이유 글과 ⑧로 가는 링크가 보인다(US-33 AC6)
    await railStep(page, '⑧ 이미지 업로드').click();
    await page.waitForURL(new RegExp(`/candidates/${candidateId}/approval$`));
    await expectCandidateStatus(page, '작업중');
    const register = registerRegion(page);
    await expect(register.getByRole('button', { name: '승인·등록' })).toBeDisabled();
    await expect(register).toContainText('지금 여정 상태(작업중)에서는 할 수 없습니다.');
    const blockers = register.getByRole('list', { name: '승인 전에 끝낼 곳' });
    await expect(blockers.getByRole('link')).toHaveCount(1);
    const toUpload = blockers.getByRole('link', { name: '⑧ 이미지 업로드 · 재실행 필요' });
    await expect(toUpload).toHaveAttribute('href', `/candidates/${candidateId}/approval`);

    // ⑧을 다시 실행하면 승인할 수 있다. 새 대표(후보 2)는 이미 올린 이미지라 다시 올리지 않는다(US-20 AC1)
    await page
      .getByRole('region', { name: '⑧ 이미지 업로드' })
      .getByRole('button', { name: '다시 실행' })
      .click();
    await expectStep(page, '⑧ 이미지 업로드', '완료');
    await expectCandidateStatus(page, '승인대기');
    await expect(register.getByRole('button', { name: '승인·등록' })).toBeEnabled();
    expect((await flow.state()).commerce.imageUploadRequests).toBe(1);
  });
});
