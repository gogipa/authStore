import { STEP_FLOW, type StepCode, type StepStatusMap } from '../domain/steps.js';
import type { StartConditionCandidate } from './start-conditions.js';
import {
  checkStepEditable,
  checkStepRunnable,
  toBlockReason,
  WAITING_INPUT_MESSAGE,
} from './step-blocks.js';
import { editLockBlock, resumeLockBlock, runLockBlock } from './step-locks.js';

function steps(partial: StepStatusMap = {}): StepStatusMap {
  const map: StepStatusMap = {};
  for (const code of STEP_FLOW) map[code] = 'COMPLETED';
  map.REGISTER = 'NOT_RUN';
  return { ...map, ...partial };
}

const candidate: StartConditionCandidate = {
  status: 'WORKING',
  rakutenQuery: 'アシックス ゲルカヤノ14',
  sourceUrl: null,
  anchorModelCode: null,
  anchorItemCode: null,
  gender: 'MALE',
};
const GATES = { G2: true, G3: true };
const runBlockOf = (code: StepCode, map: StepStatusMap) =>
  checkStepRunnable(code, candidate, map, GATES, { mode: 'run' });

describe('실행 중 잠금(F-CW-18, 규칙 9, US-33 AC4)', () => {
  it('② RUNNING → ③·⑥-3 실행 막힘(후손)', () => {
    const map = steps({ SOURCING: 'RUNNING' });
    for (const code of ['PRICING', 'NOTICE_HTML'] as const) {
      expect(runLockBlock(code, map)).toEqual({
        code: 'STEP_LOCKED_BY_RUNNING_STEP',
        stepCode: code,
        runningStepCode: 'SOURCING',
      });
    }
  });

  it('③ RUNNING → ② 다시 실행·수정 막힘(조상)', () => {
    const map = steps({ PRICING: 'RUNNING' });
    expect(runLockBlock('SOURCING', map)?.code).toBe('STEP_LOCKED_BY_RUNNING_STEP');
    expect(editLockBlock('SOURCING', map)).toEqual({
      code: 'STEP_LOCKED_BY_RUNNING_STEP',
      stepCode: 'SOURCING',
      runningStepCode: 'PRICING',
    });
    // 수정은 앞 단계가 실행 중인 것으로 막지 않는다(③ 수정은 ②를 바꾸지 않는다)
    expect(editLockBlock('PRICING', steps({ SOURCING: 'RUNNING' }))).toBeNull();
  });

  it('⑥-1 RUNNING → ⑤ 실행 허용(서로 읽지 않는다)', () => {
    expect(runLockBlock('THUMBNAIL', steps({ COPY: 'RUNNING' }))).toBeNull();
    expect(runBlockOf('THUMBNAIL', steps({ COPY: 'RUNNING' }))).toBeNull();
  });

  it('⑤ WAITING_INPUT → 아무것도 잠그지 않는다', () => {
    const map = steps({ THUMBNAIL: 'WAITING_INPUT' });
    for (const code of STEP_FLOW) {
      if (code === 'THUMBNAIL' || code === 'REGISTER') continue;
      expect([code, runLockBlock(code, map)]).toEqual([code, null]);
      expect([code, editLockBlock(code, map)]).toEqual([code, null]);
    }
  });

  it('같은 단계는 하나만: RUNNING·입력 대기면 STEP_ALREADY_RUNNING(입력 고르기는 입력 대기 허용)', () => {
    expect(runLockBlock('PRICING', steps({ PRICING: 'RUNNING' }))).toEqual({
      code: 'STEP_ALREADY_RUNNING',
      stepCode: 'PRICING',
      status: 'RUNNING',
    });
    expect(runLockBlock('PRICING', steps({ PRICING: 'WAITING_INPUT' }))?.code).toBe(
      'STEP_ALREADY_RUNNING',
    );
    expect(
      runLockBlock('PRICING', steps({ PRICING: 'WAITING_INPUT' }), { allowWaitingSelf: true }),
    ).toBeNull();
    expect(editLockBlock('PRICING', steps({ PRICING: 'WAITING_INPUT' }))?.code).toBe(
      'STEP_ALREADY_RUNNING',
    );
    expect(
      toBlockReason({ code: 'STEP_ALREADY_RUNNING', stepCode: 'PRICING', status: 'WAITING_INPUT' })
        .message,
    ).toBe(WAITING_INPUT_MESSAGE);
  });

  it('입력 대기 이어 가기는 자기 자신은 보지 않고 앞·뒤 실행 중만 본다', () => {
    expect(resumeLockBlock('THUMBNAIL', steps({ THUMBNAIL: 'WAITING_INPUT' }))).toBeNull();
    expect(resumeLockBlock('THUMBNAIL', steps({ SOURCING: 'RUNNING' }))?.code).toBe(
      'STEP_LOCKED_BY_RUNNING_STEP',
    );
  });

  it('레일 disabledReason 문구는 실행 API와 같은 함수(STEP_LOCKED_BY_RUNNING_STEP {단계})', () => {
    const block = runBlockOf('PRICING', steps({ SOURCING: 'RUNNING' }))!;
    expect(toBlockReason(block)).toEqual({
      code: 'STEP_LOCKED_BY_RUNNING_STEP',
      message: '② 소싱이 실행 중이라 지금은 할 수 없습니다. 끝난 뒤 다시 해 주세요.',
      details: { stepCode: 'SOURCING' },
    });
  });
});

