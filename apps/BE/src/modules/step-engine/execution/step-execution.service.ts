import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type { Candidate, CandidateStep, StepRun } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { isAiExecutionError } from '../../integrations/ai-engine/ai-engine.errors.js';
import type { PinnedAiContext } from '../../integrations/ai-engine/ai-executor.types.js';
import { SettingsService } from '../../settings/settings.service.js';
import type { AppSettings } from '../../settings/schema/settings.types.js';
import { CandidateGenderService } from '../candidates/candidate-gender.service.js';
import { CandidateGuardService } from '../candidates/candidate-guard.service.js';
import {
  CandidateIdentityService,
  isActiveItemColorViolation,
} from '../candidates/candidate-identity.service.js';
import { CandidateStatusService } from '../candidates/candidate-status.service.js';
import {
  StepEngineTransactions,
  type Db,
  type StepEngineTx,
} from '../candidates/step-engine-tx.js';
import type {
  AiEngineFix,
  CandidateEffects,
  OwnerEditRunInput,
  StepOutcome,
  StepRunContext,
  StepRunner,
} from '../contracts/step-runner.js';
import { changedInputKeys, fingerprint, NULL_VALUE_HASH } from '../domain/fingerprint.js';
import { endTimeFor, waitedSeconds } from '../domain/run-time.js';
import type { StepCode, StepStatus } from '../domain/steps.js';
import type { CandidateWarning } from '../domain/warnings.js';
import {
  AI_ENGINE_RESOLVER,
  type AiEnginePreparation,
  type AiEngineResolver,
} from '../ports/ai-engine-resolver.port.js';
import { GATE_VALIDITY, toGateFlags, type GateValidityPort } from '../ports/gate-validity.port.js';
import { PropagationService } from '../propagation/propagation.service.js';
import { StepRunnerRegistry } from '../runner/step-runner.registry.js';
import { pinAiEngine, pinnedAiFromRun, type PinnedAi } from './ai-engine-pin.js';
import { asStartCandidate, missingRequiredInputs } from './start-conditions.js';
import { checkStepRunnable, toApiException } from './step-blocks.js';
import { publishAfterCommit } from './step-events.js';
import { StepExecutor } from './step-executor.js';
import { resumeLockBlock } from './step-locks.js';
import {
  hashesOf,
  inputContextOf,
  inputRowsOf,
  insertInputRows,
  isOneOpenRunViolation,
  loadInputRows,
  loadStepRows,
  nextVersion,
  previousCompletedRun,
  readResolvedInputs,
  stepStatusMapOf,
  type ResolvedInput,
} from './step-run-store.js';
import { stepWarnings } from './step-warnings.js';

/** 실행 방식(M1: STEP·CHAIN·OWNER_EDIT, 규칙 1) */
export type StartMode = 'STEP' | 'CHAIN';

/** 단계 실행 요청(단일 진입점, 규칙 1) */
export interface StartStepOptions {
  /** STEP(단계 실행) · CHAIN(연속 실행, P1-06 — stepChainId 필수). 일괄(M2)·CLI(M3)도 이 진입점을 부른다 */
  mode?: StartMode;
  /** 실행 중 오너 입력(05-2 StepRunOwnerInputs). 지문에서 뺀다 */
  ownerInputs?: Readonly<Record<string, unknown>>;
  stepChainId?: number | null;
  /** ⑥ 묶음: stepCode=COPY + throughStepCode=NOTICE_HTML이면 COPY → NOTICE_RAW → NOTICE_HTML(규칙 14) */
  throughStepCode?: 'NOTICE_HTML' | null;
}

/** 연속 실행 묶음 안의 실행이 끝났다(입력 대기·완료·실패·재실행 필요로 닫힘, P1-06). 연속 실행 서비스가 다음 행동을 정한다 */
export type ChainRunSettledListener = (input: {
  stepChainId: number;
  stepRunId: number;
  candidateId: number;
}) => Promise<void>;

export interface StartStepResult {
  run: StepRun;
  /** 이번 요청으로 곧바로 만든 실행(⑥ 묶음도 첫 실행만) */
  stepRunIds: number[];
  warnings: CandidateWarning[];
}

/** 시작 트랜잭션에 넘기는 것 */
interface StartInput {
  runner: StepRunner;
  mode: StartMode;
  stepChainId: number | null;
  ownerInputs: Readonly<Record<string, unknown>>;
  chainRemaining: StepCode[];
  refetch: boolean;
}

/** 단계별 실행 중 오너 입력 칸(05-2 StepRunOwnerInputs, 표 A). 단계에 맞지 않는 칸은 422 VALIDATION_FAILED */
export const OWNER_INPUT_FIELDS: Readonly<Partial<Record<StepCode, readonly string[]>>> = {
  SOURCING: ['searchKeyword'],
  PRICING: ['couponYen'],
  THUMBNAIL: ['faceOption', 'promptAdjustment'],
};

/** ⑥ 묶음 순서 */
export const CONTENT_CHAIN: readonly StepCode[] = ['COPY', 'NOTICE_RAW', 'NOTICE_HTML'];

/** 실행 중 앱 오류(실행기 예외)를 남길 때 쓰는 코드·문구(비밀정보·경로 없음, P1-05 Proposed) */
export const INTERNAL_FAILURE = {
  errorCode: 'INTERNAL_ERROR',
  errorMessage: '실행 중 앱 오류가 났습니다. 다시 실행해 보고, 계속되면 앱 로그를 확인해 주세요.',
} as const;

/** 외부 호출 관문이 던지는 코드(→ failure_kind EXTERNAL_API) */
const EXTERNAL_ERROR_CODES = new Set([
  'EXTERNAL_API_ERROR',
  'DAILY_LIMIT_REACHED',
  'EXTERNAL_CALL_COOLDOWN',
  'EXTERNAL_REQUEST_NOT_ALLOWED',
]);

/** 대기열에서 돌릴 실행 한 건 */
interface PreparedRun {
  run: StepRun;
  runner: StepRunner;
  settings: Readonly<AppSettings>;
  inputs: ResolvedInput[];
  ownerInputs: Readonly<Record<string, unknown>>;
  previous: StepRunContext['previous'];
  resume: StepRunContext['resume'];
  ownerEdit: OwnerEditRunInput | null;
  aiEngine: AiEngineFix | null;
  /** AI 실행 문맥(엔진·모델 고정, P1-10). stepRunId·candidateId는 실행할 때 채운다 */
  pinnedAi: PinnedAiContext | null;
  /** ⑥ 묶음에서 이 실행 뒤에 이어 갈 단계 */
  chainRemaining: StepCode[];
  /** 6시간 규칙의 ② 재조회(실행기 `refetch`가 있으면 그것을, 없으면 `run`을 부른다, P1-06) */
  refetch: boolean;
}

