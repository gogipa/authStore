import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type { Candidate, CandidateStep, StepChain } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { CandidateGuardService } from '../candidates/candidate-guard.service.js';
import { toContinuousRun } from '../candidates/candidate-view.js';
import { StepEngineTransactions, type StepEngineTx } from '../candidates/step-engine-tx.js';
import { isStepCode, stepStatusOf, type StepCode } from '../domain/steps.js';
import type {
  ContinuousRunAcceptedDto,
  ContinuousRunDetailDto,
  ContinuousRunStartRequestDto,
} from '../dto/continuous-run.dto.js';
import { asStartCandidate } from '../execution/start-conditions.js';
import { checkStepRunnable, toApiException } from '../execution/step-blocks.js';
import { StepExecutionService } from '../execution/step-execution.service.js';
import {
  isOneOpenRunViolation,
  loadStepRows,
  stepStatusMapOf,
} from '../execution/step-run-store.js';
import { AI_ENGINE_RESOLVER, type AiEngineResolver } from '../ports/ai-engine-resolver.port.js';
import { GATE_VALIDITY, toGateFlags, type GateValidityPort } from '../ports/gate-validity.port.js';
import { toStepRunSummary } from '../rail/step-run-view.js';
import { StepRunnerRegistry } from '../runner/step-runner.registry.js';
import {
  CHAIN_STEPS,
  chainSegment,
  checkChainStart,
  nextChainAction,
  type ChainAction,
  type ChainKind,
  type ChainState,
  type ChainStopReason,
} from './chain-planner.js';

/** 판정 유효 시간 기본값(설정을 읽지 못할 때, PRD §5.3 6시간) */
const DEFAULT_VALIDITY_HOURS = 6;

/** 이어 가기 중 단계를 시작하지 못함(묶음을 NO_RUNNABLE_STEP으로 닫는다) */
class ChainStartError extends Error {
  constructor(
    readonly stepCode: StepCode,
    readonly reason: unknown,
  ) {
    super(`연속 실행이 ${stepCode}를 시작하지 못했습니다`);
  }
}

/** 한 번 계획해 본 결과 */
type AdvanceResult =
  | { kind: 'run'; stepRunId: number; stepCode: StepCode }
  | { kind: 'wait' }
  | { kind: 'stop'; reason: ChainStopReason; stepCode: StepCode | null };

/** 연속 실행 경로(202 Location) */
export function continuousRunLocation(stepChainId: number): string {
  return `/api/v1/continuous-runs/${stepChainId}`;
}

/**
 * 연속 실행(F-CW-14·15·16, 05-2 startCandidateContinuousRun·getContinuousRun, P1-06 규칙 1~7).
 * - 시작: 후보 행 `SELECT … FOR UPDATE` → 잠금·제외 → 열린 묶음(409 CONTINUOUS_RUN_ALREADY_OPEN — DB 제약이 없어
 *   행 잠금으로 지킨다, ERD §7.2-12) → 시작 검사(G2 전 ②·③, 재실행 필요 없음) → AI 단계 엔진 확인(P1-10 훅) →
 *   step_chain 1행 → 첫 행동(건너뛰기를 기록하며 첫 실행까지)을 **같은 트랜잭션**에서. 첫 실행이 막히면 묶음도 남지 않는다.
 * - 이어 가기: 묶음 안 실행이 끝날 때마다(StepExecutionService의 프로세스 안 훅) 새 트랜잭션에서 후보를 잠그고 다음 행동을
 *   정한다. HTTP 요청·SSE 연결에 기대지 않는다. 멈추면 ended_at·stop_reason·stop_step_code를 한 번에 쓰고 커밋 뒤 SSE
 *   `continuous-run.stopped`. 앱이 꺼지면 재시작 정리가 APP_RESTART로 닫고 다시 이어 가지 않는다.
 * - 취소 API는 없다(05-2 x-decision §7.2-17).
 */
@Injectable()
export class ContinuousRunService implements OnModuleInit {
  private readonly logger = new Logger(ContinuousRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly executions: StepExecutionService,
    private readonly registry: StepRunnerRegistry,
    private readonly settings: SettingsService,
    private readonly events: ProgressEventsService,
    @Inject(GATE_VALIDITY) private readonly gates: GateValidityPort,
    @Inject(AI_ENGINE_RESOLVER) private readonly resolveAiEngine: AiEngineResolver,
  ) {}

  onModuleInit(): void {
    this.executions.onChainRunSettled(({ stepChainId }) => this.advance(stepChainId));
  }

  // ── 시작 ────────────────────────────────────────────────────────────────

