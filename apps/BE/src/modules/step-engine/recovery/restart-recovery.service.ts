import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CandidateGuardService } from '../candidates/candidate-guard.service.js';
import { CandidateStatusService } from '../candidates/candidate-status.service.js';
import { StepEngineTransactions } from '../candidates/step-engine-tx.js';
import { ContinuousRunService } from '../continuous/continuous-run.service.js';
import { endTimeFor } from '../domain/run-time.js';
import type { StepCode } from '../domain/steps.js';
import { publishAfterCommit } from '../execution/step-events.js';
import { StepRunnerRegistry } from '../runner/step-runner.registry.js';

/** 중단 안내(step_run.error_code·error_message, P1-05 Proposed). 화면은 '실패(중단됨)'으로 보인다 */
export const INTERRUPTED_ERROR = {
  errorCode: 'APP_RESTART',
  errorMessage: '앱이 꺼져 실행이 중단되었습니다. 다시 실행해 주세요.',
} as const;

/** 한 번의 정리 결과 */
export interface RecoveryResult {
  interruptedStepRunIds: number[];
  candidateTransitions: { candidateId: number; toStatus: string; reason: string }[];
  /** APP_RESTART로 닫은 연속 실행 묶음(P1-06) */
  closedStepChainIds: number[];
}

/**
 * 재시작 때 중단 단계 정리(F-BS-18, PRD §5.2, US-29 AC3, 규칙 12). 앱이 요청을 받기 전(onApplicationBootstrap —
 * listen 전)에 끝낸다.
 * - RUNNING step_run → FAILED + failure_kind INTERRUPTED + ended_at, 그 단계가 현재 버전이면 candidate_step도 FAILED.
 * - WAITING_INPUT은 그대로 둔다(오너 입력을 이어서 받는다).
 * - ⑨ REGISTER였으면 실행기 훅(`onInterrupted`, P4-03)이 등록 기록으로 후보 상태를 정한다(등록요청중 → 결과확인필요
 *   APP_RESTART, 기록 전·차단 스위치 켬 → 승인대기 RESTART_REVERTED). 여기서는 registration을 읽거나 쓰지 않는다.
 * - 열린 연속 실행 묶음(ended_at NULL)은 stop_reason APP_RESTART로 닫고 다시 이어 가지 않는다(P1-06 규칙 7). 멈춘 단계는
 *   그 묶음의 마지막 실행 단계(중단된 단계, 없으면 null — Proposed). 커밋 뒤 SSE `continuous-run.stopped`.
 * 실행 한 건마다 트랜잭션 하나(한 건이 깨져도 나머지는 정리한다).
 */
@Injectable()
export class RestartRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RestartRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly status: CandidateStatusService,
    private readonly registry: StepRunnerRegistry,
    private readonly events: ProgressEventsService,
    private readonly chains: ContinuousRunService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const result = await this.recover();
      if (result.interruptedStepRunIds.length > 0) {
        this.logger.warn(
          `앱 재시작: 실행 중이던 단계 ${result.interruptedStepRunIds.length}건을 '실패(중단됨)'으로 바꿨습니다`,
        );
      }
      if (result.closedStepChainIds.length > 0) {
        this.logger.warn(
          `앱 재시작: 진행 중이던 연속 실행 ${result.closedStepChainIds.length}건을 닫았습니다(APP_RESTART)`,
        );
      }
    } catch (error) {
      this.logger.error({ err: error }, '재시작 정리에 실패했습니다');
    }
  }

  /** RUNNING 실행을 모두 '실패(중단됨)'으로 닫는다 */
  async recover(): Promise<RecoveryResult> {
    const running = await this.prisma.stepRun.findMany({
      where: { status: 'RUNNING' },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    const result: RecoveryResult = {
      interruptedStepRunIds: [],
      candidateTransitions: [],
      closedStepChainIds: [],
    };
    for (const { id } of running) {
      try {
        await this.transactions.run(async (scope) => {
          const peek = await scope.tx.stepRun.findUniqueOrThrow({ where: { id } });
          const candidate = await this.guard.lockForUpdate(scope.tx, peek.candidateId);
          const run = await scope.tx.stepRun.findUniqueOrThrow({ where: { id } });
          if (run.status !== 'RUNNING') return;
          const closed = await scope.tx.stepRun.update({
            where: { id },
            data: {
              status: 'FAILED',
              failureKind: 'INTERRUPTED',
              errorCode: INTERRUPTED_ERROR.errorCode,
              errorMessage: INTERRUPTED_ERROR.errorMessage,
              endedAt: endTimeFor(run.startedAt, scope.now),
            },
          });
          const stepRow = await scope.tx.candidateStep.findUniqueOrThrow({
            where: {
              candidateId_stepCode: { candidateId: run.candidateId, stepCode: run.stepCode },
            },
          });
          const updatedRow =
            stepRow.currentStepRunId === id
              ? await scope.tx.candidateStep.update({
                  where: { id: stepRow.id },
                  data: { status: 'FAILED', staleInputs: [], staleSince: null },
                })
              : null;
          const runner = this.registry.get(run.stepCode as StepCode);
          const effect = runner?.onInterrupted
            ? await runner.onInterrupted(scope.tx, closed)
            : null;
          if (effect) {
            await this.status.transition(
              scope,
              candidate,
              { toStatus: effect.toStatus, reason: effect.reason },
              { stepRunId: id, registrationId: effect.registrationId ?? null },
            );
            result.candidateTransitions.push({
              candidateId: candidate.id,
              toStatus: effect.toStatus,
              reason: effect.reason,
            });
          } else if (run.stepCode === 'REGISTER' && !runner?.onInterrupted) {
            this.logger.warn(
              `⑨ 등록 실행 #${id}: 재시작 훅(P4-03)이 없어 후보 상태를 그대로 둡니다`,
            );
          } else {
            await this.status.reevaluate(scope, candidate.id, { stepRunId: id });
          }
          publishAfterCommit(scope, this.events, {
            run: { row: closed },
            steps: updatedRow ? [updatedRow] : [],
          });
          result.interruptedStepRunIds.push(id);
        });
      } catch (error) {
        this.logger.error({ err: error }, `실행 #${id}을 '실패(중단됨)'으로 바꾸지 못했습니다`);
      }
    }
    await this.closeOpenChains(result);
    return result;
  }

  /** 열린 연속 실행 묶음을 APP_RESTART로 닫는다(묶음마다 트랜잭션 하나) */
  private async closeOpenChains(result: RecoveryResult): Promise<void> {
    const open = await this.prisma.stepChain.findMany({
      where: { endedAt: null },
      orderBy: { id: 'asc' },
    });
    for (const chain of open) {
      try {
        await this.transactions.run(async (scope) => {
          await this.guard.lockForUpdate(scope.tx, chain.candidateId);
          const last = await scope.tx.stepRun.findFirst({
            where: { stepChainId: chain.id },
            orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
            select: { stepCode: true },
          });
          const closed = await this.chains.close(
            scope,
            chain,
            'APP_RESTART',
            (last?.stepCode as StepCode | undefined) ?? null,
          );
          if (closed) result.closedStepChainIds.push(chain.id);
        });
      } catch (error) {
        this.logger.error({ err: error }, `연속 실행 #${chain.id}을 닫지 못했습니다`);
      }
    }
  }
}
