import { Injectable } from '@nestjs/common';
import { UserActionLogService } from '../../../common/audit/user-action-log.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CandidateGuardService } from '../candidates/candidate-guard.service.js';
import { StepEngineTransactions, type Db } from '../candidates/step-engine-tx.js';
import { GateValidityService } from '../gates/gate-validity.service.js';
import { StepModulePorts } from '../ports/step-module-ports.js';

/** 05-2 CandidateNoComparisonConfirmation */
export interface NoComparisonConfirmationDto {
  candidateId: number;
  noComparisonConfirmedAt: string;
}

/** user_action_log detail의 확인 종류 */
export const NO_COMPARISON_CONFIRMATION = 'NO_COMPARISON';

/**
 * '비교 없이 확정'(F-PJ-02·F-PJ-20, 05-2 confirmCandidateNoComparison·revokeCandidateNoComparison, P2-05 규칙 15).
 * 값은 `candidate.no_comparison_confirmed_at`(웹 화면 전용 기록 — CLI 창구 StepEngineApi에 열지 않는다).
 * - 체크: ② **현재 버전**이 비교를 하지 않은 버전(`comparison_performed=false` — URL로 만들기·그 재조회)일 때만. 아니면(비교한
 *   후보·② 산출물 없음) 409 CONFIRMATION_NOT_APPLICABLE. 이미 체크돼 있으면 기존 시각 그대로 200(멱등). 새로 체크하면
 *   user_action_log(OWNER_CONFIRMED, detail.confirmation=NO_COMPARISON)
 * - 해제: 204(이미 풀려 있어도). G2가 **지금 유효하면** 409 GATE_ALREADY_PASSED(Proposed — 해제로 G2를 무효로 만들지
 *   않는다. ③을 다시 돌려 G2가 이미 무효면 풀 수 있다). 풀면 user_action_log(OWNER_EDITED, action=REVOKED)
 * 두 요청 모두 후보 행 잠금 → 잠금(409 CANDIDATE_LOCKED)·제외(409 CANDIDATE_EXCLUDED) 검사를 먼저 한다.
 */
@Injectable()
export class NoComparisonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly ports: StepModulePorts,
    private readonly gateValidity: GateValidityService,
    private readonly audit: UserActionLogService,
  ) {}

  /** ② 현재 버전이 비교를 하지 않은 버전인가(소싱 선택 읽기 — sourcing이 등록한 함수) */
  private async isUncompared(db: Db, candidateId: number): Promise<boolean> {
    const step = await db.candidateStep.findUnique({
      where: { candidateId_stepCode: { candidateId, stepCode: 'SOURCING' } },
      select: { currentStepRunId: true },
    });
    const reader = this.ports.sourcingSelectionReader;
    if (!step?.currentStepRunId || !reader) return false;
    const selection = await reader.read(db, step.currentStepRunId);
    return selection !== null && !selection.comparisonPerformed;
  }

  async confirm(candidateId: number): Promise<NoComparisonConfirmationDto> {
    await this.guard.findOr404(this.prisma, candidateId);
    return this.transactions.run(async (scope) => {
      const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
      this.guard.assertMutable(candidate);
      if (!(await this.isUncompared(scope.tx, candidateId))) {
        throw new ApiException('CONFIRMATION_NOT_APPLICABLE');
      }
      if (candidate.noComparisonConfirmedAt !== null) {
        return {
          candidateId,
          noComparisonConfirmedAt: candidate.noComparisonConfirmedAt.toISOString(),
        };
      }
      await scope.tx.candidate.update({
        where: { id: candidateId },
        data: { noComparisonConfirmedAt: scope.now },
      });
      await this.audit.record(
        {
          eventType: 'OWNER_CONFIRMED',
          candidateId,
          stepCode: 'PRICING',
          detail: { confirmation: NO_COMPARISON_CONFIRMATION },
          occurredAt: scope.now,
        },
        scope.tx,
      );
      return { candidateId, noComparisonConfirmedAt: scope.now.toISOString() };
    });
  }

  async revoke(candidateId: number): Promise<void> {
    await this.guard.findOr404(this.prisma, candidateId);
    await this.transactions.run(async (scope) => {
      const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
      this.guard.assertMutable(candidate);
      if (candidate.noComparisonConfirmedAt === null) return;
      const gates = await this.gateValidity.evaluate(scope.tx, candidateId);
      if (gates.G2.valid) {
        throw new ApiException('GATE_ALREADY_PASSED', {
          details: { gate: 'G2', gatePassId: gates.G2.gatePassId },
        });
      }
      await scope.tx.candidate.update({
        where: { id: candidateId },
        data: { noComparisonConfirmedAt: null },
      });
      await this.audit.record(
        {
          eventType: 'OWNER_EDITED',
          candidateId,
          stepCode: 'PRICING',
          detail: { confirmation: NO_COMPARISON_CONFIRMATION, action: 'REVOKED' },
          occurredAt: scope.now,
        },
        scope.tx,
      );
    });
  }
}