  /** 연속 실행 시작(202). 곧바로 시작한 단계 실행을 준다 */
  async start(
    candidateId: number,
    body: ContinuousRunStartRequestDto,
  ): Promise<ContinuousRunAcceptedDto> {
    const kind: ChainKind = body.kind;
    const startStepCode = kind === 'FROM_HERE' ? parseStartStepCode(body.startStepCode) : null;
    await this.guard.findOr404(this.prisma, candidateId);
    try {
      return await this.transactions.run(async (scope) => {
        const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
        this.guard.assertMutable(candidate);
        const open = await scope.tx.stepChain.findFirst({
          where: { candidateId, endedAt: null },
          select: { id: true },
        });
        if (open) {
          throw new ApiException('CONTINUOUS_RUN_ALREADY_OPEN', {
            details: { stepChainId: open.id },
          });
        }
        const rows = await loadStepRows(scope.tx, candidateId);
        const steps = stepStatusMapOf(rows);
        const gates = toGateFlags(await this.gates.evaluate(scope.tx, candidateId));
        const startBlock = checkChainStart({ kind, startStepCode, steps, gates });
        if (startBlock) throw new ApiException(startBlock);
        if (startStepCode) {
          // 고른 단계는 상태와 관계없이 실행한다 — 지금 실행할 수 없으면(시작 조건·잠금·⑧ G3) 그 이유로 막는다
          const block = checkStepRunnable(
            startStepCode,
            asStartCandidate(candidate),
            steps,
            gates,
            {
              mode: 'run',
              hasRunner: this.registry.has(startStepCode),
              settingsLoaded: this.settings.currentOrNull() !== null,
            },
          );
          if (block) throw toApiException(block);
        }
        await this.assertAiEngine(candidateId, kind, startStepCode, rows, gates.G2);
        const chain = await scope.tx.stepChain.create({
          data: { candidateId, kind, startStepCode, startedAt: scope.now },
        });
        const result = await this.advanceInScope(scope, chain);
        if (result.kind !== 'run') throw this.startRejection(candidate, rows, kind, gates, result);
        return {
          stepChainId: chain.id,
          candidateId,
          kind,
          startStepCode,
          startedAt: chain.startedAt.toISOString(),
          status: 'RUNNING' as const,
          stepRunId: result.stepRunId,
          stepCode: result.stepCode,
        };
      });
    } catch (error) {
      const cause = error instanceof ChainStartError ? error.reason : error;
      if (isOneOpenRunViolation(cause)) {
        throw toApiException({
          code: 'STEP_ALREADY_RUNNING',
          stepCode:
            error instanceof ChainStartError ? error.stepCode : (startStepCode ?? 'SOURCING'),
          status: 'RUNNING',
        });
      }
      throw cause;
    }
  }

  /**
   * AI 엔진 확인(D-16, P1-10 훅): 묶음이 돌 수 있는 단계 중 AI를 쓰는 단계가 있으면 그 단계로 선택 엔진을 확인한다
   * (쓸 수 없으면 훅이 409 AI_ENGINE_UNAVAILABLE을 던진다). 각 단계는 시작할 때 엔진을 다시 고정한다.
   */
  private async assertAiEngine(
    candidateId: number,
    kind: ChainKind,
    startStepCode: StepCode | null,
    rows: readonly CandidateStep[],
    g2Valid: boolean,
  ): Promise<void> {
    const steps = stepStatusMapOf(rows);
    const segment = chainSegment({ kind, startStepCode }).filter(
      (code) => g2Valid || code === 'SOURCING' || code === 'PRICING',
    );
    const candidates =
      kind === 'FROM_HERE'
        ? segment.filter(
            (code) => code === startStepCode || stepStatusOf(steps, code) !== 'COMPLETED',
          )
        : segment.filter((code) => stepStatusOf(steps, code) === 'RERUN_REQUIRED');
    const aiStep = candidates.find((code) => this.registry.get(code)?.usesAi === true);
    if (aiStep) await this.resolveAiEngine({ candidateId, stepCode: aiStep });
  }

  /** 첫 행동이 실행이 아니면(곧바로 멈춤) 시작을 거절하는 오류 */
  private startRejection(
    candidate: Candidate,
    rows: readonly CandidateStep[],
    kind: ChainKind,
    gates: { G2: boolean; G3: boolean },
    result: AdvanceResult,
  ): ApiException {
    const steps = stepStatusMapOf(rows);
    const first =
      kind === 'RERUN_STALE'
        ? CHAIN_STEPS.find((code) => stepStatusOf(steps, code) === 'RERUN_REQUIRED')
        : undefined;
    if (first) {
      const block = checkStepRunnable(first, asStartCandidate(candidate), steps, gates, {
        mode: 'run',
        hasRunner: this.registry.has(first),
      });
      if (block) return toApiException(block);
    }
    if (result.kind === 'stop' && result.reason === 'AWAIT_G2') {
      return new ApiException('CONTINUOUS_RUN_BEFORE_G2');
    }
    return new ApiException('NO_RERUN_REQUIRED_STEPS');
  }

