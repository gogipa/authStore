import { Injectable } from '@nestjs/common';
import type { StepRun } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CandidateStatusService } from './candidates/candidate-status.service.js';
import { StepEngineTransactions, type Db, type StepEngineTx } from './candidates/step-engine-tx.js';
import type { StepOutcome } from './contracts/step-runner.js';
import type { StepCode } from './domain/steps.js';
import { StepExecutionService } from './execution/step-execution.service.js';
import { PropagationService } from './propagation/propagation.service.js';

/** 입력 대기 실행 이어 가기(다시 run) 또는 끝내기(결과를 줌) */
export type ResumeWaitingInput =
  | { data?: unknown; outcome?: undefined; scope?: undefined }
  | { outcome: StepOutcome; scope?: StepEngineTx; data?: undefined };

/**
 * 단계 모듈(P2~P4)이 step-engine에서 쓰는 창구(P1-05). 단계 모듈이 가져오는 것은 contracts/step-runner.ts와 이것뿐이다.
 * - `resumeWaiting(stepRunId, { data })`: 입력 대기 실행을 이어 간다(RUNNING으로 되돌리고 run을 다시 돈다. ctx.resume.data)
 * - `resumeWaiting(stepRunId, { outcome, scope? })`: 입력 대기 실행을 그 결과로 끝낸다(scope를 주면 그 트랜잭션 안에서)
 *   — 예: G3 선택으로 ⑤ 완료(P1-06), ② 소싱 선택으로 ② 완료(P2-03)
 * - `ownerInputChanged(candidateId, inputKey, scope?)`: 완료 뒤 오너 입력 새 행(③ 국내 기준가·⑤ 레퍼런스 선택·URL 후보 쿠폰)
 *   → 그 키를 읽는 단계의 재실행 필요(규칙 7). 바뀐 단계를 돌려준다
 * - `currentCompletedRun(candidateId, stepCode, db?)`: 현재 버전이 COMPLETED면 그 실행, 아니면 null(앞 단계 산출물 읽기)
 */
@Injectable()
export class StepEngineApi {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly executions: StepExecutionService,
    private readonly propagation: PropagationService,
    private readonly status: CandidateStatusService,
  ) {}

  resumeWaiting(stepRunId: number, input: ResumeWaitingInput = {}): Promise<StepRun> {
    if (input.outcome) {
      const outcome = input.outcome;
      return input.scope
        ? this.executions.completeWaiting(input.scope, stepRunId, outcome)
        : this.transactions.run((scope) =>
            this.executions.completeWaiting(scope, stepRunId, outcome),
          );
    }
    return this.executions.resumeWaiting(stepRunId, input.data ?? null);
  }

  async ownerInputChanged(
    candidateId: number,
    inputKey: string,
    scope?: StepEngineTx,
  ): Promise<StepCode[]> {
    const apply = async (s: StepEngineTx) => {
      const changed = await this.propagation.ownerInputChanged(s, candidateId, inputKey);
      if (changed.length > 0) await this.status.reevaluate(s, candidateId);
      return changed;
    };
    return scope ? apply(scope) : this.transactions.run(apply);
  }

  async currentCompletedRun(
    candidateId: number,
    stepCode: StepCode,
    db: Db = this.prisma,
  ): Promise<StepRun | null> {
    const step = await db.candidateStep.findUnique({
      where: { candidateId_stepCode: { candidateId, stepCode } },
      select: { status: true, currentStepRunId: true },
    });
    if (!step || step.status !== 'COMPLETED' || step.currentStepRunId === null) return null;
    return db.stepRun.findUnique({ where: { id: step.currentStepRunId } });
  }
}
