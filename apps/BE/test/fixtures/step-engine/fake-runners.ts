import { Inject, Injectable } from '@nestjs/common';
import type { AnchorKeyInput } from '../../../src/modules/step-engine/candidates/candidate-identity.service.js';
import type {
  CandidateEffects,
  CandidateStatusEffect,
  StepInput,
  StepInputContext,
  StepOutcome,
  StepRunContext,
  StepRunner,
  StepRunRow,
  Tx,
} from '../../../src/modules/step-engine/contracts/step-runner.js';
import {
  readSettingsPath,
  settingsPathOf,
} from '../../../src/modules/step-engine/domain/input-keys.js';
import {
  outputKeysOf,
  STEP_INPUT_SPECS,
  type StepInputSpec,
} from '../../../src/modules/step-engine/domain/step-graph.js';
import type { StepCode } from '../../../src/modules/step-engine/domain/steps.js';

/**
 * 가짜 실행기(P1-05 e2e). 단계마다 PRD §5.3 표의 입력 키(`STEP_INPUT_SPECS`)를 선언하고, 호출마다 결과 대본을 따른다.
 * 실제 외부·AI를 부르지 않는다.
 *
 * - 입력 값: 테스트가 바꿀 수 있는 메모리 표(`FakeStepWorld.values`, 후보별 입력 키 → 값)에서 읽는다.
 *   앞 단계 산출물은 그 단계 현재 완료 버전의 산출물(`outputs[stepRunId]`)에서, 후보 필드는 candidate 행에서,
 *   설정은 현재 설정에서 읽는다.
 * - 산출물: 완료되면 이 단계가 내는 입력 키(`outputKeysOf`)의 지금 값(`values`, 없으면 '<키>@1')을 그 실행의 산출물로 남긴다.
 * - 대본: COMPLETE(기본)·WAIT(입력 대기)·FAIL(실패)·THROW(예외)·HOLD(풀어 줄 때까지 대기).
 * - P1-06: ② `refetch`(재조회 모드)는 호출 기록에 `refetch: true`를 남기고 `run`과 같은 대본을 따른다. ③ 판정 페이지 수집
 *   시각(`judgementPageCollectedAt`)은 ③이 돌 때의 `world.get(후보, JUDGEMENT_PAGE_AT)` 값이고, ②가 완료되면
 *   `world.get(후보, PAGE_FETCHED_AT)`(있으면)으로 그 값을 바꾼다(② 재조회 → ③ 재판정 흉내).
 */

/** 후보별 값 키: 다음 ③ 실행이 판정에 쓸 라쿠텐 페이지 수집 시각(Date) */
export const JUDGEMENT_PAGE_AT = 'fake.judgementPageCollectedAt';
/** 후보별 값 키: ②가 완료될 때 새로 받은 페이지 수집 시각(Date) — 있으면 JUDGEMENT_PAGE_AT을 이 값으로 바꾼다 */
export const PAGE_FETCHED_AT = 'fake.pageFetchedAt';

export type FakeScript =
  | { kind: 'COMPLETE'; candidateEffects?: CandidateEffects }
  | { kind: 'WAIT'; waitingReasonCode?: string; pendingInputs?: string[] }
  | {
      kind: 'FAIL';
      failureKind?: 'EXTERNAL_API' | 'AI' | 'INPUT_VALIDATION';
      errorCode?: string;
      errorMessage?: string;
    }
  | { kind: 'THROW'; error: unknown }
  | { kind: 'HOLD'; then?: FakeScript; onHold?: () => void | Promise<void> };

export interface FakeRunCall {
  stepCode: StepCode;
  ctx: StepRunContext;
  /** ② 재조회 모드로 불렸는가(P1-06) */
  refetch: boolean;
}

/** AI를 쓰는 가짜 단계(PRE_G2_AI_COST) */
const AI_STEPS: readonly StepCode[] = ['THUMBNAIL', 'COPY', 'NOTICE_RAW'];

