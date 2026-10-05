import { REQUIRED_STEPS, STEP_LABEL, type StepCode } from '../../../step-engine/domain/steps.js';
import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import { resultOf, type CheckProblem } from './check-helpers.js';

/** 단계 상태 글(사유) */
const STEP_STATUS_TEXT: Readonly<Record<string, string>> = {
  NOT_RUN: '미실행',
  RUNNING: '실행 중',
  WAITING_INPUT: '입력 대기',
  FAILED: '실패',
  RERUN_REQUIRED: '재실행 필요',
};

/** 게이트 → 근거 단계(P1-06 GATE_BASIS_STEP — 화면 링크) */
const GATE_STEP: Readonly<Record<'G2' | 'G3', StepCode>> = { G2: 'PRICING', G3: 'THUMBNAIL' };
const GATE_TEXT: Readonly<Record<'G2' | 'G3', string>> = {
  G2: 'G2 판정 확정',
  G3: 'G3 썸네일 선택',
};

/**
 * `STEP_FRESHNESS`(F-AP-23, US-33 AC6, PRD §8.7 단계 최신성, P4-02 규칙 13): 필수 단계 9개(②③④⑤⑥-1⑥-2⑥-3⑦⑧)가 모두
 * `COMPLETED`이고, G2·G3 지문을 지금 값으로 다시 계산해(P1-06 GATE_VALIDITY) 최신 통과와 같다. URL 후보(`creation_path=RAKUTEN_URL`)는
 * 비교를 했거나(② 현재 선택 `comparison_performed`) `no_comparison_confirmed_at`이 있다. 최신이 아닌 단계마다 사유를 적고, 화면 링크는
 * 흐름 순서 첫 단계(`stepCode`) — 단계는 다 완료인데 게이트가 무효면 그 게이트(`gateCode`, 링크는 근거 단계)다.
 */
export function stepFreshnessCheck(ctx: PreValidationContext): PreValidationCheck {
  const { steps, gates, candidate, sourcing } = ctx.inputs;
  const problems: CheckProblem[] = [];
  const stale = REQUIRED_STEPS.filter((code) => steps[code]?.status !== 'COMPLETED');
  if (stale.length > 0) {
    problems.push({
      message: `최신이 아닌 단계가 있습니다: ${stale
        .map(
          (code) =>
            `${STEP_LABEL[code]}(${STEP_STATUS_TEXT[steps[code]?.status ?? 'NOT_RUN'] ?? steps[code]?.status})`,
        )
        .join(', ')}`,
      stepCode: stale[0]!,
    });
  }
  for (const gate of ['G2', 'G3'] as const) {
    const state = gates[gate];
    if (state.valid) continue;
    const changed =
      state.changedBasisKeys.length > 0 ? `(바뀐 값: ${state.changedBasisKeys.join(', ')})` : '';
    problems.push({
      message: state.passedAt
        ? `${GATE_TEXT[gate]} 뒤 값이 바뀌어 다시 통과해야 합니다${changed}`
        : `${GATE_TEXT[gate]}을 통과하지 않았습니다`,
      stepCode: GATE_STEP[gate],
      gateCode: gate,
    });
  }
  if (
    candidate.creationPath === 'RAKUTEN_URL' &&
    !(sourcing?.comparisonPerformed ?? false) &&
    !candidate.noComparisonConfirmedAt
  ) {
    problems.push({
      message: "URL로 만든 여정인데 비교를 하지 않았고 '비교 없이 확정' 기록도 없습니다",
      stepCode: 'PRICING',
      gateCode: 'G2',
    });
  }
  return resultOf('STEP_FRESHNESS', problems);
}