describe('실행 가능·수정 가능 순서(규칙 1·10)', () => {
  it('⑨·실행기 없음 422 INVALID_STEP_CODE → 잠금·제외 → 설정 없음 503 → 잠금 → 시작 조건 → 게이트', () => {
    expect(runBlockOf('REGISTER', steps())).toMatchObject({
      code: 'INVALID_STEP_CODE',
      reason: 'NOT_RUNNABLE',
    });
    expect(
      checkStepRunnable('SOURCING', candidate, steps(), GATES, { mode: 'run', hasRunner: false }),
    ).toMatchObject({ code: 'INVALID_STEP_CODE', reason: 'NO_RUNNER' });
    expect(
      checkStepRunnable('SOURCING', { ...candidate, status: 'REGISTERED' }, steps(), GATES, {
        mode: 'run',
      })?.code,
    ).toBe('CANDIDATE_LOCKED');
    expect(
      checkStepRunnable('SOURCING', candidate, steps(), GATES, {
        mode: 'run',
        settingsLoaded: false,
      })?.code,
    ).toBe('SETTINGS_INVALID');
    expect(
      checkStepRunnable(
        'UPLOAD',
        candidate,
        steps({ UPLOAD: 'NOT_RUN' }),
        { G2: true, G3: false },
        { mode: 'run' },
      ),
    ).toEqual({ code: 'GATE_NOT_PASSED', stepCode: 'UPLOAD', gate: 'G3' });
    expect(toBlockReason({ code: 'GATE_NOT_PASSED', stepCode: 'UPLOAD', gate: 'G3' }).message).toBe(
      'G3 썸네일 선택을 먼저 통과해 주세요.',
    );
  });

  it('EDIT은 COPY·NOTICE_RAW·NOTICE_HTML·TAGS의 완료·재실행 필요 현재 버전만', () => {
    expect(checkStepEditable('PRICING', candidate, steps())).toMatchObject({
      code: 'INVALID_STEP_CODE',
      reason: 'NOT_EDITABLE',
    });
    expect(checkStepEditable('COPY', candidate, steps())).toBeNull();
    expect(checkStepEditable('COPY', candidate, steps({ COPY: 'RERUN_REQUIRED' }))).toBeNull();
    expect(checkStepEditable('COPY', candidate, steps({ COPY: 'FAILED' }))).toEqual({
      code: 'STEP_NOT_COMPLETED',
      stepCode: 'COPY',
      status: 'FAILED',
    });
    expect(
      toBlockReason({ code: 'STEP_NOT_COMPLETED', stepCode: 'COPY', status: 'FAILED' }).message,
    ).toBe('⑥-1 카피가 아직 완료되지 않았습니다(지금: 실패).');
    expect(checkStepEditable('COPY', candidate, steps({ NOTICE_HTML: 'RUNNING' }))?.code).toBe(
      'STEP_LOCKED_BY_RUNNING_STEP',
    );
    expect(checkStepEditable('COPY', { ...candidate, status: 'EXCLUDED' }, steps())?.code).toBe(
      'CANDIDATE_EXCLUDED',
    );
  });
});
