import {
  checkStepRunnable,
  type RunnableOptions,
  type StepBlock,
} from '../execution/step-blocks.js';
import type { StartConditionCandidate } from '../execution/start-conditions.js';
import type { GateFlags } from './resume.js';
import type { StepCode, StepStatusMap } from './steps.js';

/**
 * '지금 실행 가능'(F-CW-22 입력 고르기, 05-1 §2.1 runnableStep). P1-05부터 판단은 execution/start-conditions·step-locks·
 * step-blocks 한 곳에서 한다(실행 API의 409·레일 disabledReason과 같은 함수). 여기는 P1-04 이름을 잇는 창구다.
 */
export { checkStepRunnable };
export type { RunnableOptions };
/** 실행할 수 없는 이유. code는 단계 실행 API(05-1 표 A)의 409·422 코드와 같다 */
export type RunnableBlock = StepBlock;
/** '지금 실행 가능' 판단에 필요한 후보 값 */
export type RunnableCandidate = StartConditionCandidate;

export function canRunStep(
  stepCode: StepCode,
  candidate: RunnableCandidate,
  steps: StepStatusMap,
  gates: GateFlags,
  options: RunnableOptions = {},
): boolean {
  return checkStepRunnable(stepCode, candidate, steps, gates, options) === null;
}
