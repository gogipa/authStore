/**
 * ③ 판정이 읽는 활성 요금표 입력(P2-04 규칙 13, Proposed — 05-1 §7.3 'P2-04 구현 결정').
 * - 이름 `forwarder.rateTable`, source_type SETTINGS, 시작 조건. 값 = `{ rateTableId }`(활성 버전 id, 없으면 null —
 *   없으면 ③은 기본 15,000원 가정값을 쓴다, F-PJ-07).
 * - ③ 실행기(P2-05)는 readInputs에서 `rateTableStepInput(activeId)`를 더해 낸다. 활성 버전이 바뀌면 요금표 가져오기가
 *   이 이름·새 값으로 전파(RATE_TABLE_RERUN_PROPAGATOR)를 부르고, 저장된 값이 다른 ③만 재실행 필요가 된다.
 */
export const RATE_TABLE_INPUT_KEY = 'forwarder.rateTable';

export function rateTableInputValue(activeRateTableId: number | null): {
  rateTableId: number | null;
} {
  return { rateTableId: activeRateTableId };
}

export interface RateTableStepInput {
  inputKey: typeof RATE_TABLE_INPUT_KEY;
  sourceType: 'SETTINGS';
  isStartCondition: true;
  required: false;
  value: { rateTableId: number | null };
}

/** ③ 실행기 readInputs에 더할 입력 한 줄(StepInput 모양) */
export function rateTableStepInput(activeRateTableId: number | null): RateTableStepInput {
  return {
    inputKey: RATE_TABLE_INPUT_KEY,
    sourceType: 'SETTINGS',
    isStartCondition: true,
    required: false,
    value: rateTableInputValue(activeRateTableId),
  };
}
