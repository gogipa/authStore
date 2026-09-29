import { describe, expect, it } from 'vitest';
import { STEP_CODES, STEP_RAIL, STEP_SCREEN, isStepCode, stepPath } from './steps';

describe('단계 코드 ↔ 화면 대응표', () => {
  it('모든 단계 코드가 화면을 하나씩 가진다', () => {
    expect(Object.keys(STEP_SCREEN).sort()).toEqual([...STEP_CODES].sort());
  });

  it('단계 레일에 모든 단계 코드가 한 번씩 나온다', () => {
    const codes = STEP_RAIL.flatMap((row) => (row.kind === 'step' ? [row.code] : []));
    expect(codes).toEqual([...STEP_CODES]);
  });

  it('단계 화면 절대 경로를 만든다', () => {
    expect(stepPath(12, 'SOURCING')).toBe('/candidates/12/sourcing');
    expect(stepPath('12', 'CATEGORY')).toBe('/candidates/12/judgement#category');
    expect(stepPath(12, 'NOTICE_HTML')).toBe('/candidates/12/content');
    expect(stepPath(12, 'REGISTER')).toBe('/candidates/12/approval');
  });

  it('isStepCode는 ERD 코드만 받는다', () => {
    expect(isStepCode('TAGS')).toBe(true);
    expect(isStepCode('CONTENT_COPY')).toBe(false);
  });
});
