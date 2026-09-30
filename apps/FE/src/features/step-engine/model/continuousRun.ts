import type { StepCode } from '@/shared/lib/steps';
import { STEP_NAME } from './labels';
import type { ContinuousRunDetail, StepChainStopReason } from './types';

/**
 * 연속 실행 글(P1-06). 시안(CandidateWork.dc.html)에 배너가 없어 문구를 정했다(Proposed, 05-1 §7.2 P1-06 구현 결정).
 * 버튼·꺼진 이유 글은 시안 그대로다.
 */

/** 시안 버튼 글 */
export const CONTINUOUS_RUN_LABEL = '여기부터 연속 실행';
export const RERUN_ALL_LABEL = '재실행 필요 단계 모두 실행';
/** 시안: 재실행 필요 단계가 없을 때 버튼 옆 글 */
export const NO_RERUN_TEXT = '재실행 필요 단계가 없습니다';
/** 시안: G2 줄 설명 — G2 전 ④ 이후 '여기부터 연속 실행'이 꺼진 이유 */
export const BEFORE_G2_CHAIN_TEXT =
  '판정(G2)을 통과해야 ④부터 연속 실행할 수 있습니다. 그 전에는 단계를 하나씩 실행합니다.';
/** 시안: ⑧ '실행'이 G3 전에 꺼진 이유 */
export const UPLOAD_NEEDS_G3_TEXT = '썸네일 선택(G3)이 필요합니다';
/** 시안: ⑨ '실행'이 늘 꺼진 이유 */
export const REGISTER_ONLY_G4_TEXT = '최종 승인(G4)에서만 등록합니다';

/** '여기부터 연속 실행' 버튼을 두지 않는 단계(시안: ⑧·⑨는 '실행'만) */
export const NO_CONTINUOUS_STEPS: readonly StepCode[] = ['UPLOAD', 'REGISTER'];

/** 멈춘 이유 → 배너 글(Proposed). 멈춘 단계 이름을 넣는다 */
export function stopReasonText(reason: StepChainStopReason, stepCode: StepCode | null): string {
  const step = stepCode ? STEP_NAME[stepCode] : null;
  switch (reason) {
    case 'AWAIT_G2':
      return stepCode === 'SOURCING'
        ? '② 소싱이 입력을 기다려 판정(G2) 앞에서 멈췄습니다. 소싱 화면에서 고른 뒤 판정을 확정해 주세요.'
        : '판정(G2) 앞에서 멈췄습니다. ③ 판정 화면에서 국내 기준가를 넣고 판정을 확정해 주세요.';
    case 'AWAIT_G3':
      return '썸네일 선택(G3) 앞에서 멈췄습니다. ⑤ 썸네일 화면에서 대표 썸네일을 골라 주세요.';
    case 'AWAIT_G4':
      return '끝까지 실행했습니다. 최종 승인(G4)에서 확인해 주세요.';
    case 'NO_RUNNABLE_STEP':
      return step
        ? `더 실행할 단계가 없어 멈췄습니다. ${step}에서 입력을 마치거나 다시 실행해 주세요.`
        : '더 실행할 단계가 없어 멈췄습니다.';
    case 'APP_RESTART':
      return '앱이 꺼져 연속 실행이 멈췄습니다. 필요하면 다시 시작해 주세요.';
  }
}

/** 배너 제목(진행 중·멈춤) */
export function continuousRunTitle(run: Pick<ContinuousRunDetail, 'kind' | 'endedAt'>): string {
  const name = run.kind === 'RERUN_STALE' ? RERUN_ALL_LABEL : '연속 실행';
  return run.endedAt === null ? `${name} 중입니다` : `${name}이 멈췄습니다`;
}

/** 진행한 단계 글: '② 소싱 → ③ 판정' */
export function chainStepsText(run: Pick<ContinuousRunDetail, 'stepRuns'>): string {
  return run.stepRuns.map((r) => STEP_NAME[r.stepCode]).join(' → ');
}

/** 건너뛴 단계 글: '③ 판정, ④ 카테고리' */
export function skippedStepsText(run: Pick<ContinuousRunDetail, 'skippedStepCodes'>): string {
  return run.skippedStepCodes.map((code) => STEP_NAME[code]).join(', ');
}
