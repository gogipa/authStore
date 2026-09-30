import { Injectable } from '@nestjs/common';
import { UserActionLogService } from '../../common/audit/user-action-log.service.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CandidateGuardService } from '../step-engine/candidates/candidate-guard.service.js';
import { StepEngineTransactions } from '../step-engine/candidates/step-engine-tx.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import { needsAdultConfirmation } from './entry-checks.js';
import { urlCreateEffects } from './url-candidate.extension.js';

/** 05-2 AdultProductConfirmation */
export interface AdultProductConfirmationResult {
  sourcingComparisonId: number;
  stepRunId: number;
  adultProductConfirmedAt: string;
  stepStatus: string;
}

/**
 * '성인용 상품 확인'(F-SO-06, 05-2 confirmSourcingAdultProduct, P2-02 규칙 13). 웹 화면 요청만(가드 헤더).
 * 검사 순서: 404 SOURCING_COMPARISON_NOT_FOUND → 409 CONFIRMATION_NOT_APPLICABLE(아동화 의심·장르 문제가 아님) →
 * 이미 체크했으면 기존 시각(멱등, 200) → 409 STEP_RUN_NOT_WAITING_INPUT(② 버전이 입력 대기가 아님).
 * 한 트랜잭션: `adult_product_confirmed_at`(열린 버전에만 — trg_output_frozen) + `user_action_log`(OWNER_CONFIRMED,
 * detail {confirmation: ADULT_PRODUCT}) + 멈춘 ② 잇기. URL로 만들기·재조회 버전은 이 확인만 기다리므로 ②를 완료로 닫고
 * (앵커 확정·② 자동 성별), 검색·비교 버전은 확인만 남기고 선택을 계속 기다린다(P2-03). ④ 'KC 면제 성인용 확인'
 * (category_decision)과 필드·기록을 나눈다(ERD 결정 ⑨).
 */
@Injectable()
export class AdultConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly audit: UserActionLogService,
    private readonly api: StepEngineApi,
  ) {}

  async confirm(sourcingComparisonId: number): Promise<AdultProductConfirmationResult> {
    const found = await this.prisma.sourcingComparison.findUnique({
      where: { id: sourcingComparisonId },
      select: { stepRun: { select: { candidateId: true } } },
    });
    if (!found) throw new ApiException('SOURCING_COMPARISON_NOT_FOUND');
    return this.transactions.run(async (scope) => {
      await this.guard.lockForUpdate(scope.tx, found.stepRun.candidateId);
      const head = await scope.tx.sourcingComparison.findUniqueOrThrow({
        where: { id: sourcingComparisonId },
        include: { stepRun: true },
      });
      if (!needsAdultConfirmation(head)) throw new ApiException('CONFIRMATION_NOT_APPLICABLE');
      if (head.adultProductConfirmedAt !== null) {
        return {
          sourcingComparisonId: head.id,
          stepRunId: head.stepRunId,
          adultProductConfirmedAt: head.adultProductConfirmedAt.toISOString(),
          stepStatus: head.stepRun.status,
        };
      }
      if (head.stepRun.status !== 'WAITING_INPUT') {
        throw new ApiException('STEP_RUN_NOT_WAITING_INPUT');
      }
      const confirmedAt = scope.now;
      await scope.tx.sourcingComparison.update({
        where: { id: head.id },
        data: { adultProductConfirmedAt: confirmedAt },
      });
      await this.audit.record(
        {
          eventType: 'OWNER_CONFIRMED',
          candidateId: head.stepRun.candidateId,
          stepRunId: head.stepRunId,
          stepCode: 'SOURCING',
          detail: { confirmation: 'ADULT_PRODUCT', sourcingComparisonId: head.id },
          occurredAt: confirmedAt,
        },
        scope.tx,
      );
      let stepStatus = head.stepRun.status;
      if (head.action === 'URL_CREATE' || head.action === 'REFETCH') {
        const closed = await this.api.resumeWaiting(head.stepRunId, {
          scope,
          outcome: {
            kind: 'COMPLETED',
            output: { action: 'RESUMED' },
            candidateEffects: head.action === 'URL_CREATE' ? urlCreateEffects(head) : undefined,
          },
        });
        stepStatus = closed.status;
      }
      return {
        sourcingComparisonId: head.id,
        stepRunId: head.stepRunId,
        adultProductConfirmedAt: confirmedAt.toISOString(),
        stepStatus,
      };
    });
  }
}
