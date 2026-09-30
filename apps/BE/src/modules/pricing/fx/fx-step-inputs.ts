import type { FxRatesForJudgement } from './fx-rates.service.js';
import { FX_INPUT_KEYS, fxInputValue } from './fx-rate.normalize.js';

/** ③ 실행기 readInputs에 더할 환율 입력 한 줄(StepInput 모양, source_type SETTINGS·시작 조건·필수) */
export interface FxStepInput {
  inputKey: string;
  sourceType: 'SETTINGS';
  isStartCondition: true;
  required: true;
  value: { perUnit: string };
}

/**
 * ③ 판정(P2-05) 입력: 환율 3종(`fx.costJpy`·`fx.customsJpy`·`fx.customsUsd`). 값은 계산용 환율(`perUnit`)이라 같은 값의
 * 새 행으로는 재실행 필요가 되지 않는다. 어느 행을 썼는지는 판정 스냅샷의 환율 id가 남긴다(P2-04 Proposed).
 */
export function fxStepInputs(rates: FxRatesForJudgement): FxStepInput[] {
  const row = (inputKey: string, rate: FxRatesForJudgement['cost']): FxStepInput => ({
    inputKey,
    sourceType: 'SETTINGS',
    isStartCondition: true,
    required: true,
    value: fxInputValue(rate.rateValue, rate.unit),
  });
  return [
    row(FX_INPUT_KEYS['COST/JPY'], rates.cost),
    row(FX_INPUT_KEYS['CUSTOMS/JPY'], rates.customsJpy),
    row(FX_INPUT_KEYS['CUSTOMS/USD'], rates.customsUsd),
  ];
}
