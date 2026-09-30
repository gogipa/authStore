import type { GateFlags } from '../domain/resume.js';
import { stepStatusOf, type StepCode, type StepStatusMap } from '../domain/steps.js';
import type { CandidateWarning } from '../domain/warnings.js';

/**
 * 단계 실행 경고(막지 않음, 05-1 §5.2, 05-3 §5.2). 실행 API 202 `warnings`와 단계 레일 `warnings`가 같이 쓴다.
 * - PRE_G2_AI_COST(F-CW-17): G2가 유효하지 않을 때 ⑤·⑥-1·⑥-2(AI를 쓰는 단계). 문구는 CandidateWork.dc.html ⑤ 줄을 따랐다
 *   (⑥-1·⑥-2는 같은 틀, P1-05 Proposed).
 * - CATEGORY_UNDECIDED: ⑦을 ④ 완료 전에 실행(카테고리 필터 없이 태그를 뽑는다). 문구 Proposed.
 */
export const PRE_G2_AI_COST_STEPS: readonly StepCode[] = ['THUMBNAIL', 'COPY', 'NOTICE_RAW'];

const PRE_G2_SUBJECT: Partial<Record<StepCode, string>> = {
  THUMBNAIL: '썸네일을 만들면',
  COPY: '카피를 만들면',
  NOTICE_RAW: '원산지·소재를 뽑으면',
};

export function preG2AiCostWarning(stepCode: StepCode): CandidateWarning {
  return {
    code: 'PRE_G2_AI_COST',
    message: `판정(G2) 전에 ${PRE_G2_SUBJECT[stepCode] ?? 'AI 단계를 실행하면'} 팔지 않을 상품에도 AI 사용량이 듭니다. 실행은 막지 않습니다.`,
  };
}

export const CATEGORY_UNDECIDED_WARNING: CandidateWarning = {
  code: 'CATEGORY_UNDECIDED',
  message: '④ 카테고리 전이라 카테고리 필터 없이 태그를 뽑습니다.',
};

export function stepWarnings(
  stepCode: StepCode,
  steps: StepStatusMap,
  gates: GateFlags,
): CandidateWarning[] {
  const warnings: CandidateWarning[] = [];
  if (PRE_G2_AI_COST_STEPS.includes(stepCode) && !gates.G2) {
    warnings.push(preG2AiCostWarning(stepCode));
  }
  if (stepCode === 'TAGS' && stepStatusOf(steps, 'CATEGORY') !== 'COMPLETED') {
    warnings.push(CATEGORY_UNDECIDED_WARNING);
  }
  return warnings;
}
