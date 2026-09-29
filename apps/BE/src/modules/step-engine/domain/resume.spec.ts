import { resumeStepCode, resumeTarget } from './resume.js';
import { REQUIRED_STEPS, STEP_FLOW, type StepStatusMap } from './steps.js';

function steps(partial: StepStatusMap = {}): StepStatusMap {
  const map: StepStatusMap = {};
  for (const code of STEP_FLOW) map[code] = 'NOT_RUN';
  return { ...map, ...partial };
}

function requiredDone(extra: StepStatusMap = {}): StepStatusMap {
  const map = steps();
  for (const code of REQUIRED_STEPS) map[code] = 'COMPLETED';
  return { ...map, ...extra };
}

describe('resumeStepCode — 이어 할 단계(F-CW-10, 규칙 12)', () => {
  it('[② 완료, ③ 입력 대기, 나머지 미실행] → PRICING', () => {
    expect(resumeStepCode(steps({ SOURCING: 'COMPLETED', PRICING: 'WAITING_INPUT' }))).toBe(
      'PRICING',
    );
  });

  it('RUNNING은 건너뛴다', () => {
    expect(resumeStepCode(steps({ SOURCING: 'RUNNING' }))).toBe('PRICING');
    expect(
      resumeStepCode(steps({ SOURCING: 'COMPLETED', PRICING: 'COMPLETED', CATEGORY: 'RUNNING' })),
    ).toBe('THUMBNAIL');
  });

  it('흐름상 첫 실패·재실행 필요도 이어 할 단계다', () => {
    expect(resumeStepCode(requiredDone({ THUMBNAIL: 'RERUN_REQUIRED', TAGS: 'FAILED' }))).toBe(
      'THUMBNAIL',
    );
  });

  it('필수 단계가 끝나고 ⑨가 남으면 REGISTER, 모두 완료면 null', () => {
    expect(resumeStepCode(requiredDone())).toBe('REGISTER');
    expect(resumeStepCode(requiredDone({ REGISTER: 'COMPLETED' }))).toBeNull();
  });
});

describe('resumeTarget — 이어서 할 곳(단계 또는 대기 게이트)', () => {
  it('[② 완료, ③ 입력 대기] → 단계 PRICING(WAITING_INPUT)', () => {
    expect(
      resumeTarget(steps({ SOURCING: 'COMPLETED', PRICING: 'WAITING_INPUT' }), {
        G2: false,
        G3: false,
      }),
    ).toEqual({ kind: 'step', stepCode: 'PRICING', stepStatus: 'WAITING_INPUT' });
  });

  it('③ 완료·G2 무효 → 게이트 G2(④ 미실행보다 먼저)', () => {
    expect(
      resumeTarget(steps({ SOURCING: 'COMPLETED', PRICING: 'COMPLETED' }), {
        G2: false,
        G3: false,
      }),
    ).toEqual({ kind: 'gate', gate: 'G2' });
  });

  it('③ 완료·G2 유효 → 다음 단계 CATEGORY', () => {
    expect(
      resumeTarget(steps({ SOURCING: 'COMPLETED', PRICING: 'COMPLETED' }), { G2: true, G3: false }),
    ).toEqual({ kind: 'step', stepCode: 'CATEGORY', stepStatus: 'NOT_RUN' });
  });

  it('⑤~⑦ 완료·G3 무효 → 게이트 G3(⑧ 앞)', () => {
    const map = requiredDone({ UPLOAD: 'NOT_RUN' });
    expect(resumeTarget(map, { G2: true, G3: false })).toEqual({ kind: 'gate', gate: 'G3' });
  });

  it('9단계 완료·G2·G3 유효 → 게이트 G4', () => {
    expect(resumeTarget(requiredDone(), { G2: true, G3: true })).toEqual({
      kind: 'gate',
      gate: 'G4',
    });
  });

  it('RUNNING은 건너뛰고, 모두 완료(⑨ 포함)면 null', () => {
    expect(resumeTarget(steps({ SOURCING: 'RUNNING' }), { G2: false, G3: false })).toEqual({
      kind: 'step',
      stepCode: 'PRICING',
      stepStatus: 'NOT_RUN',
    });
    expect(
      resumeTarget(requiredDone({ REGISTER: 'COMPLETED' }), { G2: true, G3: true }),
    ).toBeNull();
  });

  it('③이 실행 중이면 G2를 기다리는 곳으로 보지 않는다(③이 완료여야 G2 대기)', () => {
    expect(
      resumeTarget(steps({ SOURCING: 'COMPLETED', PRICING: 'RUNNING' }), { G2: false, G3: false }),
    ).toEqual({ kind: 'step', stepCode: 'CATEGORY', stepStatus: 'NOT_RUN' });
  });
});
