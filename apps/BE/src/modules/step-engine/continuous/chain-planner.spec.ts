import type { StepCode, StepStatus, StepStatusMap } from '../domain/steps.js';
import type { StartConditionCandidate } from '../execution/start-conditions.js';
import {
  CHAIN_STEPS,
  checkChainStart,
  nextChainAction,
  type ChainAction,
  type ChainState,
} from './chain-planner.js';

const CANDIDATE: StartConditionCandidate = {
  status: 'WORKING',
  rakutenQuery: 'ニューバランス 530',
  sourceUrl: null,
  anchorModelCode: 'MR530SG',
  anchorItemCode: null,
  gender: 'MALE',
};

function allCompleted(extra: StepStatusMap = {}): StepStatusMap {
  const steps: StepStatusMap = {};
  for (const code of CHAIN_STEPS) steps[code] = 'COMPLETED';
  return { ...steps, ...extra };
}

function state(patch: Partial<ChainState>): ChainState {
  return {
    kind: 'FROM_HERE',
    startStepCode: 'SOURCING',
    candidate: CANDIDATE,
    steps: {},
    gates: { G2: false, G3: false },
    judgementPageStale: false,
    runs: {},
    skipped: [],
    ...patch,
  };
}

/**
 * 가짜 실행 결과로 묶음을 끝까지 돌린다: `run`이면 `outcome(stepCode)`가 준 상태로 바꾸고(실행 수 +1), `skip`이면 기록한다.
 * `after`로 실행 뒤 다른 단계 상태·게이트를 바꿀 수 있다(재실행 필요 전파 흉내).
 */
function simulate(
  initial: ChainState,
  outcome: (code: StepCode, s: ChainState) => StepStatus,
  after?: (code: StepCode, s: ChainState) => void,
): { actions: ChainAction[]; final: ChainState } {
  const s: ChainState = {
    ...initial,
    steps: { ...initial.steps },
    runs: { ...initial.runs },
    skipped: [...initial.skipped],
  };
  const actions: ChainAction[] = [];
  for (let i = 0; i < 40; i += 1) {
    const action = nextChainAction(s);
    actions.push(action);
    if ('stop' in action || 'wait' in action) return { actions, final: s };
    if ('skip' in action) {
      (s.skipped as StepCode[]).push(action.skip);
      continue;
    }
    const code = action.run;
    s.runs[code] = (s.runs[code] ?? 0) + 1;
    s.steps[code] = outcome(code, s);
    after?.(code, s);
  }
  throw new Error('끝나지 않는다');
}

const ranCodes = (actions: ChainAction[]) => actions.flatMap((a) => ('run' in a ? [a.run] : []));
const last = (actions: ChainAction[]) => actions.at(-1);

