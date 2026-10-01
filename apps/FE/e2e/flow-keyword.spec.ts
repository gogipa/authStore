import { expect, test } from './support/flow-fixtures';
import {
  anchorAndPickShopA,
  approve,
  blockSwitch,
  expectCandidateStatus,
  expectStep,
  judgeAndPassG2,
  makeThumbnailAndPassG3,
  openApproval,
  pickCategory,
  pickKeyword,
  PRODUCT_NO,
  registerRegion,
  runContentChainToUpload,
  startSourcing,
  turnOffBlockSwitch,
} from './support/flow-steps';

/**
 * 흐름 A(키워드 경로, P5-01 규칙 2 — PRD §5·§17, US-20 AC1~AC5): ① 붙여넣기 → G1 → ② 검색·앵커·후보 선택 → ③ 국내 기준가 → G2 →
 * ④ → ⑤ 레퍼런스·생성(가짜 ImageGenProvider) → G3 → ⑥-1·⑥-2(AI fixture 어댑터) → ⑥-3 → ⑦ → ⑧ → G4 사전 검증 15항목 →
 * 차단 켬 승인 = 검증완료(등록 호출 0) → 스위치 끔 → 다시 승인 = 등록됨·상품 번호·전시중지(처음 10건).
 */
test('후보 1건이 ①부터 ⑨까지 끝까지 간다(차단 켬 드라이런 → 끔 → 등록됨)', async ({
  page,
  flow,
  api,
}) => {
  // ① 키워드 → G1
  await pickKeyword(page);
  // ② 라쿠텐 검색 → 앵커 → 페이지 조회·재고·실질가 → 샵 A
  const candidateId = await startSourcing(page);
  await anchorAndPickShopA(page);
  // ③ 국내 기준가 → 판정 → G2
  await judgeAndPassG2(page);
  await expectStep(page, '③ 판정', '완료');
  // ④ 리프 고르기
  await pickCategory(page);
  // ⑤ 원본 → 레퍼런스 → 생성 → G3
  await makeThumbnailAndPassG3(page);
  // ⑥-1 → ⑥-2 → ⑥-3 → ⑦ → ⑧(연속 실행, G4에서 멈춤)
  await runContentChainToUpload(page);
  for (const label of ['② 소싱', '③ 판정', '④ 카테고리', '⑤ 썸네일'] as const) {
    await expectStep(page, label, '완료');
  }
  await expectStep(page, '⑨ 등록', '미실행');

  // G4 사전 검증: 검사 코드 15개 모두 통과(화면은 13줄로 묶는다 — P4-02 결정)
  const result = await openApproval(page, candidateId);
  expect(result.checks).toHaveLength(15);
  expect(result.checks.filter((c) => !c.passed)).toEqual([]);
  expect(result.approvable).toBe(true);
  await expect(page.getByRole('region', { name: '사전 검증 결과' })).toContainText(
    '13개 모두 통과',
  );
  await expectCandidateStatus(page, '승인대기');
  const before = await flow.state();
  expect(before.commerce.imageUploadRequests).toBe(1);
  expect(before.commerce.imageUploadParts).toBe(2);
  expect(before.ai.claude).toEqual(expect.arrayContaining(['CT-01', 'CT-02']));
  expect(before.imageGen).toBe(2);

  // 차단 켬(새 DB 기본값)으로 승인 → 검증완료, 커머스 등록 호출 0
  await expect(blockSwitch(page)).toBeChecked();
  await approve(page);
  await expect(registerRegion(page)).toContainText('검증완료(드라이런)로 저장했습니다');
  await expectCandidateStatus(page, '검증완료');
  await expect(page.getByRole('region', { name: '후보 정보' })).toContainText(
    'G4 최종 승인 · 통과',
  );
  expect((await flow.state()).commerce.productCreates).toBe(0);

  // 끄기 전에: 커머스API·라쿠텐은 가짜 라우터(소켓을 열지 않는다)로만 간다
  const fakes = await flow.state();
  expect(fakes.httpFetch).toBe('flow-fake-router');
  expect(fakes.fakeHosts).toEqual(
    expect.arrayContaining([
      'api.commerce.naver.com',
      'openapi.rakuten.co.jp',
      'item.rakuten.co.jp',
    ]),
  );

  // 스위치 끔 → 승인대기로 돌아옴 → 다시 승인 → 등록됨·상품 번호·전시중지
  await turnOffBlockSwitch(page);
  await expectCandidateStatus(page, '승인대기');
  await approve(page);
  await expect(registerRegion(page)).toContainText(`상품 번호 ${PRODUCT_NO}`);
  await expect(registerRegion(page)).toContainText('이 상품은 전시중지로 올라갑니다');
  await expectCandidateStatus(page, '등록됨');
  await expectStep(page, '⑨ 등록', '완료');

  const after = await flow.state();
  expect(after.commerce.productCreates).toBe(1);
  expect(after.commerce.productCreateDisplayStatus).toEqual(['SUSPENSION']);
  // 등록 때 이미지를 다시 올리지 않는다(⑧ 업로드 URL만 쓴다)
  expect(after.commerce.imageUploadRequests).toBe(1);
  // 커머스API 토큰 요청에 account_id가 없다(PRD §8.7)
  expect(after.commerce.tokenFormKeys.flat()).not.toContain('account_id');

  const registrations = await api.get(`candidates/${candidateId}/registrations`);
  expect(registrations.ok()).toBe(true);
  const page0 = (await registrations.json()) as {
    content: { status: string; displayStatusType: string; originProductNo: string | null }[];
  };
  expect(page0.content.map((r) => r.status).sort()).toEqual(['REGISTERED', 'VALIDATED']);
  expect(page0.content.find((r) => r.status === 'REGISTERED')).toMatchObject({
    displayStatusType: 'SUSPENSION',
    originProductNo: PRODUCT_NO,
  });
});
