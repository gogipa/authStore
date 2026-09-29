import {
  GATE_LABEL,
  stepPath,
  stepRelativePath,
  type StepCode,
  type StepScreen,
} from '@/shared/lib/steps';
import { STEP_SCREEN_NAME } from './labels';
import type { CandidateResumeTarget } from './types';

/** 대기 게이트가 열리는 화면: G2는 ③ 판정, G3는 ⑤ 썸네일, G4는 최종 승인(P1-04 Proposed, 05-1 §7.2) */
export const GATE_SCREEN: Record<'G2' | 'G3' | 'G4', StepScreen> = {
  G2: 'judgement',
  G3: 'thumbnail',
  G4: 'approval',
};

/**
 * 후보 틀(`/candidates/:id`)이 옮겨 갈 상대 경로. 이어 할 단계(`resumeStepCode`, 서버가 목록·상세에 같은 흐름 순서 함수로
 * 계산)의 화면, 없으면(모두 완료) 최종 승인(05-1 route맵 §3-2). ⑨는 최종 승인 화면이다.
 */
export function resumeRelativePath(resumeStepCode: StepCode | null | undefined): string {
  return resumeStepCode ? stepRelativePath(resumeStepCode) : GATE_SCREEN.G4;
}

/** 이어 할 단계 화면의 절대 경로 */
export function resumeStepPath(
  candidateId: number,
  resumeStepCode: StepCode | null | undefined,
): string {
  return resumeStepCode
    ? stepPath(candidateId, resumeStepCode)
    : `/candidates/${candidateId}/${GATE_SCREEN.G4}`;
}

/** '{단계} 열기'의 단계 글자('③ 판정', '⑥ 콘텐츠', 없으면 '최종 승인') */
export function resumeStepLabel(resumeStepCode: StepCode | null | undefined): string {
  return resumeStepCode ? STEP_SCREEN_NAME[resumeStepCode] : GATE_LABEL.G4;
}

/** 이어서 할 곳(단계 또는 대기 게이트) → 화면 경로 */
export function resumeTargetPath(target: CandidateResumeTarget): string {
  if (target.stepCode) return stepPath(target.candidateId, target.stepCode);
  return `/candidates/${target.candidateId}/${GATE_SCREEN[target.gate ?? 'G4']}`;
}

/** 이어서 할 곳의 글자('③ 판정', 게이트면 게이트 이름 '최종 승인'·'판정 확정'·'썸네일 선택') */
export function resumeTargetLabel(target: CandidateResumeTarget): string {
  if (target.stepCode) return STEP_SCREEN_NAME[target.stepCode];
  return GATE_LABEL[target.gate ?? 'G4'];
}
