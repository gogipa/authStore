import { checkStepRunnable, type RunnableCandidate } from './runnable.js';
import {
  downstreamSteps,
  GENDER_READER_STEPS,
  REQUIRED_STEPS,
  STEP_FLOW,
  upstreamSteps,
  type StepStatusMap,
} from './steps.js';

const candidate = (patch: Partial<RunnableCandidate> = {}): RunnableCandidate => ({
  status: 'WORKING',
  rakutenQuery: 'アシックス ゲルカヤノ14',
  sourceUrl: null,
  anchorModelCode: null,
  anchorItemCode: null,
  gender: 'MALE',
  ...patch,
});

function steps(partial: StepStatusMap = {}): StepStatusMap {
  const map: StepStatusMap = {};
  for (const code of STEP_FLOW) map[code] = 'NOT_RUN';
  return { ...map, ...partial };
}

const NO_GATES = { G2: false, G3: false };

describe('단계 그래프(PRD §5.3 시작 조건)', () => {
  it('성별을 읽는 단계는 ③·④·⑥-3·⑦', () => {
    expect(GENDER_READER_STEPS).toEqual(['PRICING', 'CATEGORY', 'NOTICE_HTML', 'TAGS']);
  });

  it('앞·뒤 단계(직접·간접)', () => {
    expect([...upstreamSteps('NOTICE_HTML')].sort()).toEqual(
      ['COPY', 'NOTICE_RAW', 'PRICING', 'SOURCING'].sort(),
    );
    expect([...downstreamSteps('THUMBNAIL')].sort()).toEqual(['REGISTER', 'UPLOAD']);
    expect(downstreamSteps('SOURCING').size).toBe(9);
    expect([...downstreamSteps('CATEGORY')].sort()).toEqual(['REGISTER', 'TAGS']);
  });
});

describe('checkStepRunnable — 입력 고르기(F-CW-22, 규칙 13)', () => {
  it('새 후보: ②만 실행할 수 있다(검색어가 있다)', () => {
    expect(checkStepRunnable('SOURCING', candidate(), steps(), NO_GATES)).toBeNull();
    expect(checkStepRunnable('PRICING', candidate(), steps(), NO_GATES)).toEqual({
      code: 'STEP_START_CONDITION_UNMET',
      stepCode: 'PRICING',
      missingInputs: ['step.SOURCING'],
    });
  });

  it('② 완료 뒤 ③·④·⑤·⑥-1·⑥-2·⑦은 되고 ⑥-3·⑧은 앞 단계가 모자란다', () => {
    const map = steps({ SOURCING: 'COMPLETED' });
    for (const code of [
      'PRICING',
      'CATEGORY',
      'THUMBNAIL',
      'COPY',
      'NOTICE_RAW',
      'TAGS',
    ] as const) {
      expect(checkStepRunnable(code, candidate(), map, NO_GATES)).toBeNull();
    }
    expect(checkStepRunnable('NOTICE_HTML', candidate(), map, NO_GATES)?.code).toBe(
      'STEP_START_CONDITION_UNMET',
    );
    expect(checkStepRunnable('UPLOAD', candidate(), map, NO_GATES)?.code).toBe(
      'STEP_START_CONDITION_UNMET',
    );
  });

  it('성별이 없으면 ③은 시작 조건이 모자란다(candidate.gender)', () => {
    expect(
      checkStepRunnable(
        'PRICING',
        candidate({ gender: null }),
        steps({ SOURCING: 'COMPLETED' }),
        NO_GATES,
      ),
    ).toEqual({
      code: 'STEP_START_CONDITION_UNMET',
      stepCode: 'PRICING',
      missingInputs: ['candidate.gender'],
    });
  });

  it('검색어·URL·앵커가 모두 없으면 ②도 안 된다', () => {
    expect(
      checkStepRunnable('SOURCING', candidate({ rakutenQuery: null }), steps(), NO_GATES)?.code,
    ).toBe('STEP_START_CONDITION_UNMET');
    expect(
      checkStepRunnable(
        'SOURCING',
        candidate({ rakutenQuery: null, sourceUrl: 'https://item.rakuten.co.jp/a/b/' }),
        steps(),
        NO_GATES,
      ),
    ).toBeNull();
  });

  it('같은 단계·앞 단계·뒷단계가 실행 중이면 안 된다(입력 대기는 잠그지 않는다)', () => {
    const base = { SOURCING: 'COMPLETED' as const };
    expect(
      checkStepRunnable('PRICING', candidate(), steps({ ...base, PRICING: 'RUNNING' }), NO_GATES)
        ?.code,
    ).toBe('STEP_ALREADY_RUNNING');
    expect(
      checkStepRunnable(
        'SOURCING',
        candidate(),
        steps({ ...base, THUMBNAIL: 'RUNNING' }),
        NO_GATES,
      ),
    ).toEqual({
      code: 'STEP_LOCKED_BY_RUNNING_STEP',
      stepCode: 'SOURCING',
      runningStepCode: 'THUMBNAIL',
    });
    // ⑤와 ③은 서로 읽지 않는다
    expect(
      checkStepRunnable('THUMBNAIL', candidate(), steps({ ...base, PRICING: 'RUNNING' }), NO_GATES),
    ).toBeNull();
    // 입력 대기 중인 ③ 자신도 고를 수 있다(화면을 열어 입력한다)
    expect(
      checkStepRunnable(
        'PRICING',
        candidate(),
        steps({ ...base, PRICING: 'WAITING_INPUT' }),
        NO_GATES,
      ),
    ).toBeNull();
  });

  it('⑧은 G3이 있어야 하고, ⑨는 단계 실행으로 돌리지 않는다', () => {
    const map = steps();
    for (const code of REQUIRED_STEPS) map[code] = 'COMPLETED';
    map.UPLOAD = 'NOT_RUN';
    expect(checkStepRunnable('UPLOAD', candidate(), map, { G2: true, G3: false })).toEqual({
      code: 'GATE_NOT_PASSED',
      stepCode: 'UPLOAD',
      gate: 'G3',
    });
    expect(checkStepRunnable('UPLOAD', candidate(), map, { G2: true, G3: true })).toBeNull();
    expect(checkStepRunnable('REGISTER', candidate(), map, { G2: true, G3: true })?.code).toBe(
      'INVALID_STEP_CODE',
    );
  });

  it('잠김·제외 후보는 어떤 단계도 안 되고, 임시 후보는 ⑧을 못 돌린다', () => {
    expect(
      checkStepRunnable('SOURCING', candidate({ status: 'REGISTERING' }), steps(), NO_GATES),
    ).toEqual({
      code: 'CANDIDATE_LOCKED',
      status: 'REGISTERING',
    });
    expect(
      checkStepRunnable('SOURCING', candidate({ status: 'EXCLUDED' }), steps(), NO_GATES)?.code,
    ).toBe('CANDIDATE_EXCLUDED');
    expect(
      checkStepRunnable('UPLOAD', candidate({ status: 'TEMP' }), steps(), NO_GATES)?.code,
    ).toBe('TEMP_CANDIDATE_NOT_ALLOWED');
    // 승인대기·검증완료는 잠김이 아니다(다시 실행하면 작업중으로 돌아간다)
    expect(
      checkStepRunnable('SOURCING', candidate({ status: 'AWAITING_APPROVAL' }), steps(), NO_GATES),
    ).toBeNull();
  });
});