/** 테스트가 바꾸는 메모리 표와 호출 기록 */
@Injectable()
export class FakeStepWorld {
  /** 후보별 입력 값(오너 입력·앞 단계가 낼 값) */
  readonly values = new Map<number, Map<string, unknown>>();
  /** 실행별 산출물(입력 키 → 값) */
  readonly outputs = new Map<number, Record<string, unknown>>();
  /** 실행별 실행 중 오너 입력 값(다시 실행 기본값) */
  readonly ownerInputsByRun = new Map<number, Record<string, unknown>>();
  /** ② 실행별 앵커 키 */
  readonly anchors = new Map<number, AnchorKeyInput>();
  /** ③ 실행별 판정에 쓴 페이지 수집 시각(P1-06 6시간 규칙) */
  readonly judgementPageAt = new Map<number, Date>();
  readonly calls: FakeRunCall[] = [];
  /** ⑨ 재시작 훅이 돌려줄 후보 전이(P4-03 흉내) */
  registerInterruptEffect: CandidateStatusEffect | null = null;
  readonly interruptedRuns: number[] = [];
  private readonly scripts = new Map<StepCode, FakeScript[]>();
  private readonly holds: { stepCode: StepCode; release: () => void }[] = [];
  private readonly pendingOwnerInputs = new Map<number, Record<string, unknown>>();
  private readonly pendingAnchors = new Map<number, AnchorKeyInput>();
  private readonly pendingPageAt = new Map<number, Date>();

  reset(): void {
    this.values.clear();
    this.outputs.clear();
    this.ownerInputsByRun.clear();
    this.anchors.clear();
    this.judgementPageAt.clear();
    this.pendingPageAt.clear();
    this.calls.length = 0;
    this.scripts.clear();
    this.registerInterruptEffect = null;
    this.interruptedRuns.length = 0;
    this.pendingOwnerInputs.clear();
    this.pendingAnchors.clear();
    this.releaseAll();
  }

  set(candidateId: number, key: string, value: unknown): void {
    let map = this.values.get(candidateId);
    if (!map) {
      map = new Map();
      this.values.set(candidateId, map);
    }
    map.set(key, value);
  }

  get(candidateId: number, key: string): unknown {
    return this.values.get(candidateId)?.get(key);
  }

  /** 다음 실행들의 결과 대본(단계별 차례로 쓴다. 다 쓰면 COMPLETE) */
  script(stepCode: StepCode, ...scripts: FakeScript[]): void {
    const list = this.scripts.get(stepCode) ?? [];
    list.push(...scripts);
    this.scripts.set(stepCode, list);
  }

  nextScript(stepCode: StepCode): FakeScript {
    return this.scripts.get(stepCode)?.shift() ?? { kind: 'COMPLETE' };
  }

  /** 대기 중인 HOLD 실행 수 */
  heldCount(stepCode?: StepCode): number {
    return this.holds.filter((h) => !stepCode || h.stepCode === stepCode).length;
  }

  /** HOLD로 멈춘 실행을 푼다(주지 않으면 모두) */
  release(stepCode?: StepCode): void {
    for (let i = this.holds.length - 1; i >= 0; i -= 1) {
      const hold = this.holds[i]!;
      if (stepCode && hold.stepCode !== stepCode) continue;
      this.holds.splice(i, 1);
      hold.release();
    }
  }

  releaseAll(): void {
    this.release();
  }

  hold(stepCode: StepCode): Promise<void> {
    return new Promise((resolve) => this.holds.push({ stepCode, release: resolve }));
  }

  /** 이 단계의 호출 기록 */
  callsOf(stepCode: StepCode): StepRunContext[] {
    return this.calls.filter((c) => c.stepCode === stepCode).map((c) => c.ctx);
  }

  rememberRun(
    stepRunId: number,
    ownerInputs: Record<string, unknown>,
    anchor?: AnchorKeyInput,
    pageAt?: Date,
  ) {
    this.pendingOwnerInputs.set(stepRunId, ownerInputs);
    if (anchor) this.pendingAnchors.set(stepRunId, anchor);
    if (pageAt) this.pendingPageAt.set(stepRunId, pageAt);
  }

  /** 이 단계의 재조회 모드 호출 수 */
  refetchCallsOf(stepCode: StepCode): number {
    return this.calls.filter((c) => c.stepCode === stepCode && c.refetch).length;
  }