describe('연속 실행 계획(chain-planner, F-CW-14·15·16)', () => {
  describe('시작 검사(규칙 4·6)', () => {
    it('G2 무효 + CATEGORY 시작 → CONTINUOUS_RUN_BEFORE_G2, ②·③ 시작은 된다', () => {
      expect(checkChainStart(state({ startStepCode: 'CATEGORY' }))).toBe(
        'CONTINUOUS_RUN_BEFORE_G2',
      );
      expect(checkChainStart(state({ startStepCode: 'SOURCING' }))).toBeNull();
      expect(checkChainStart(state({ startStepCode: 'PRICING' }))).toBeNull();
      expect(
        checkChainStart(state({ startStepCode: 'CATEGORY', gates: { G2: true, G3: false } })),
      ).toBeNull();
    });

    it('RERUN_STALE 대상 없음 → NO_RERUN_REQUIRED_STEPS', () => {
      expect(
        checkChainStart(state({ kind: 'RERUN_STALE', startStepCode: null, steps: allCompleted() })),
      ).toBe('NO_RERUN_REQUIRED_STEPS');
    });

    it('RERUN_STALE: G2 전에 ②·③ 밖의 재실행 필요만 있으면 CONTINUOUS_RUN_BEFORE_G2', () => {
      const steps = allCompleted({ THUMBNAIL: 'RERUN_REQUIRED' });
      expect(checkChainStart(state({ kind: 'RERUN_STALE', startStepCode: null, steps }))).toBe(
        'CONTINUOUS_RUN_BEFORE_G2',
      );
      expect(
        checkChainStart(
          state({ kind: 'RERUN_STALE', startStepCode: null, steps, gates: { G2: true, G3: true } }),
        ),
      ).toBeNull();
    });
  });

  describe('G2 전(규칙 4)', () => {
    it('G2 무효 + FROM_HERE SOURCING: ② 실행 → ③ 실행 → ③ 입력 대기 → AWAIT_G2/PRICING', () => {
      const { actions } = simulate(state({}), (code) =>
        code === 'PRICING' ? 'WAITING_INPUT' : 'COMPLETED',
      );
      expect(ranCodes(actions)).toEqual(['SOURCING', 'PRICING']);
      expect(last(actions)).toEqual({ stop: 'AWAIT_G2', stepCode: 'PRICING' });
    });

    it('③이 완료여도 G2를 통과하지 않았으면 ④로 가지 않는다(AWAIT_G2/PRICING)', () => {
      const { actions } = simulate(state({}), () => 'COMPLETED');
      expect(ranCodes(actions)).toEqual(['SOURCING', 'PRICING']);
      expect(last(actions)).toEqual({ stop: 'AWAIT_G2', stepCode: 'PRICING' });
    });

    it('② 입력 대기(앵커·성별·후보 고르기) → AWAIT_G2/SOURCING, ② 실패 → NO_RUNNABLE_STEP/SOURCING', () => {
      const waiting = simulate(state({}), () => 'WAITING_INPUT');
      expect(ranCodes(waiting.actions)).toEqual(['SOURCING']);
      expect(last(waiting.actions)).toEqual({ stop: 'AWAIT_G2', stepCode: 'SOURCING' });
      const failed = simulate(state({}), () => 'FAILED');
      expect(last(failed.actions)).toEqual({ stop: 'NO_RUNNABLE_STEP', stepCode: 'SOURCING' });
    });
  });

  describe('G2 뒤(규칙 5)', () => {
    const g2 = { G2: true, G3: false };

    it('⑤ 입력 대기: ⑥-1·⑥-2·⑥-3·⑦은 실행, ⑧은 실행 안 함 → NO_RUNNABLE_STEP/THUMBNAIL', () => {
      const { actions } = simulate(
        state({
          startStepCode: 'THUMBNAIL',
          gates: g2,
          steps: { SOURCING: 'COMPLETED', PRICING: 'COMPLETED', CATEGORY: 'COMPLETED' },
        }),
        (code) => (code === 'THUMBNAIL' ? 'WAITING_INPUT' : 'COMPLETED'),
      );
      expect(ranCodes(actions)).toEqual(['THUMBNAIL', 'COPY', 'NOTICE_RAW', 'NOTICE_HTML', 'TAGS']);
      expect(last(actions)).toEqual({ stop: 'NO_RUNNABLE_STEP', stepCode: 'THUMBNAIL' });
    });

    it('⑥-2 실패 → ⑥-3·⑧(⑥-2를 직·간접으로 읽음)은 건너뛰고 ⑦은 실행', () => {
      const { actions } = simulate(
        state({
          startStepCode: 'CATEGORY',
          gates: { G2: true, G3: true },
          steps: { SOURCING: 'COMPLETED', PRICING: 'COMPLETED' },
        }),
        (code) => (code === 'NOTICE_RAW' ? 'FAILED' : 'COMPLETED'),
      );
      expect(ranCodes(actions)).toEqual(['CATEGORY', 'THUMBNAIL', 'COPY', 'NOTICE_RAW', 'TAGS']);
      expect(last(actions)).toEqual({ stop: 'NO_RUNNABLE_STEP', stepCode: 'NOTICE_RAW' });
    });

    it('⑤ 완료·G3 무효 → ⑧ 앞 AWAIT_G3/THUMBNAIL', () => {
      const { actions } = simulate(
        state({ startStepCode: 'CATEGORY', gates: g2, steps: allCompleted({ UPLOAD: 'NOT_RUN' }) }),
        () => 'COMPLETED',
      );
      expect(ranCodes(actions)).toEqual(['CATEGORY']);
      expect(last(actions)).toEqual({ stop: 'AWAIT_G3', stepCode: 'THUMBNAIL' });
    });

    it('G3 유효·지문 그대로 → ⑧ 실행 → AWAIT_G4/REGISTER', () => {
      const { actions } = simulate(
        state({
          startStepCode: 'TAGS',
          gates: { G2: true, G3: true },
          steps: allCompleted({ UPLOAD: 'NOT_RUN' }),
        }),
        () => 'COMPLETED',
      );
      expect(ranCodes(actions)).toEqual(['TAGS', 'UPLOAD']);
      expect(last(actions)).toEqual({ stop: 'AWAIT_G4', stepCode: 'REGISTER' });
    });

    it('완료·최신 단계는 skip으로 건너뛴다(고른 단계는 상태와 관계없이 실행)', () => {
      const { actions, final } = simulate(
        state({
          startStepCode: 'CATEGORY',
          gates: { G2: true, G3: true },
          steps: allCompleted({ COPY: 'RERUN_REQUIRED' }),
        }),
        () => 'COMPLETED',
      );
      expect(actions.slice(0, 3)).toEqual([
        { run: 'CATEGORY', refetch: false },
        { skip: 'THUMBNAIL' },
        { run: 'COPY', refetch: false },
      ]);
      expect(final.skipped).toEqual(['THUMBNAIL', 'NOTICE_RAW', 'NOTICE_HTML', 'TAGS', 'UPLOAD']);
      expect(last(actions)).toEqual({ stop: 'AWAIT_G4', stepCode: 'REGISTER' });
    });

    it('③ 판정 페이지가 7시간 전 → ③을 건너뛰지 않고 ② 재조회 → ③', () => {
      const fromSourcing = simulate(
        state({ gates: { G2: true, G3: true }, steps: allCompleted(), judgementPageStale: true }),
        () => 'COMPLETED',
        (code, s) => {
          if (code === 'PRICING') s.judgementPageStale = false;
        },
      );
      expect(fromSourcing.actions.slice(0, 2)).toEqual([
        { run: 'SOURCING', refetch: false },
        { run: 'PRICING', refetch: false },
      ]);
      // 고른 단계가 ③이면 ② 재조회부터
      const fromPricing = simulate(
        state({
          startStepCode: 'PRICING',
          gates: { G2: true, G3: true },
          steps: allCompleted(),
          judgementPageStale: true,
        }),
        () => 'COMPLETED',
      );
      expect(fromPricing.actions.slice(0, 2)).toEqual([
        { run: 'SOURCING', refetch: true },
        { run: 'PRICING', refetch: false },
      ]);
      // 6시간 전이 아니면 ③은 건너뛴다
      const fresh = simulate(
        state({ gates: { G2: true, G3: true }, steps: allCompleted() }),
        () => 'COMPLETED',
      );
      expect(fresh.actions[1]).toEqual({ skip: 'PRICING' });
    });

    it('② 재조회가 상한·24시간 쉼으로 실패하면 ②를 읽는 단계만 멈춘다(모두 ②를 읽어 NO_RUNNABLE_STEP/SOURCING)', () => {
      const { actions } = simulate(
        state({
          startStepCode: 'PRICING',
          gates: { G2: true, G3: true },
          steps: allCompleted(),
          judgementPageStale: true,
        }),
        (code) => (code === 'SOURCING' ? 'FAILED' : 'COMPLETED'),
      );
      expect(ranCodes(actions)).toEqual(['SOURCING']);
      expect(last(actions)).toEqual({ stop: 'NO_RUNNABLE_STEP', stepCode: 'SOURCING' });
    });

    it('이 묶음의 실행이 돌고 있으면 기다린다', () => {
      expect(
        nextChainAction(
          state({
            steps: { SOURCING: 'RUNNING' },
            runs: { SOURCING: 1 },
            gates: { G2: true, G3: true },
          }),
        ),
      ).toEqual({ wait: 'SOURCING' });
    });
  });

  describe('재실행 필요 단계 모두 실행(RERUN_STALE, 규칙 6)', () => {
    const rerun = (steps: StepStatusMap): ChainState =>
      state({ kind: 'RERUN_STALE', startStepCode: null, steps, gates: { G2: true, G3: true } });

    it('③이 다시 돌아 ⑥-3이 새로 재실행 필요 → ⑥-3까지 실행하고 표시가 없어지면 AWAIT_G4', () => {
      const { actions, final } = simulate(
        rerun(allCompleted({ PRICING: 'RERUN_REQUIRED' })),
        () => 'COMPLETED',
        (code, s) => {
          if (code === 'PRICING') s.steps.NOTICE_HTML = 'RERUN_REQUIRED';
        },
      );
      expect(ranCodes(actions)).toEqual(['PRICING', 'NOTICE_HTML']);
      expect(final.skipped).toEqual([]);
      expect(last(actions)).toEqual({ stop: 'AWAIT_G4', stepCode: 'REGISTER' });
    });

    it('같은 단계가 계속 재실행 필요가 되어도 한도(단계당 1번)에서 멈춘다', () => {
      const { actions } = simulate(
        rerun(allCompleted({ NOTICE_HTML: 'RERUN_REQUIRED' })),
        () => 'RERUN_REQUIRED',
      );
      expect(ranCodes(actions)).toEqual(['NOTICE_HTML']);
      expect(last(actions)).toEqual({ stop: 'NO_RUNNABLE_STEP', stepCode: 'NOTICE_HTML' });
    });

    it('오너 입력(입력 대기)에서는 그 결과를 읽는 단계만 멈추고, 게이트(G2)에서 멈춘다', () => {
      const waiting = simulate(
        rerun(allCompleted({ THUMBNAIL: 'RERUN_REQUIRED', TAGS: 'RERUN_REQUIRED' })),
        (code) => (code === 'THUMBNAIL' ? 'WAITING_INPUT' : 'COMPLETED'),
      );
      expect(ranCodes(waiting.actions)).toEqual(['THUMBNAIL', 'TAGS']);
      expect(last(waiting.actions)).toEqual({ stop: 'NO_RUNNABLE_STEP', stepCode: 'THUMBNAIL' });

      const beforeG2 = simulate(
        {
          ...rerun(allCompleted({ SOURCING: 'RERUN_REQUIRED', COPY: 'RERUN_REQUIRED' })),
          gates: { G2: false, G3: false },
        },
        () => 'COMPLETED',
      );
      expect(ranCodes(beforeG2.actions)).toEqual(['SOURCING']);
      expect(last(beforeG2.actions)).toEqual({ stop: 'AWAIT_G2', stepCode: 'PRICING' });
    });

    it('⑧이 재실행 필요인데 G3이 무효 → AWAIT_G3', () => {
      const { actions } = simulate(
        { ...rerun(allCompleted({ UPLOAD: 'RERUN_REQUIRED' })), gates: { G2: true, G3: false } },
        () => 'COMPLETED',
      );
      expect(ranCodes(actions)).toEqual([]);
      expect(last(actions)).toEqual({ stop: 'AWAIT_G3', stepCode: 'THUMBNAIL' });
    });
  });
});
