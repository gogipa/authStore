import {
  REQUIRED_STEPS,
  RESUMABLE_STEP_STATUSES,
  STEP_FLOW,
  stepStatusOf,
  type StepCode,
  type StepStatus,
  type StepStatusMap,
} from './steps.js';

/** G2·G3이 지금 유효한가(GATE_VALIDITY 포트의 결과를 줄인 것) */
export interface GateFlags {
  G2: boolean;
  G3: boolean;
}

/** 이어서 할 곳: 단계 또는 대기 중인 게이트(05-2 CandidateResumeTarget) */
export type ResumeTarget =
  | { kind: 'step'; stepCode: StepCode; stepStatus: StepStatus }
  | { kind: 'gate'; gate: 'G2' | 'G3' | 'G4' };

function isResumable(status: StepStatus): boolean {
  return (RESUMABLE_STEP_STATUSES as readonly StepStatus[]).includes(status);
}

/**
 * 이어 할 단계(F-CW-10, 05-2 CandidateSummary.resumeStepCode): 흐름 순서(②→…→⑨)에서 첫 입력 대기·미실행·실패·
 * 재실행 필요 단계. 실행 중(RUNNING)은 건너뛴다. 없으면 null. 목록·상세·FE 후보 틀 이동이 모두 이 값을 쓴다.
 */
export function resumeStepCode(steps: StepStatusMap): StepCode | null {
  for (const code of STEP_FLOW) {
    if (isResumable(stepStatusOf(steps, code))) return code;
  }
  return null;
}

/**
 * 이어서 할 곳(05-2 getCandidateResumeTarget x-decision §7.2-11): 흐름 순서대로 보며 첫 이어 할 단계 또는
 * 대기 중인 게이트를 준다. 게이트 자리는 ③ 뒤 G2, ⑧ 앞 G3, 끝 G4다.
 * - G2 대기: ③이 완료인데 G2가 유효하지 않다(G2는 ③ 판정 화면에서 통과한다)
 * - G3 대기: ⑤가 완료인데 G3이 유효하지 않다(⑤는 G3 선택까지 입력 대기라 보통 단계로 먼저 걸린다)
 * - G4 대기: 필수 단계(②~⑧)가 모두 완료이고 ⑨가 완료가 아니다
 * 게이트 우선 규칙은 두지 않는다(흐름 순서만). 할 곳이 없으면 null.
 */
export function resumeTarget(steps: StepStatusMap, gates: GateFlags): ResumeTarget | null {
  const stepAt = (code: StepCode): ResumeTarget | null => {
    const status = stepStatusOf(steps, code);
    return isResumable(status) ? { kind: 'step', stepCode: code, stepStatus: status } : null;
  };
  const done = (code: StepCode) => stepStatusOf(steps, code) === 'COMPLETED';

  for (const code of ['SOURCING', 'PRICING'] as const) {
    const hit = stepAt(code);
    if (hit) return hit;
  }
  if (done('PRICING') && !gates.G2) return { kind: 'gate', gate: 'G2' };
  for (const code of [
    'CATEGORY',
    'THUMBNAIL',
    'COPY',
    'NOTICE_RAW',
    'NOTICE_HTML',
    'TAGS',
  ] as const) {
    const hit = stepAt(code);
    if (hit) return hit;
  }
  if (done('THUMBNAIL') && !gates.G3) return { kind: 'gate', gate: 'G3' };
  const upload = stepAt('UPLOAD');
  if (upload) return upload;
  if (REQUIRED_STEPS.every(done) && !done('REGISTER')) return { kind: 'gate', gate: 'G4' };
  return null;
}