  commitRun(stepRunId: number, output: Record<string, unknown> | null): void {
    if (output) this.outputs.set(stepRunId, output);
    const owner = this.pendingOwnerInputs.get(stepRunId);
    if (owner) this.ownerInputsByRun.set(stepRunId, owner);
    const anchor = this.pendingAnchors.get(stepRunId);
    if (anchor) this.anchors.set(stepRunId, anchor);
    const pageAt = this.pendingPageAt.get(stepRunId);
    if (pageAt && output) this.judgementPageAt.set(stepRunId, pageAt);
  }
}

function candidateValue(ctx: StepInputContext, key: string): unknown {
  const c = ctx.candidate;
  switch (key) {
    case 'candidate.gender':
      return c.gender;
    case 'candidate.rakutenQuery':
      return c.rakutenQuery;
    case 'candidate.sourceUrl':
      return c.sourceUrl;
    case 'candidate.anchorKey':
      return c.anchorFixedAt
        ? {
            modelCode: c.anchorModelCode,
            itemCode: c.anchorItemCode,
            colorCode: c.anchorColorCode,
          }
        : null;
    case 'candidate.seedKeyword':
      return c.rakutenQuery;
    default:
      return null;
  }
}

/** 단계 하나의 가짜 실행기 */
export class FakeStepRunner implements StepRunner {
  readonly usesAi: boolean;

  constructor(
    readonly stepCode: StepCode,
    protected readonly world: FakeStepWorld,
  ) {
    this.usesAi = AI_STEPS.includes(stepCode);
  }

  readInputs(ctx: StepInputContext): Promise<StepInput[]> {
    const candidateId = ctx.candidate.id;
    return Promise.resolve(
      STEP_INPUT_SPECS[this.stepCode].map((spec): StepInput =>
        this.inputOf(ctx, candidateId, spec),
      ),
    );
  }

  private inputOf(ctx: StepInputContext, candidateId: number, spec: StepInputSpec): StepInput {
    const base = {
      inputKey: spec.inputKey,
      isStartCondition: spec.isStartCondition,
      required: spec.required,
    };
    switch (spec.source) {
      case 'PREV_STEP': {
        const runId = ctx.completedRunId(spec.sourceStepCode!);
        const value =
          runId !== null ? (this.world.outputs.get(runId)?.[spec.inputKey] ?? null) : null;
        return { ...base, sourceType: 'PREV_STEP', sourceStepRunId: runId, value };
      }
      case 'CANDIDATE': {
        const value = candidateValue(ctx, spec.inputKey);
        if (spec.inputKey === 'candidate.gender' && ctx.candidate.genderSource === 'STEP2') {
          const runId = ctx.completedRunId('SOURCING');
          if (runId !== null) {
            return { ...base, sourceType: 'PREV_STEP', sourceStepRunId: runId, value };
          }
        }
        return { ...base, sourceType: 'OWNER_INPUT', value };
      }
      case 'SETTINGS':
        return {
          ...base,
          sourceType: 'SETTINGS',
          value: readSettingsPath(ctx.settings, settingsPathOf(spec.inputKey)!) ?? null,
        };
      case 'OWNER_INPUT':
        return {
          ...base,
          sourceType: 'OWNER_INPUT',
          value: this.world.get(candidateId, spec.inputKey) ?? null,
        };
    }
  }

  run(ctx: StepRunContext): Promise<StepOutcome> {
    return this.play(ctx, false);
  }

  /** ② 재조회 모드(P1-06). 대본은 `run`과 같다 */
  refetch(ctx: StepRunContext): Promise<StepOutcome> {
    return this.play(ctx, true);
  }

  /** ③ 판정에 쓴 페이지 수집 시각(P1-06 6시간 규칙) */
  judgementPageCollectedAt(_db: Tx, stepRunId: number): Promise<Date | null> {
    return Promise.resolve(this.world.judgementPageAt.get(stepRunId) ?? null);
  }

