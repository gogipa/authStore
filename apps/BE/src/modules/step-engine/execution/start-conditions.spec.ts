import { STEP_FLOW, type StepStatus, type StepStatusMap } from '../domain/steps.js';
import {
  missingRequiredInputs,
  missingStartInputs,
  type StartConditionCandidate,
} from './start-conditions.js';
import { checkStepRunnable, toApiException } from './step-blocks.js';

const candidate = (patch: Partial<StartConditionCandidate> = {}): StartConditionCandidate => ({
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

describe('시작 조건(F-BS-16, 규칙 2, US-33 AC1)', () => {
  it.each<StepStatus>(['NOT_RUN', 'RUNNING', 'WAITING_INPUT', 'FAILED', 'RERUN_REQUIRED'])(
    '③의 앞 ②가 %s면 막고 fieldErrors에 입력 키',
    (status) => {
      expect(missingStartInputs('PRICING', candidate(), steps({ SOURCING: status }))).toEqual([
        'sourcing.targetSkus',
      ]);
    },
  );

  it('② COMPLETED면 ③ 시작 조건 충족. 성별이 없으면 candidate.gender', () => {
    expect(missingStartInputs('PRICING', candidate(), steps({ SOURCING: 'COMPLETED' }))).toEqual(
      [],
    );
    expect(
      missingStartInputs('PRICING', candidate({ gender: null }), steps({ SOURCING: 'COMPLETED' })),
    ).toEqual(['candidate.gender']);
  });

  it('⑦은 ④(선택)가 미실행이어도 통과한다', () => {
    expect(missingStartInputs('TAGS', candidate(), steps({ SOURCING: 'COMPLETED' }))).toEqual([]);
    expect(
      checkStepRunnable('TAGS', candidate(), steps({ SOURCING: 'COMPLETED' }), NO_GATES, {
        mode: 'run',
      }),
    ).toBeNull();
  });

  it('⑤는 ③ 없이 통과한다(흐름 순서와 관계없이)', () => {
    expect(
      checkStepRunnable('THUMBNAIL', candidate(), steps({ SOURCING: 'COMPLETED' }), NO_GATES, {
        mode: 'run',
      }),
    ).toBeNull();
  });

  it('⑥-3은 ⑥-1·⑥-2·③이 모두 완료여야 하고, ④(선택)는 없어도 된다', () => {
    expect(
      missingStartInputs('NOTICE_HTML', candidate(), steps({ SOURCING: 'COMPLETED' })).sort(),
    ).toEqual(['copy.draft', 'noticeRaw.facts', 'pricing.saleSizes']);
    expect(
      missingStartInputs(
        'NOTICE_HTML',
        candidate(),
        steps({
          SOURCING: 'COMPLETED',
          PRICING: 'COMPLETED',
          COPY: 'COMPLETED',
          NOTICE_RAW: 'COMPLETED',
        }),
      ),
    ).toEqual([]);
  });

  it('②는 검색어·URL·앵커 키 중 하나가 있어야 한다(대표 키 candidate.rakutenQuery)', () => {
    expect(missingStartInputs('SOURCING', candidate({ rakutenQuery: null }), steps())).toEqual([
      'candidate.rakutenQuery',
    ]);
    expect(
      missingStartInputs(
        'SOURCING',
        candidate({ rakutenQuery: null, anchorModelCode: '1201A019108' }),
        steps(),
      ),
    ).toEqual([]);
  });

  it('실행기가 읽은 필수 시작 조건 값이 없으면 빠진 입력(선택·실행 중 오너 입력은 빼고)', () => {
    expect(
      missingRequiredInputs([
        {
          inputKey: 'settings.costs',
          sourceType: 'SETTINGS',
          isStartCondition: true,
          required: true,
          value: null,
        },
        {
          inputKey: 'owner.coupon',
          sourceType: 'OWNER_INPUT',
          isStartCondition: true,
          required: false,
          value: null,
        },
        {
          inputKey: 'owner.domesticPrice',
          sourceType: 'OWNER_INPUT',
          isStartCondition: false,
          required: false,
          value: null,
        },
        {
          inputKey: 'candidate.gender',
          sourceType: 'OWNER_INPUT',
          isStartCondition: true,
          required: true,
          value: 'MALE',
        },
      ]),
    ).toEqual(['settings.costs']);
  });

  it('409 STEP_START_CONDITION_UNMET 문구·fieldErrors·details(05-3 §2 모양)', () => {
    const error = toApiException({
      code: 'STEP_START_CONDITION_UNMET',
      stepCode: 'PRICING',
      missingInputs: ['owner.domesticPrice', 'candidate.gender'],
    });
    expect(error.getStatus()).toBe(409);
    expect(error.message).toBe('시작에 필요한 값이 없습니다: 국내 기준가, 성별.');
    expect(error.fieldErrors?.map((f) => f.field)).toEqual([
      'owner.domesticPrice',
      'candidate.gender',
    ]);
    expect(error.details).toEqual({ stepCode: 'PRICING' });
  });
});