  // ── 이어 가기 ───────────────────────────────────────────────────────────

  /** 묶음 안 실행이 끝났다 → 다음 행동(새 트랜잭션). 실패해도 던지지 않는다(묶음을 닫는다) */
  async advance(stepChainId: number): Promise<void> {
    try {
      await this.transactions.run(async (scope) => {
        const peek = await scope.tx.stepChain.findUnique({ where: { id: stepChainId } });
        if (!peek || peek.endedAt) return;
        await this.guard.lockForUpdate(scope.tx, peek.candidateId);
        const chain = await scope.tx.stepChain.findUniqueOrThrow({ where: { id: stepChainId } });
        if (chain.endedAt) return;
        const result = await this.advanceInScope(scope, chain);
        if (result.kind === 'stop') await this.close(scope, chain, result.reason, result.stepCode);
      });
    } catch (error) {
      const stepCode = error instanceof ChainStartError ? error.stepCode : null;
      const cause = error instanceof ChainStartError ? error.reason : error;
      if (!(cause instanceof ApiException)) {
        this.logger.error({ err: cause }, `연속 실행 #${stepChainId}을 이어 가지 못했습니다`);
      } else {
        this.logger.log(
          `연속 실행 #${stepChainId}: ${stepCode ?? '다음 단계'}를 시작하지 못해 멈춥니다(${cause.code})`,
        );
      }
      await this.closeAfterError(stepChainId, stepCode);
    }
  }

  /** 다음 행동을 정해 적용한다(건너뛰기는 기록하고 계속, 실행은 시작하고 끝). 멈춤은 호출자가 닫는다 */
  private async advanceInScope(scope: StepEngineTx, chain: StepChain): Promise<AdvanceResult> {
    const skipped = [...chain.skippedStepCodes] as StepCode[];
    for (let guard = 0; guard <= CHAIN_STEPS.length + 1; guard += 1) {
      const state = await this.loadState(scope, chain, skipped);
      const action: ChainAction = nextChainAction(state);
      if ('skip' in action) {
        skipped.push(action.skip);
        await scope.tx.stepChain.update({
          where: { id: chain.id },
          data: { skippedStepCodes: skipped },
        });
        continue;
      }
      if ('wait' in action) return { kind: 'wait' };
      if ('stop' in action) return { kind: 'stop', reason: action.stop, stepCode: action.stepCode };
      try {
        const started = await this.executions.startChainRun(scope, chain.candidateId, action.run, {
          stepChainId: chain.id,
          refetch: action.refetch,
        });
        return { kind: 'run', stepRunId: started.run.id, stepCode: action.run };
      } catch (error) {
        throw new ChainStartError(action.run, error);
      }
    }
    throw new Error(`연속 실행 #${chain.id}: 건너뛰기가 끝나지 않습니다`);
  }

  /** 계획에 넘길 지금 상태 */
  private async loadState(
    scope: StepEngineTx,
    chain: StepChain,
    skipped: readonly StepCode[],
  ): Promise<ChainState> {
    const candidate = await scope.tx.candidate.findUniqueOrThrow({
      where: { id: chain.candidateId },
    });
    const rows = await loadStepRows(scope.tx, chain.candidateId);
    const gates = toGateFlags(await this.gates.evaluate(scope.tx, chain.candidateId));
    const runs: Partial<Record<StepCode, number>> = {};
    const chainRuns = await scope.tx.stepRun.findMany({
      where: { stepChainId: chain.id },
      select: { stepCode: true },
    });
    for (const run of chainRuns) {
      const code = run.stepCode as StepCode;
      runs[code] = (runs[code] ?? 0) + 1;
    }
    return {
      kind: chain.kind as ChainKind,
      startStepCode: chain.startStepCode as StepCode | null,
      candidate: asStartCandidate(candidate),
      steps: stepStatusMapOf(rows),
      gates,
      judgementPageStale: await this.judgementPageStale(scope, rows),
      runs,
      skipped,
      missingRunners: CHAIN_STEPS.filter((code) => !this.registry.has(code)),
    };
  }

