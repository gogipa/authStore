import { JUDGEMENT_PAGE_AT, PAGE_FETCHED_AT, type FakeStepWorld } from './fake-runners.js';

/**
 * 연속 실행 대본(P1-06 e2e). P1-05 가짜 실행기(`FakeStepWorld.script`)에 한 줄로 거는 멈춤 상황이다. 실제 외부·AI 호출은 없다.
 * - ③ 국내 기준가 대기: ③이 `DOMESTIC_PRICE_REQUIRED`로 입력 대기(G2 전이면 AWAIT_G2)
 * - ⑤ 레퍼런스 대기: ⑤가 `REFERENCE_REQUIRED`로 입력 대기(G2 뒤: ⑥-1·⑥-2·⑥-3·⑦은 돌고 ⑧은 안 돈다)
 * - ⑥-2 실패: AI 실패(⑥-3·⑧만 멈춘다)
 * - ③ 판정 페이지 7시간 전: 다음 ③이 판정에 쓸 페이지 수집 시각을 7시간 전으로, ②가 다시 받으면 지금으로(6시간 규칙)
 */
export const CHAIN_SCENARIOS = {
  pricingAwaitsDomesticPrice(world: FakeStepWorld): void {
    world.script('PRICING', {
      kind: 'WAIT',
      waitingReasonCode: 'DOMESTIC_PRICE_REQUIRED',
      pendingInputs: ['owner.domesticPrice'],
    });
  },

  thumbnailAwaitsReference(world: FakeStepWorld): void {
    world.script('THUMBNAIL', {
      kind: 'WAIT',
      waitingReasonCode: 'REFERENCE_REQUIRED',
      pendingInputs: ['owner.referenceSelection'],
    });
  },

  noticeRawFails(world: FakeStepWorld): void {
    world.script('NOTICE_RAW', {
      kind: 'FAIL',
      failureKind: 'AI',
      errorCode: 'AI_OUTPUT_INVALID',
      errorMessage: '원산지·소재를 뽑지 못했습니다(가짜 실패).',
    });
  },

  /** 다음 ③ 실행이 `now` 기준 7시간 전에 받은 페이지로 판정한 것처럼 둔다(③을 돌리기 전에 부른다) */
  judgementPage7HoursAgo(world: FakeStepWorld, candidateId: number, now: Date): void {
    world.set(candidateId, JUDGEMENT_PAGE_AT, new Date(now.getTime() - 7 * 3_600_000));
  },

  /** 다음 ② 실행(재조회 포함)이 `at`에 페이지를 새로 받은 것처럼 둔다(그 뒤 ③은 이 시각으로 판정) */
  pageRefetchedAt(world: FakeStepWorld, candidateId: number, at: Date): void {
    world.set(candidateId, PAGE_FETCHED_AT, at);
  },
} as const;