/** 새 실행 행을 여는 데 필요한 값 */
export interface OpenRunSpec {
  candidate: Candidate;
  stepCode: StepCode;
  runner: StepRunner;
  rows: CandidateStep[];
  executionMode: 'STEP' | 'CHAIN' | 'OWNER_EDIT';
  stepChainId?: number | null;
  ownerAction?: 'EDIT' | null;
  baseStepRunId?: number | null;
  settingsSnapshotId: number;
  aiEngine: AiEngineFix | null;
  /** 새 실행이 읽은 입력(시작 지문의 근거). 주지 않고 `copyInputsFrom`을 주면 그 실행의 입력 행을 복사한다 */
  inputs?: ResolvedInput[];
  copyInputsFrom?: StepRun;
}

function toFailure(error: unknown): Extract<StepOutcome, { kind: 'FAILED' }> {
  // AI 실행 오류(P1-10 규칙 8·12·14): 엔진 사용 불가 → AI·AI_ENGINE_UNAVAILABLE, 결과 불신·호출 실패 → AI·AI_* 코드,
  // 입력 차단 → INPUT_VALIDATION·AI_INPUT_BLOCKED. 다른 엔진으로 다시 부르지 않는다
  if (isAiExecutionError(error)) {
    return {
      kind: 'FAILED',
      failureKind: error.failureKind,
      errorCode: error.errorCode,
      errorMessage: error.userMessage,
    };
  }
  if (error instanceof ApiException) {
    const failureKind = EXTERNAL_ERROR_CODES.has(error.code)
      ? 'EXTERNAL_API'
      : error.code.startsWith('AI_')
        ? 'AI'
        : 'INPUT_VALIDATION';
    return { kind: 'FAILED', failureKind, errorCode: error.code, errorMessage: error.message };
  }
  return { kind: 'FAILED', failureKind: 'INPUT_VALIDATION', ...INTERNAL_FAILURE };
}

/** 실행기가 준 결과가 규약에 맞는지(아니면 앱 오류로 FAILED) */
function checkOutcome(outcome: unknown): StepOutcome {
  const o = outcome as Partial<StepOutcome> | null;
  if (!o || typeof o !== 'object') throw new Error('실행 결과가 없습니다');
  if (o.kind === 'COMPLETED') return o as StepOutcome;
  if (o.kind === 'WAITING_INPUT') {
    const w = o as Extract<StepOutcome, { kind: 'WAITING_INPUT' }>;
    if (typeof w.waitingReasonCode !== 'string' || !Array.isArray(w.pendingInputs)) {
      throw new Error('입력 대기 결과 모양이 맞지 않습니다');
    }
    return w;
  }
  if (o.kind === 'FAILED') {
    const f = o as Extract<StepOutcome, { kind: 'FAILED' }>;
    if (!['EXTERNAL_API', 'AI', 'INPUT_VALIDATION'].includes(f.failureKind)) {
      throw new Error('실패 종류가 맞지 않습니다');
    }
    return {
      kind: 'FAILED',
      failureKind: f.failureKind,
      errorCode: String(f.errorCode || 'STEP_FAILED').slice(0, 100),
      errorMessage: String(f.errorMessage || '단계를 실행하지 못했습니다.'),
    };
  }
  throw new Error('알 수 없는 실행 결과입니다');
}

/**
 * 단계 실행 엔진(F-BS-15·17·19·20·22, 규칙 1~5·13·14). 단계 실행·연속 실행(P1-06)·일괄(M2)·CLI(M3)는 모두 `start` 하나를 부른다.
 * - 시작 트랜잭션: 검사 → 입력·지문 → version +1(UPDATE … RETURNING) → step_run(RUNNING) + step_run_input + 포인터 이동
 *   (+ 후보 상태 재평가). 커밋 뒤 SSE와 대기열(StepExecutor).
 * - 실행: `runner.run`(트랜잭션 밖).
 * - 끝 트랜잭션: 산출물 + step_run 종료 + 끝 지문 비교 + candidate_step + 후보 효과 + 뒷단계 전파 + 후보 상태 재평가.
 *   실행 중 실패는 HTTP 오류가 아니라 실행 기록과 SSE로 알린다.
 */