  /**
   * 6시간 규칙(규칙 3): ③ 현재 버전(산출물 있음)의 판정에 쓴 라쿠텐 페이지 수집 시각 + 판정 유효 시간 < 지금.
   * ③ 실행기의 `judgementPageCollectedAt`(P2-05)이 없거나 null이면 false. 후보 상태의 '최신'에는 쓰지 않는다.
   */
  private async judgementPageStale(
    scope: StepEngineTx,
    rows: readonly CandidateStep[],
  ): Promise<boolean> {
    const pricing = rows.find((row) => row.stepCode === 'PRICING');
    if (!pricing?.currentStepRunId) return false;
    if (pricing.status !== 'COMPLETED' && pricing.status !== 'RERUN_REQUIRED') return false;
    const runner = this.registry.get('PRICING');
    if (!runner?.judgementPageCollectedAt) return false;
    const collectedAt = await runner.judgementPageCollectedAt(scope.tx, pricing.currentStepRunId);
    if (!collectedAt) return false;
    const hours =
      this.settings.currentOrNull()?.safety.judgementValidityHours ?? DEFAULT_VALIDITY_HOURS;
    return scope.now.getTime() > collectedAt.getTime() + hours * 3_600_000;
  }

  // ── 닫기 ────────────────────────────────────────────────────────────────

  /** 묶음을 닫는다(ended_at·stop_reason·stop_step_code 한 번에, ck_step_chain_end) + 커밋 뒤 SSE */
  async close(
    scope: StepEngineTx,
    chain: StepChain,
    reason: ChainStopReason | 'APP_RESTART',
    stepCode: StepCode | null,
  ): Promise<boolean> {
    const closed = await scope.tx.stepChain.updateMany({
      where: { id: chain.id, endedAt: null },
      data: { endedAt: scope.now, stopReason: reason, stopStepCode: stepCode },
    });
    if (closed.count === 0) return false;
    const endedAt = scope.now.toISOString();
    scope.afterCommit(() => {
      this.events.publish('continuous-run.stopped', {
        stepChainId: chain.id,
        candidateId: chain.candidateId,
        kind: chain.kind as ChainKind,
        stopReason: reason,
        stopStepCode: stepCode,
        endedAt,
      });
    });
    return true;
  }

  /** 이어 가기가 예외로 끝났을 때 묶음을 NO_RUNNABLE_STEP으로 닫는다(열린 채 남아 새 연속 실행을 막지 않게) */
  private async closeAfterError(stepChainId: number, stepCode: StepCode | null): Promise<void> {
    try {
      await this.transactions.run(async (scope) => {
        const chain = await scope.tx.stepChain.findUnique({ where: { id: stepChainId } });
        if (!chain || chain.endedAt) return;
        await this.close(scope, chain, 'NO_RUNNABLE_STEP', stepCode);
      });
    } catch (error) {
      this.logger.error({ err: error }, `연속 실행 #${stepChainId}을 닫지 못했습니다`);
    }
  }

  // ── 조회 ────────────────────────────────────────────────────────────────

  /** 연속 실행 한 번(05-2 getContinuousRun). 없으면 404 CONTINUOUS_RUN_NOT_FOUND */
  async detail(stepChainId: number): Promise<ContinuousRunDetailDto> {
    const chain = await this.prisma.stepChain.findUnique({ where: { id: stepChainId } });
    if (!chain) throw new ApiException('CONTINUOUS_RUN_NOT_FOUND');
    const runs = await this.prisma.stepRun.findMany({
      where: { stepChainId },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    });
    return {
      ...toContinuousRun(chain)!,
      stepRuns: runs.map(toStepRunSummary),
      skippedStepCodes: chain.skippedStepCodes as StepCode[],
    };
  }
}

/** FROM_HERE의 startStepCode: 없으면 422 VALIDATION_FAILED, 모르는 코드·REGISTER는 422 INVALID_STEP_CODE */
export function parseStartStepCode(value: string | undefined): StepCode {
  if (value === undefined || value === null || value === '') {
    throw new ApiException('VALIDATION_FAILED', {
      fieldErrors: [
        {
          field: 'startStepCode',
          message: "'여기부터 연속 실행'에는 시작 단계가 필요합니다.",
          rejectedValue: value ?? null,
        },
      ],
    });
  }
  if (!isStepCode(value)) {
    throw new ApiException('INVALID_STEP_CODE', {
      details: { stepCode: value.slice(0, 32) },
    });
  }
  if (value === 'REGISTER') {
    throw toApiException({ code: 'INVALID_STEP_CODE', stepCode: value, reason: 'NOT_RUNNABLE' });
  }
  return value;
}