  private async play(ctx: StepRunContext, refetch: boolean): Promise<StepOutcome> {
    this.world.calls.push({ stepCode: this.stepCode, ctx, refetch });
    let script = this.world.nextScript(this.stepCode);
    while (script.kind === 'HOLD') {
      const held = this.world.hold(this.stepCode);
      await script.onHold?.();
      await held;
      script = script.then ?? { kind: 'COMPLETE' };
    }
    const ownerInputs: Record<string, unknown> = {};
    for (const spec of STEP_INPUT_SPECS[this.stepCode]) {
      if (spec.source === 'OWNER_INPUT' && !spec.isStartCondition) {
        ownerInputs[spec.inputKey] = this.world.get(ctx.candidateId, spec.inputKey) ?? null;
      }
    }
    const anchorValue = this.world.get(ctx.candidateId, 'fake.anchor') as
      AnchorKeyInput | undefined;
    const pageAt =
      this.stepCode === 'PRICING'
        ? (this.world.get(ctx.candidateId, JUDGEMENT_PAGE_AT) as Date | undefined)
        : undefined;
    this.world.rememberRun(ctx.stepRunId, ownerInputs, anchorValue, pageAt);
    switch (script.kind) {
      case 'THROW':
        throw script.error;
      case 'WAIT':
        return {
          kind: 'WAITING_INPUT',
          waitingReasonCode: script.waitingReasonCode ?? 'FAKE_WAIT',
          pendingInputs: script.pendingInputs ?? [],
        };
      case 'FAIL':
        return {
          kind: 'FAILED',
          failureKind: script.failureKind ?? 'EXTERNAL_API',
          errorCode: script.errorCode ?? 'FAKE_FAILED',
          errorMessage: script.errorMessage ?? '가짜 실행기가 실패했습니다.',
        };
      case 'COMPLETE': {
        const output: Record<string, unknown> = {};
        for (const key of outputKeysOf(this.stepCode)) {
          output[key] = this.world.get(ctx.candidateId, key) ?? `${key}@1`;
        }
        const fetchedAt = this.world.get(ctx.candidateId, PAGE_FETCHED_AT);
        if (this.stepCode === 'SOURCING' && fetchedAt) {
          this.world.set(ctx.candidateId, JUDGEMENT_PAGE_AT, fetchedAt);
        }
        return { kind: 'COMPLETED', output, candidateEffects: script.candidateEffects };
      }
    }
  }

  persist(_tx: Tx, stepRunId: number, outcome: StepOutcome): Promise<void> {
    this.world.commitRun(
      stepRunId,
      outcome.kind === 'COMPLETED' ? (outcome.output as Record<string, unknown>) : null,
    );
    return Promise.resolve();
  }

  copyOutput(_tx: Tx, fromStepRunId: number, toStepRunId: number): Promise<void> {
    const output = this.world.outputs.get(fromStepRunId);
    if (output) this.world.outputs.set(toStepRunId, { ...output });
    const owner = this.world.ownerInputsByRun.get(fromStepRunId);
    if (owner) this.world.ownerInputsByRun.set(toStepRunId, { ...owner });
    const anchor = this.world.anchors.get(fromStepRunId);
    if (anchor) this.world.anchors.set(toStepRunId, anchor);
    const pageAt = this.world.judgementPageAt.get(fromStepRunId);
    if (pageAt) this.world.judgementPageAt.set(toStepRunId, pageAt);
    return Promise.resolve();
  }

  ownerInputsOf(_db: Tx, stepRunId: number): Promise<Record<string, unknown>> {
    return Promise.resolve({ ...(this.world.ownerInputsByRun.get(stepRunId) ?? {}) });
  }

  anchorKeyOf(_db: Tx, stepRunId: number): Promise<AnchorKeyInput | null> {
    return Promise.resolve(
      this.stepCode === 'SOURCING' ? (this.world.anchors.get(stepRunId) ?? null) : null,
    );
  }
}

/** ⑨ 가짜: 재시작 훅(onInterrupted)만 쓴다(P4-03 흉내). 단계 실행 API는 REGISTER를 422로 막는다 */
export class FakeRegisterRunner extends FakeStepRunner {
  constructor(@Inject(FakeStepWorld) world: FakeStepWorld) {
    super('REGISTER', world);
  }

  onInterrupted(_tx: Tx, run: StepRunRow): Promise<CandidateStatusEffect | null> {
    this.world.interruptedRuns.push(run.id);
    return Promise.resolve(this.world.registerInterruptEffect);
  }
}
