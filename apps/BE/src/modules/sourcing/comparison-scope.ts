import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import { ProgressEventsService } from '../../common/events/progress-events.service.js';
import type { Candidate, SourcingComparisonRow, StepRun } from '../../generated/prisma/client.js';
import { CandidateGuardService } from '../step-engine/candidates/candidate-guard.service.js';
import {
  StepEngineTransactions,
  type StepEngineTx,
} from '../step-engine/candidates/step-engine-tx.js';
import { isLockedStatus } from '../step-engine/domain/steps.js';
import { JobStopped } from './sourcing-jobs.js';

/**
 * 비교표 쓰기 트랜잭션(P2-03). 비교표 행·머리 행은 그 ② 버전이 입력 대기일 때만 바뀐다(`trg_output_frozen`). 쓰기 전에
 * 후보 행을 잠가(SELECT … FOR UPDATE) 선택·행 수정·백그라운드 작업이 차례로 돌게 하고, 버전 상태를 다시 본다.
 * - `forRequest`: API 요청 — 잠금·제외 409(CANDIDATE_LOCKED·CANDIDATE_EXCLUDED) → 입력 대기 아님 409
 *   STEP_RUN_NOT_WAITING_INPUT
 * - `forJob`: 백그라운드 작업 — 버전이 닫혔거나 후보가 잠겼으면 `JobStopped`(오류 아님, 작업을 멈춘다)
 * 행이 바뀌면 커밋 뒤 SSE `sourcing.row-updated`(`publishRowUpdated`, data에 후보 id가 없어 옵션으로 넘긴다).
 */
@Injectable()
export class ComparisonScope {
  constructor(
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly events: ProgressEventsService,
  ) {}

  forRequest<T>(
    candidateId: number,
    stepRunId: number,
    fn: (scope: StepEngineTx, ctx: { candidate: Candidate; run: StepRun }) => Promise<T>,
  ): Promise<T> {
    return this.transactions.run(async (scope) => {
      const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
      this.guard.assertMutable(candidate);
      const run = await scope.tx.stepRun.findUniqueOrThrow({ where: { id: stepRunId } });
      if (run.status !== 'WAITING_INPUT') throw new ApiException('STEP_RUN_NOT_WAITING_INPUT');
      return fn(scope, { candidate, run });
    });
  }

  forJob<T>(
    candidateId: number,
    stepRunId: number,
    fn: (scope: StepEngineTx, ctx: { candidate: Candidate; run: StepRun }) => Promise<T>,
  ): Promise<T> {
    return this.transactions.run(async (scope) => {
      const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
      if (isLockedStatus(candidate.status)) throw new JobStopped('여정이 잠겨 멈춥니다');
      const run = await scope.tx.stepRun.findUniqueOrThrow({ where: { id: stepRunId } });
      if (run.status !== 'WAITING_INPUT') {
        throw new JobStopped(`② 버전 #${stepRunId}이 입력 대기가 아니라(${run.status}) 멈춥니다`);
      }
      return fn(scope, { candidate, run });
    });
  }

  /** 커밋 뒤 SSE sourcing.row-updated */
  publishRowUpdated(scope: StepEngineTx, candidateId: number, row: SourcingComparisonRow): void {
    scope.afterCommit(() => {
      this.events.publish(
        'sourcing.row-updated',
        {
          sourcingComparisonId: row.sourcingComparisonId,
          rowId: row.id,
          isVerified: row.isVerified,
          stockPass: row.stockPass,
          inStockSizeCount: row.inStockSizeCount,
          effectivePriceYen: row.effectivePriceYen,
          manualCheckRequired: row.manualCheckRequired,
        },
        { candidateId },
      );
    });
  }
}