@Injectable()
export class StepExecutionService {
  private readonly logger = new Logger(StepExecutionService.name);
  private chainListener: ChainRunSettledListener | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly status: CandidateStatusService,
    private readonly identity: CandidateIdentityService,
    private readonly gender: CandidateGenderService,
    private readonly settings: SettingsService,
    private readonly registry: StepRunnerRegistry,
    private readonly executor: StepExecutor,
    private readonly propagation: PropagationService,
    private readonly events: ProgressEventsService,
    @Inject(GATE_VALIDITY) private readonly gateValidity: GateValidityPort,
    @Inject(AI_ENGINE_RESOLVER) private readonly aiResolver: AiEngineResolver,
  ) {}

  // ── 시작 ────────────────────────────────────────────────────────────────

  /** 연속 실행 묶음 이어 가기 훅(P1-06 ContinuousRunService가 onModuleInit에서 끼운다) */
  onChainRunSettled(listener: ChainRunSettledListener): void {
    this.chainListener = listener;
  }

  /** 단일 진입점(규칙 1). 다음 단계를 자동으로 시작하지 않는다(⑥ 묶음만 예외) */
  async start(
    candidateId: number,
    stepCode: StepCode,
    options: StartStepOptions = {},
  ): Promise<StartStepResult> {
    const mode = options.mode ?? 'STEP';
    const runner = this.assertRunnableCode(stepCode);
    const ownerInputs = this.checkedOwnerInputs(stepCode, options.ownerInputs ?? {});
    if (options.throughStepCode != null && stepCode !== 'COPY') {
      throw new ApiException('VALIDATION_FAILED', {
        fieldErrors: [
          {
            field: 'throughStepCode',
            message: 'throughStepCode는 stepCode=COPY일 때만 줄 수 있습니다.',
            rejectedValue: options.throughStepCode,
          },
        ],
      });
    }
    if ((mode === 'CHAIN') !== (options.stepChainId != null)) {
      throw new Error(
        '연속 실행(CHAIN)에는 stepChainId가, 그 밖에는 없어야 합니다(ck_step_run_chain)',
      );
    }
    const chainRemaining = options.throughStepCode === 'NOTICE_HTML' ? CONTENT_CHAIN.slice(1) : [];

    await this.guard.findOr404(this.prisma, candidateId);
    return this.startInternal(candidateId, stepCode, {
      runner,
      mode,
      stepChainId: options.stepChainId ?? null,
      ownerInputs,
      chainRemaining,
      refetch: false,
    });
  }

  /**
   * ② 재조회(05-2 refetchCandidate, P2-02 규칙 15, PRD §5.3 '② 소싱의 세 동작'): SOURCING 새 버전을 재조회 모드(실행기
   * `refetch` — 고른 상품 페이지 1건만 새로 읽음)로 연다. ③을 실행한 적이 있으면(버전이 하나라도 있으면) ②가 끝난 뒤
   * ③을 지문과 관계없이 이어서 시작한다(execution_mode=STEP — 05-2 x-decision §7.2-15, ⑥ 묶음과 같은 이어 가기).
   * ②가 실패·입력 대기로 끝나면 ③은 시작 조건에 걸려 시작하지 않는다. 막힌 이유는 실행 API와 같다(실행기 `beforeStart`의
   * 409 SOURCING_SELECTION_REQUIRED·DAILY_LIMIT_REACHED·EXTERNAL_CALL_COOLDOWN 포함).
   */
  async startRefetch(candidateId: number): Promise<StartStepResult> {
    const runner = this.assertRunnableCode('SOURCING');
    await this.guard.findOr404(this.prisma, candidateId);
    const pricingRuns = await this.prisma.stepRun.count({
      where: { candidateId, stepCode: 'PRICING' },
    });
    return this.startInternal(candidateId, 'SOURCING', {
      runner,
      mode: 'STEP',
      stepChainId: null,
      ownerInputs: {},
      chainRemaining: pricingRuns > 0 ? ['PRICING'] : [],
      refetch: true,
    });
  }

  /**
   * 호출자 트랜잭션 안에서 단계 버전 하나를 열고(`openRun`) 곧바로 결과로 닫는다(`closeRun`) — 외부 호출 없이 결과를 정할 수
   * 있는 경우만(P2-02: 'URL로 만들기' 후보의 ② URL_CREATE 버전을 후보 만들기와 같은 트랜잭션에 쓴다, 05-2 createCandidate).
   * 시작 조건·잠금 검사는 실행 API와 같다. AI 단계여도 이 결과는 AI를 부르지 않으므로 엔진을 고정하지 않는다(ai_* NULL —
   * P2-03 Proposed: ② SOURCING이 AI 단계가 되어 'URL로 만들기'가 이것을 쓴다. AI를 불러야 하면 `start`를 쓴다).
   */
  async recordInlineRun(
    scope: StepEngineTx,
    candidateId: number,
    stepCode: StepCode,
    outcomeFor: (run: StepRun) => Promise<StepOutcome>,
  ): Promise<StepRun> {
    const runner = this.assertRunnableCode(stepCode);
    const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
    const rows = await loadStepRows(scope.tx, candidateId);
    const steps = stepStatusMapOf(rows);
    const gates = toGateFlags(await this.gateValidity.evaluate(scope.tx, candidateId));
    const block = checkStepRunnable(stepCode, asStartCandidate(candidate), steps, gates, {
      mode: 'run',
      hasRunner: true,
      settingsLoaded: this.settings.currentOrNull() !== null,
    });
    if (block) throw toApiException(block);
    const settings = this.settings.current();
    const inputs = await readResolvedInputs(
      runner,
      inputContextOf(scope.tx, candidate, settings, rows),
    );
    const missing = missingRequiredInputs(inputs);
    if (missing.length > 0) {
      throw toApiException({
        code: 'STEP_START_CONDITION_UNMET',
        stepCode,
        missingInputs: missing,
      });
    }
    const run = await this.openRun(scope, {
      candidate,
      stepCode,
      runner,
      rows,
      executionMode: 'STEP',
      stepChainId: null,
      settingsSnapshotId: this.settings.currentSnapshotId(),
      aiEngine: null,
      inputs,
    });
    await this.status.reevaluate(scope, candidateId, { stepRunId: run.id });
    const outcome = checkOutcome(await outcomeFor(run));
    return this.closeRun(scope, run, runner, outcome);
  }

  /**
   * 호출자 트랜잭션 안에서 완료된 현재 버전을 바탕으로 오너 수정(EDIT) 새 버전을 열고(`openRun` — 바탕 버전의 입력 행·시작
   * 지문을 복사, P1-05 Proposed 오너 수정 규칙) 곧바로 결과로 닫는다(`closeRun` — 산출물 `persist`가 **닫기 전에** 돈다, 끝 지문이
   * 다르면 RERUN_REQUIRED, 뒷단계 전파·후보 재평가·게이트 무효 감지·커밋 뒤 SSE). P3-02: ⑤ 완료 뒤 G3을 다시 고르는 경우
   * (05-2 x-decision §7.4-31 — 새 선택을 새 버전에 쓴다). 후보 행은 이미 잠겨 있어야 한다. 바탕 버전이 이 후보·단계의 현재
   * 버전이 아니면 409 VERSION_NOT_CURRENT, 완료가 아니면 409 STEP_NOT_COMPLETED. `ai_*`는 바탕 버전 값을 이어 쓴다.
   */
  async recordOwnerEditRun(
    scope: StepEngineTx,
    candidateId: number,
    stepCode: StepCode,
    baseStepRunId: number,
    outcomeFor: (run: StepRun) => Promise<StepOutcome>,
  ): Promise<StepRun> {
    const runner = this.assertRunnableCode(stepCode);
    const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
    const rows = await loadStepRows(scope.tx, candidateId);
    const row = rows.find((r) => r.stepCode === stepCode);
    const base = await scope.tx.stepRun.findUnique({ where: { id: baseStepRunId } });
    if (!base || base.candidateId !== candidateId || base.stepCode !== stepCode) {
      throw new ApiException('STEP_RUN_NOT_FOUND', { details: { baseStepRunId } });
    }
    if (!row || row.currentStepRunId !== base.id) {
      throw new ApiException('VERSION_NOT_CURRENT', {
        details: { stepCode, currentStepRunId: row?.currentStepRunId ?? null },
      });
    }
    if (base.status !== 'COMPLETED') {
      throw toApiException({
        code: 'STEP_NOT_COMPLETED',
        stepCode,
        status: base.status as StepStatus,
      });
    }
    const run = await this.openRun(scope, {
      candidate,
      stepCode,
      runner,
      rows,
      executionMode: 'OWNER_EDIT',
      ownerAction: 'EDIT',
      baseStepRunId: base.id,
      settingsSnapshotId: this.settings.currentSnapshotId(),
      aiEngine:
        base.aiEngine && base.aiModel
          ? {
              aiEngine: base.aiEngine as AiEngineFix['aiEngine'],
              aiModel: base.aiModel,
              aiCliVersion: base.aiCliVersion,
            }
          : null,
      copyInputsFrom: base,
    });
    await this.status.reevaluate(scope, candidateId, { stepRunId: run.id });
    const outcome = checkOutcome(await outcomeFor(run));
    return this.closeRun(scope, run, runner, outcome);
  }

  /** 단계 코드가 실행할 수 있는 코드인지(REGISTER·실행기 없음 → 422 INVALID_STEP_CODE) */
  assertRunnableCode(stepCode: StepCode): StepRunner {
    if (stepCode === 'REGISTER') {
      throw toApiException({ code: 'INVALID_STEP_CODE', stepCode, reason: 'NOT_RUNNABLE' });
    }
    const runner = this.registry.get(stepCode);
    if (!runner) throw toApiException({ code: 'INVALID_STEP_CODE', stepCode, reason: 'NO_RUNNER' });
    return runner;
  }

  /** 실행 중 오너 입력 칸이 이 단계 것인지 */
  private checkedOwnerInputs(
    stepCode: StepCode,
    ownerInputs: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> {
    const allowed = OWNER_INPUT_FIELDS[stepCode] ?? [];
    const fieldErrors = Object.keys(ownerInputs)
      .filter((key) => ownerInputs[key] !== undefined && !allowed.includes(key))
      .map((key) => ({
        field: `ownerInputs.${key}`,
        message: '이 단계에서는 받지 않는 입력입니다.',
        rejectedValue: ownerInputs[key],
      }));
    if (fieldErrors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors });
    return Object.fromEntries(Object.entries(ownerInputs).filter(([, v]) => v !== undefined));
  }

  /** 직전 완료 버전과 그 버전의 실행 중 오너 입력(다시 실행 기본값, 규칙 7·11) */
  private async previousOf(
    scope: StepEngineTx,
    runner: StepRunner,
    candidateId: number,
    stepCode: StepCode,
  ): Promise<StepRunContext['previous']> {
    const prev = await previousCompletedRun(scope.tx, candidateId, stepCode);
    if (!prev) return null;
    const ownerInputs = runner.ownerInputsOf ? await runner.ownerInputsOf(scope.tx, prev.id) : {};
    return { stepRunId: prev.id, ownerInputs };
  }

  /**
   * 새 실행 행(RUNNING)을 연다(규칙 3): version +1 → step_run + step_run_input + candidate_step 포인터·RUNNING·사유 비움.
   * 호출자가 후보 행을 잠근 트랜잭션 안에서 부른다. 커밋 뒤 SSE.
   */
  async openRun(scope: StepEngineTx, spec: OpenRunSpec): Promise<StepRun> {
    const { candidate, stepCode } = spec;
    const version = await nextVersion(scope.tx, candidate.id, stepCode);
    const copied = spec.copyInputsFrom
      ? await loadInputRows(scope.tx, spec.copyInputsFrom.id)
      : null;
    const startHashes = copied ? hashesOf(copied) : hashesOf(spec.inputs ?? []);
    const run = await scope.tx.stepRun.create({
      data: {
        candidateId: candidate.id,
        stepCode,
        version,
        executionMode: spec.executionMode,
        ownerAction: spec.ownerAction ?? null,
        baseStepRunId: spec.baseStepRunId ?? null,
        stepChainId: spec.stepChainId ?? null,
        settingsSnapshotId: spec.settingsSnapshotId,
        aiEngine: spec.aiEngine?.aiEngine ?? null,
        aiModel: spec.aiEngine?.aiModel ?? null,
        aiCliVersion: spec.aiEngine?.aiCliVersion ?? null,
        status: 'RUNNING',
        inputFingerprintStart: copied
          ? (spec.copyInputsFrom?.inputFingerprintStart ?? fingerprint(startHashes))
          : fingerprint(startHashes),
        startedAt: scope.now,
      },
    });
    if (copied) {
      if (copied.length > 0) {
        await scope.tx.stepRunInput.createMany({
          data: copied.map((row) => ({
            stepRunId: run.id,
            inputKey: row.inputKey,
            sourceType: row.sourceType,
            sourceStepRunId: row.sourceStepRunId,
            isStartCondition: row.isStartCondition,
            valueHash: row.valueHash,
          })),
        });
      }
    } else {
      await insertInputRows(scope.tx, run.id, spec.inputs ?? []);
    }
    const stepRow = await scope.tx.candidateStep.update({
      where: { candidateId_stepCode: { candidateId: candidate.id, stepCode } },
      data: { currentStepRunId: run.id, status: 'RUNNING', staleInputs: [], staleSince: null },
    });
    publishAfterCommit(scope, this.events, { run: { row: run }, steps: [stepRow] });
    return run;
  }

  /** 커밋 뒤 대기열에 넣는다 */
  private submitAfterCommit(scope: StepEngineTx, prepared: PreparedRun): void {
    scope.afterCommit(() =>
      this.executor.submit(
        () => this.execute(prepared),
        `${prepared.run.stepCode}#${prepared.run.id}`,
      ),
    );
  }

  /** 비동기 오너 수정 실행(⑦ 태그 편집, 202)을 대기열에 넣는다(owner-edit 서비스가 openRun 뒤 부른다) */
  submitOwnerEditRun(
    scope: StepEngineTx,
    input: {
      run: StepRun;
      runner: StepRunner;
      settings: Readonly<AppSettings>;
      inputs: ResolvedInput[];
      ownerEdit: OwnerEditRunInput;
    },
  ): void {
    this.submitAfterCommit(scope, {
      run: input.run,
      runner: input.runner,
      settings: input.settings,
      inputs: input.inputs,
      ownerInputs: {},
      previous: null,
      resume: null,
      ownerEdit: input.ownerEdit,
      aiEngine: null,
      pinnedAi: null,
      chainRemaining: [],
      refetch: false,
    });
  }

  // ── 실행 ────────────────────────────────────────────────────────────────

  private async execute(prepared: PreparedRun): Promise<void> {
    const { run, runner } = prepared;
    const ctx: StepRunContext = {
      stepRunId: run.id,
      candidateId: run.candidateId,
      stepCode: run.stepCode as StepCode,
      version: run.version,
      executionMode: run.executionMode as StepRunContext['executionMode'],
      stepChainId: run.stepChainId,
      settingsSnapshotId: run.settingsSnapshotId,
      settings: prepared.settings,
      inputs: prepared.inputs,
      ownerInputs: prepared.ownerInputs,
      previous: prepared.previous,
      resume: prepared.resume,
      ownerEdit: prepared.ownerEdit,
      aiEngine: prepared.aiEngine,
      pinnedAi: prepared.pinnedAi
        ? { ...prepared.pinnedAi, stepRunId: run.id, candidateId: run.candidateId }
        : null,
    };
    let outcome: StepOutcome;
    try {
      const result = prepared.refetch && runner.refetch ? runner.refetch(ctx) : runner.run(ctx);
      outcome = checkOutcome(await result);
    } catch (error) {
      if (!(error instanceof ApiException)) {
        this.logger.error({ err: error }, `실행기 예외(${run.stepCode}#${run.id})`);
      }
      outcome = toFailure(error);
    }
    await this.finish(run.id, outcome);
    if (prepared.chainRemaining.length > 0) {
      await this.continueChain(run.candidateId, prepared.chainRemaining);
    }
    if (run.stepChainId !== null && this.chainListener) {
      try {
        await this.chainListener({
          stepChainId: run.stepChainId,
          stepRunId: run.id,
          candidateId: run.candidateId,
        });
      } catch (error) {
        this.logger.error({ err: error }, `연속 실행 #${run.stepChainId}을 이어 가지 못했습니다`);
      }
    }
  }

  /**
   * ⑥ 묶음 이어 가기(규칙 14, P1-05 Proposed): 다음 단계를 차례로 시작한다. 시작 조건·잠금에 걸리는 단계는 건너뛰고
   * (예: ⑥-1이 실패하면 ⑥-2는 돌고 ⑥-3은 시작하지 않는다), 입력 대기·실패로 멈춘 단계를 읽지 않는 단계는 계속한다.
   */
  private async continueChain(candidateId: number, remaining: readonly StepCode[]): Promise<void> {
    const queue = [...remaining];
    while (queue.length > 0) {
      const next = queue.shift()!;
      try {
        await this.startChainStep(candidateId, next, queue);
        return;
      } catch (error) {
        const reason = error instanceof ApiException ? error.code : String(error);
        this.logger.log(`⑥ 묶음: ${next}를 시작하지 않고 건너뜁니다(${reason})`);
      }
    }
  }

  private startChainStep(
    candidateId: number,
    stepCode: StepCode,
    rest: readonly StepCode[],
  ): Promise<StartStepResult> {
    return this.startInternal(candidateId, stepCode, {
      runner: this.assertRunnableCode(stepCode),
      mode: 'STEP',
      stepChainId: null,
      ownerInputs: {},
      chainRemaining: [...rest],
      refetch: false,
    });
  }

  /**
   * 시작 트랜잭션(규칙 2·3): 후보 잠금 → 시작 조건·잠금 검사(레일과 같은 함수) → 입력·지문 → 새 실행 → 후보 상태 재평가.
   * 커밋 뒤 SSE와 대기열. 동시 요청이 uq_step_run_one_open에 걸리면 409 STEP_ALREADY_RUNNING.
   */
  private async startInternal(
    candidateId: number,
    stepCode: StepCode,
    input: StartInput,
  ): Promise<StartStepResult> {
    // AI 단계(P1-10 규칙 10·11): 사용 가능 판정과 --version 감지는 시작 트랜잭션 **전에** 끝낸다(spawn을 트랜잭션에 넣지
    // 않는다). 쓸 수 없음(409)은 트랜잭션 안에서 잠금·시작 조건 검사 **뒤에** 던진다(다른 막힌 이유가 먼저 보이게)
    const ai = input.runner.usesAi ? await this.prepareAiSoft() : undefined;
    try {
      return await this.transactions.run((scope) =>
        this.openInScope(scope, candidateId, stepCode, input, ai),
      );
    } catch (error) {
      if (isOneOpenRunViolation(error)) {
        throw toApiException({ code: 'STEP_ALREADY_RUNNING', stepCode, status: 'RUNNING' });
      }
      throw error;
    }
  }

  /**
   * 연속 실행 묶음 안의 실행 시작(P1-06): 호출자(연속 실행 서비스)의 트랜잭션 안에서 `execution_mode=CHAIN` +
   * `step_chain_id`로 새 실행을 연다(묶음 행과 같은 트랜잭션 — 첫 실행이 막히면 묶음도 남지 않는다). AI 단계는 이 단계가
   * 시작할 때의 선택 엔진을 고정한다(P1-10). 호출자가 트랜잭션 **전에** 준비한 결과(`options.ai`)를 쓴다 — 쓸 수 없음이면
   * 그 오류(409 AI_ENGINE_UNAVAILABLE)를 던진다. 준비하지 않았으면(드문 경합) 여기서 준비한다. `refetch`면 실행기 `refetch`.
   * 호출자가 후보 행을 잠근다. uq_step_run_one_open 위반은 호출자가 409로 바꾼다.
   */
  async startChainRun(
    scope: StepEngineTx,
    candidateId: number,
    stepCode: StepCode,
    options: { stepChainId: number; refetch?: boolean; ai?: AiEnginePreparation },
  ): Promise<StartStepResult> {
    const runner = this.assertRunnableCode(stepCode);
    return this.openInScope(
      scope,
      candidateId,
      stepCode,
      {
        runner,
        mode: 'CHAIN',
        stepChainId: options.stepChainId,
        ownerInputs: {},
        chainRemaining: [],
        refetch: options.refetch ?? false,
      },
      options.ai,
    );
  }

  /** 선택 엔진 준비(트랜잭션 밖). 쓸 수 없음은 던지지 않고 오류로 들고 간다 */
  private async prepareAiSoft(): Promise<AiEnginePreparation> {
    try {
      return { prepared: await this.aiResolver.prepare() };
    } catch (error) {
      return { error };
    }
  }

  /** 준비 결과를 이 단계에 고정한다(쓸 수 없음이면 그 오류를 던진다). 준비하지 않았으면(드문 경합) 여기서 준비한다 */
  private async pinFor(runner: StepRunner, ai: AiEnginePreparation | undefined): Promise<PinnedAi> {
    if (ai && 'error' in ai) throw ai.error;
    const prepared = ai?.prepared ?? (await this.aiResolver.prepare());
    return pinAiEngine(runner, prepared);
  }

  /** 시작 트랜잭션 본체(호출자 트랜잭션 안) */
  private async openInScope(
    scope: StepEngineTx,
    candidateId: number,
    stepCode: StepCode,
    input: StartInput,
    aiPreparation: AiEnginePreparation | undefined,
  ): Promise<StartStepResult> {
    const { runner } = input;
    const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
    const rows = await loadStepRows(scope.tx, candidateId);
    const steps = stepStatusMapOf(rows);
    const gates = toGateFlags(await this.gateValidity.evaluate(scope.tx, candidateId));
    const block = checkStepRunnable(stepCode, asStartCandidate(candidate), steps, gates, {
      mode: 'run',
      hasRunner: true,
      settingsLoaded: this.settings.currentOrNull() !== null,
    });
    if (block) throw toApiException(block);
    const settings = this.settings.current();
    // 시작 조건 행 준비(P2-05 Proposed): 실행 body의 오너 입력을 입력 지문 전에 시작 조건 행으로 넣는다(③ URL 후보 쿠폰)
    await runner.prepareInputs?.({
      db: scope.tx,
      candidate,
      settings,
      ownerInputs: input.ownerInputs,
      refetch: input.refetch,
      executionMode: input.mode,
    });
    const inputs = await readResolvedInputs(
      runner,
      inputContextOf(scope.tx, candidate, settings, rows),
    );
    const missing = missingRequiredInputs(inputs);
    if (missing.length > 0) {
      throw toApiException({
        code: 'STEP_START_CONDITION_UNMET',
        stepCode,
        missingInputs: missing,
      });
    }
    // 단계별 시작 전 검사(P2-02 Proposed): 던지면 step_run을 만들지 않고 그 오류가 응답이 된다
    await runner.beforeStart?.({
      db: scope.tx,
      candidate,
      settings,
      ownerInputs: input.ownerInputs,
      refetch: input.refetch,
      executionMode: input.mode,
    });
    // AI 엔진 고정(P1-10 규칙 10·11): 쓸 수 없으면 409 AI_ENGINE_UNAVAILABLE — step_run을 만들지 않는다
    const ai = runner.usesAi ? await this.pinFor(runner, aiPreparation) : null;
    const previous = await this.previousOf(scope, runner, candidateId, stepCode);
    const run = await this.openRun(scope, {
      candidate,
      stepCode,
      runner,
      rows,
      executionMode: input.mode,
      stepChainId: input.stepChainId,
      settingsSnapshotId: this.settings.currentSnapshotId(),
      aiEngine: ai?.fix ?? null,
      inputs,
    });
    await this.status.reevaluate(scope, candidateId, { stepRunId: run.id });
    this.submitAfterCommit(scope, {
      run,
      runner,
      settings,
      inputs,
      ownerInputs: input.ownerInputs,
      previous,
      resume: null,
      ownerEdit: null,
      aiEngine: ai?.fix ?? null,
      pinnedAi: ai?.context ?? null,
      chainRemaining: input.chainRemaining,
      refetch: input.refetch,
    });
    return { run, stepRunIds: [run.id], warnings: stepWarnings(stepCode, steps, gates) };
  }

  // ── 끝 ──────────────────────────────────────────────────────────────────

  /**
   * 실행을 끝낸다(새 트랜잭션). 끝 트랜잭션이 실패하면(후보 효과가 409 등) 실행을 FAILED(INPUT_VALIDATION)로 닫는다.
   * 이미 닫힌 실행이면 아무것도 하지 않는다.
   */
  async finish(stepRunId: number, outcome: StepOutcome): Promise<StepRun | null> {
    try {
      return await this.transactions.run((scope) => this.closeInScope(scope, stepRunId, outcome));
    } catch (error) {
      const failure: Extract<StepOutcome, { kind: 'FAILED' }> = isActiveItemColorViolation(error)
        ? {
            kind: 'FAILED',
            failureKind: 'INPUT_VALIDATION',
            errorCode: 'CANDIDATE_DUPLICATE',
            errorMessage: formatErrorMessage('CANDIDATE_DUPLICATE'),
          }
        : error instanceof ApiException
          ? {
              kind: 'FAILED',
              failureKind: 'INPUT_VALIDATION',
              errorCode: error.code,
              errorMessage: error.message,
            }
          : { kind: 'FAILED', failureKind: 'INPUT_VALIDATION', ...INTERNAL_FAILURE };
      if (!(error instanceof ApiException) && !isActiveItemColorViolation(error)) {
        this.logger.error({ err: error }, `실행 #${stepRunId}을 끝내지 못해 실패로 닫습니다`);
      }
      if (outcome.kind === 'FAILED') {
        this.logger.error({ err: error }, `실행 #${stepRunId}을 실패로도 닫지 못했습니다`);
        return null;
      }
      try {
        return await this.transactions.run((scope) => this.closeInScope(scope, stepRunId, failure));
      } catch (again) {
        this.logger.error({ err: again }, `실행 #${stepRunId}을 실패로도 닫지 못했습니다`);
        return null;
      }
    }
  }

  private async closeInScope(
    scope: StepEngineTx,
    stepRunId: number,
    outcome: StepOutcome,
  ): Promise<StepRun | null> {
    const found = await scope.tx.stepRun.findUnique({ where: { id: stepRunId } });
    if (!found) return null;
    await this.guard.lockForUpdate(scope.tx, found.candidateId);
    const run = await scope.tx.stepRun.findUniqueOrThrow({ where: { id: stepRunId } });
    if (run.status !== 'RUNNING') {
      this.logger.warn(`실행 #${stepRunId}이 이미 ${run.status}라 끝내지 않습니다`);
      return null;
    }
    const runner = this.registry.get(run.stepCode as StepCode);
    if (!runner) throw new Error(`실행기가 없습니다: ${run.stepCode}`);
    return this.closeRun(scope, run, runner, outcome);
  }

  /**
   * 끝 트랜잭션 본체(규칙 4·5). 열린 실행(RUNNING·WAITING_INPUT)을 결과로 닫거나 입력 대기로 둔다. 호출자가 후보 행을 잠근다.
   */
  async closeRun(
    scope: StepEngineTx,
    run: StepRun,
    runner: StepRunner,
    outcome: StepOutcome,
  ): Promise<StepRun> {
    const now = scope.now;
    const stepCode = run.stepCode as StepCode;
    const waitAdd = run.status === 'WAITING_INPUT' ? waitedSeconds(run.waitingSince, now) : 0;
    // 게이트 무효 감지(P1-06 규칙 9): 완료로 산출물·후보 값이 바뀌기 전 지문 상태
    const gatesBefore =
      outcome.kind === 'COMPLETED'
        ? await this.gateValidity.snapshot?.(scope.tx, run.candidateId)
        : undefined;
    await runner.persist(scope.tx, run.id, outcome, {
      afterCommit: (fn) => scope.afterCommit(fn),
    });
    const stepRow = await scope.tx.candidateStep.findUniqueOrThrow({
      where: { candidateId_stepCode: { candidateId: run.candidateId, stepCode } },
    });
    const isCurrent = stepRow.currentStepRunId === run.id;

    if (outcome.kind === 'WAITING_INPUT') {
      const updated = await scope.tx.stepRun.update({
        where: { id: run.id },
        data: {
          status: 'WAITING_INPUT',
          waitingSince: now,
          waitSecondsTotal: run.waitSecondsTotal + waitAdd,
        },
      });
      const row = isCurrent
        ? await scope.tx.candidateStep.update({
            where: { id: stepRow.id },
            data: { status: 'WAITING_INPUT', staleInputs: [], staleSince: null },
          })
        : null;
      await this.status.reevaluate(scope, run.candidateId, { stepRunId: run.id });
      publishAfterCommit(scope, this.events, {
        run: {
          row: updated,
          extra: {
            waitingReasonCode: outcome.waitingReasonCode,
            pendingInputs: outcome.pendingInputs,
          },
        },
        steps: row ? [row] : [],
      });
      return updated;
    }

    if (outcome.kind === 'FAILED') {
      const updated = await scope.tx.stepRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          failureKind: outcome.failureKind,
          errorCode: outcome.errorCode,
          errorMessage: outcome.errorMessage,
          waitSecondsTotal: run.waitSecondsTotal + waitAdd,
          waitingSince: null,
          endedAt: endTimeFor(run.startedAt, now),
        },
      });
      const row = isCurrent
        ? await scope.tx.candidateStep.update({
            where: { id: stepRow.id },
            data: { status: 'FAILED', staleInputs: [], staleSince: null },
          })
        : null;
      await this.status.reevaluate(scope, run.candidateId, { stepRunId: run.id });
      publishAfterCommit(scope, this.events, { run: { row: updated }, steps: row ? [row] : [] });
      return updated;
    }

    // COMPLETED: 끝 지문(규칙 5) — 시작 조건을 다시 읽어 비교한다. 이 실행의 후보 효과는 비교 뒤에 적용한다
    const candidate = await scope.tx.candidate.findUniqueOrThrow({
      where: { id: run.candidateId },
    });
    const rows = await loadStepRows(scope.tx, run.candidateId);
    const current = await readResolvedInputs(
      runner,
      inputContextOf(scope.tx, candidate, this.settings.current(), rows),
    );
    const stored = await loadInputRows(scope.tx, run.id);
    await this.syncRuntimeInputs(scope, run.id, stored, current);
    const currentHashes = hashesOf(current);
    const changed = changedInputKeys(hashesOf(stored), currentHashes);
    const finalStatus = changed.length > 0 ? 'RERUN_REQUIRED' : 'COMPLETED';
    const updated = await scope.tx.stepRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        inputFingerprintEnd: fingerprint(currentHashes),
        rerunReasonInputs: changed,
        waitSecondsTotal: run.waitSecondsTotal + waitAdd,
        waitingSince: null,
        endedAt: endTimeFor(run.startedAt, now),
      },
    });
    const row = isCurrent
      ? await scope.tx.candidateStep.update({
          where: { id: stepRow.id },
          data: {
            status: finalStatus,
            staleInputs: changed,
            staleSince: changed.length > 0 ? now : null,
          },
        })
      : null;
    const effects = outcome.candidateEffects;
    if (effects) await this.applyEffects(scope, run.candidateId, effects);
    if (isCurrent && finalStatus === 'COMPLETED') {
      await this.propagation.propagateFromStep(scope, run.candidateId, stepCode);
    }
    await this.status.reevaluate(scope, run.candidateId, {
      stepRunId: run.id,
      exclusion: effects?.exclusion ?? null,
    });
    if (gatesBefore) {
      await this.gateValidity.detectInvalidation?.(scope, run.candidateId, gatesBefore);
    }
    publishAfterCommit(scope, this.events, { run: { row: updated }, steps: row ? [row] : [] });
    return updated;
  }

  /** 실행 중 오너 입력 행(지문 밖)을 끝날 때 값으로 맞춘다. 완료 뒤 오너 입력 비교(규칙 7)의 기준이 된다 */
  private async syncRuntimeInputs(
    scope: StepEngineTx,
    stepRunId: number,
    stored: readonly {
      id: number;
      inputKey: string;
      isStartCondition: boolean;
      valueHash: string;
    }[],
    current: readonly ResolvedInput[],
  ): Promise<void> {
    for (const row of inputRowsOf(
      stepRunId,
      current.filter((input) => !input.isStartCondition),
    )) {
      const existing = stored.find((s) => s.inputKey === row.inputKey);
      if (!existing) {
        await scope.tx.stepRunInput.create({ data: row });
      } else if (!existing.isStartCondition && existing.valueHash !== row.valueHash) {
        await scope.tx.stepRunInput.update({
          where: { id: existing.id },
          data: { valueHash: row.valueHash, sourceType: row.sourceType },
        });
      }
    }
  }

  /** 후보 효과(② 앵커·소싱 선택·성별, ④ 리프 카테고리)를 P1-04 서비스로 적용한다 */
  async applyEffects(
    scope: StepEngineTx,
    candidateId: number,
    effects: CandidateEffects,
  ): Promise<void> {
    if (effects.anchor) await this.identity.fixAnchor(scope, candidateId, effects.anchor);
    if (effects.sourcingSelection) {
      await this.identity.changeSourcingSelection(scope, candidateId, effects.sourcingSelection);
    }
    if (effects.step2Gender !== undefined) {
      await this.gender.applyStep2Gender(scope, candidateId, effects.step2Gender);
    }
    if (effects.leafCategory) {
      await scope.tx.candidate.update({
        where: { id: candidateId },
        data: {
          leafCategoryId: effects.leafCategory.leafCategoryId,
          wholeCategoryName: effects.leafCategory.wholeCategoryName,
        },
      });
    }
  }

  // ── 입력 대기 ───────────────────────────────────────────────────────────

  /**
   * 입력 대기 실행 이어 가기: WAITING_INPUT → RUNNING(대기 초 누적) → 대기열에서 `run`을 다시 돈다(ctx.resume.data).
   * 기다리지 않는 실행이면 409 STEP_RUN_NOT_WAITING_INPUT. 앞·뒤 단계가 실행 중이면 409 STEP_LOCKED_BY_RUNNING_STEP.
   */
  async resumeWaiting(stepRunId: number, data: unknown): Promise<StepRun> {
    const found = await this.prisma.stepRun.findUnique({ where: { id: stepRunId } });
    if (!found) throw new ApiException('STEP_RUN_NOT_FOUND');
    const runner = this.registry.get(found.stepCode as StepCode);
    if (!runner) {
      throw toApiException({
        code: 'INVALID_STEP_CODE',
        stepCode: found.stepCode as StepCode,
        reason: 'NO_RUNNER',
      });
    }
    return this.transactions.run(async (scope) => {
      const candidate = await this.guard.lockForUpdate(scope.tx, found.candidateId);
      this.guard.assertMutable(candidate);
      const run = await scope.tx.stepRun.findUniqueOrThrow({ where: { id: stepRunId } });
      if (run.status !== 'WAITING_INPUT') throw new ApiException('STEP_RUN_NOT_WAITING_INPUT');
      const rows = await loadStepRows(scope.tx, run.candidateId);
      const lock = resumeLockBlock(run.stepCode as StepCode, stepStatusMapOf(rows));
      if (lock) throw toApiException(lock);
      const settings = this.settings.current();
      const inputs = await readResolvedInputs(
        runner,
        inputContextOf(scope.tx, candidate, settings, rows),
      );
      const updated = await scope.tx.stepRun.update({
        where: { id: run.id },
        data: {
          status: 'RUNNING',
          waitSecondsTotal: run.waitSecondsTotal + waitedSeconds(run.waitingSince, scope.now),
          waitingSince: null,
        },
      });
      const stepRow = await scope.tx.candidateStep.update({
        where: {
          candidateId_stepCode: { candidateId: run.candidateId, stepCode: run.stepCode },
        },
        data: { status: 'RUNNING' },
      });
      publishAfterCommit(scope, this.events, { run: { row: updated }, steps: [stepRow] });
      const previous = await this.previousOf(
        scope,
        runner,
        run.candidateId,
        run.stepCode as StepCode,
      );
      // 시작 때 고정한 엔진·모델로 이어 간다(현재 설정을 다시 읽지 않는다, R9)
      const ai = runner.usesAi ? await this.pinnedAiOf(scope, run, runner) : null;
      this.submitAfterCommit(scope, {
        run: updated,
        runner,
        settings,
        inputs,
        ownerInputs: {},
        previous,
        resume: { data },
        ownerEdit: null,
        aiEngine: ai?.fix ?? null,
        pinnedAi: ai?.context ?? null,
        chainRemaining: [],
        refetch: false,
      });
      return updated;
    });
  }

  /**
   * 실행에 고정한 AI 문맥(P2-03 — 입력 대기 중 백그라운드 작업이 그 실행의 엔진으로 AI를 부른다). stepRunId·candidateId를
   * 채워 준다(call_log). 고정하지 않은 실행·실행기 없음이면 null
   */
  async pinnedAiForRun(db: Db, stepRunId: number): Promise<PinnedAiContext | null> {
    const run = await db.stepRun.findUnique({ where: { id: stepRunId } });
    if (!run) return null;
    const runner = this.registry.get(run.stepCode as StepCode);
    if (!runner) return null;
    const snapshot = await db.settingsSnapshot.findUnique({
      where: { id: run.settingsSnapshotId },
      select: { content: true },
    });
    const pinned = pinnedAiFromRun(run, snapshot?.content ?? null, runner);
    return pinned ? { ...pinned.context, stepRunId: run.id, candidateId: run.candidateId } : null;
  }

  /** 이미 고정한 실행의 AI 문맥(step_run.ai_* + 그 실행의 설정 스냅샷 ai 섹션) */
  private async pinnedAiOf(
    scope: StepEngineTx,
    run: StepRun,
    runner: StepRunner,
  ): Promise<PinnedAi | null> {
    const snapshot = await scope.tx.settingsSnapshot.findUnique({
      where: { id: run.settingsSnapshotId },
      select: { content: true },
    });
    return pinnedAiFromRun(run, snapshot?.content ?? null, runner);
  }

  /**
   * 입력 대기 중인 실행의 입력 기록 일부를 지금 값으로 다시 쓴다(P2-06 Proposed — ④ 성별 재확인, F-CA-05·P2-06 규칙 14).
   * 입력 대기 중 시작 조건이 바뀌면 원래 '재실행 필요'지만(F-CW-18), 같은 실행에서 이어 가는 예외(④ 성별)는 이 실행의 입력
   * 행(값 해시·출처)과 시작 지문을 새 값으로 맞춘다 — 그러지 않으면 끝 지문이 달라 방금 고른 ④가 '재실행 필요'로 남는다.
   * 호출자가 후보 행을 잠근 트랜잭션 안에서 부른다. 입력 대기가 아니면 409 STEP_RUN_NOT_WAITING_INPUT.
   */
  async refreshWaitingInputs(
    scope: StepEngineTx,
    stepRunId: number,
    inputKeys: readonly string[],
  ): Promise<void> {
    const run = await scope.tx.stepRun.findUniqueOrThrow({ where: { id: stepRunId } });
    if (run.status !== 'WAITING_INPUT') throw new ApiException('STEP_RUN_NOT_WAITING_INPUT');
    const runner = this.registry.get(run.stepCode as StepCode);
    if (!runner) throw new Error(`실행기가 없습니다: ${run.stepCode}`);
    const candidate = await scope.tx.candidate.findUniqueOrThrow({
      where: { id: run.candidateId },
    });
    const rows = await loadStepRows(scope.tx, run.candidateId);
    const current = await readResolvedInputs(
      runner,
      inputContextOf(scope.tx, candidate, this.settings.current(), rows),
    );
    const stored = await loadInputRows(scope.tx, run.id);
    const refreshed = new Set(inputKeys);
    for (const key of refreshed) {
      const now = current.find((input) => input.inputKey === key);
      const existing = stored.find((row) => row.inputKey === key);
      const [next] = inputRowsOf(run.id, now ? [now] : []);
      if (existing && next) {
        await scope.tx.stepRunInput.update({
          where: { id: existing.id },
          data: {
            sourceType: next.sourceType,
            sourceStepRunId: next.sourceStepRunId,
            isStartCondition: next.isStartCondition,
            valueHash: next.valueHash,
          },
        });
      } else if (existing) {
        await scope.tx.stepRunInput.delete({ where: { id: existing.id } });
      } else if (next) {
        await scope.tx.stepRunInput.create({ data: next });
      }
    }
    // 시작 지문: 새로 쓴 키는 지금 값, 나머지는 시작 때 값(행이 없던 선택 입력은 null 해시)
    const startHashes: Record<string, string> = {};
    for (const input of current) {
      if (!input.isStartCondition) continue;
      startHashes[input.inputKey] = refreshed.has(input.inputKey)
        ? input.valueHash
        : (stored.find((row) => row.inputKey === input.inputKey)?.valueHash ?? NULL_VALUE_HASH);
    }
    await scope.tx.stepRun.update({
      where: { id: run.id },
      data: { inputFingerprintStart: fingerprint(startHashes) },
    });
  }

  /**
   * 입력 대기 실행 끝내기(호출자 트랜잭션 안): 오너 입력으로 결과가 정해지는 경우(예: G3 선택으로 ⑤ 완료, P1-06).
   * 기다리지 않는 실행이면 409 STEP_RUN_NOT_WAITING_INPUT.
   */
  async completeWaiting(
    scope: StepEngineTx,
    stepRunId: number,
    outcome: StepOutcome,
  ): Promise<StepRun> {
    const found = await scope.tx.stepRun.findUnique({ where: { id: stepRunId } });
    if (!found) throw new ApiException('STEP_RUN_NOT_FOUND');
    await this.guard.lockForUpdate(scope.tx, found.candidateId);
    const run = await scope.tx.stepRun.findUniqueOrThrow({ where: { id: stepRunId } });
    if (run.status !== 'WAITING_INPUT') throw new ApiException('STEP_RUN_NOT_WAITING_INPUT');
    const runner = this.registry.get(run.stepCode as StepCode);
    if (!runner) throw new Error(`실행기가 없습니다: ${run.stepCode}`);
    return this.closeRun(scope, run, runner, checkOutcome(outcome));
  }
}
