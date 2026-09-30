import { ApiException } from '../../../common/errors/api.exception.js';
import { parseStartStepCode } from './continuous-run.service.js';

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof ApiException ? error.code : 'OTHER';
  }
}

describe('연속 실행 시작 body(P1-06 규칙 1)', () => {
  it('FROM_HERE의 startStepCode: 없으면 422 VALIDATION_FAILED, 모르는 코드·REGISTER는 422 INVALID_STEP_CODE', () => {
    expect(parseStartStepCode('CATEGORY')).toBe('CATEGORY');
    expect(parseStartStepCode('UPLOAD')).toBe('UPLOAD');
    expect(codeOf(() => parseStartStepCode(undefined))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => parseStartStepCode(''))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => parseStartStepCode('REGISTER'))).toBe('INVALID_STEP_CODE');
    expect(codeOf(() => parseStartStepCode('NOPE'))).toBe('INVALID_STEP_CODE');
  });
});
