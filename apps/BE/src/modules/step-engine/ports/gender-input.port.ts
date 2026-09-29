import type { StepEngineTx } from '../candidates/step-engine-tx.js';

/**
 * 오너 성별 입력을 기다리는 열린 실행에 넘기는 자리(05-2 setCandidateGender: '열린 ②가 성별을 기다리면
 * sourcing_comparison.owner_gender로 넘겨 이어 가고, 열린 ④면 category_decision.gender로 카테고리 후보를 다시 뽑는다').
 * P2-03(②)·P2-06(④)이 리스너를 더한다. 이어 간 실행 id를 돌려주면 응답 `resumedStepRunIds`에 들어간다.
 * P1-04 기본은 리스너 없음(빈 배열).
 */
export interface GenderInputListener {
  onOwnerGender(
    scope: StepEngineTx,
    input: { candidateId: number; gender: 'MALE' | 'FEMALE' },
  ): Promise<number[]>;
}

export const GENDER_INPUT_LISTENERS = Symbol('GENDER_INPUT_LISTENERS');
