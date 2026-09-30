import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';
import type { StepEngineTx } from '../step-engine/candidates/step-engine-tx.js';
import type { GenderInputListener } from '../step-engine/ports/gender-input.port.js';
import { AnchorService } from './anchor.service.js';
import { ComparisonScope } from './comparison-scope.js';
import { SourcingComparisonRepository } from './sourcing-comparison.repository.js';

/**
 * 오너 성별 입력을 열린 ②에 넘긴다(05-2 setCandidateGender '열린 ②가 성별을 기다리면 sourcing_comparison.owner_gender로
 * 넘겨 이어 가고', F-SO-19, P2-03). `StepEngineApi.registerGenderInputListener`로 앱 시작 때 끼운다.
 * 현재 ② 버전이 앵커가 있는 검색·비교 버전이고 입력 대기면: `owner_gender`를 쓰고, 검증 행을 새 성별의 목표 사이즈로 다시
 * 계산한다(페이지를 다시 읽지 않는다). 아직 페이지 조회를 하지 않았으면(성별을 몰라 멈춤) 커밋 뒤 앵커 뒤 작업을 이어 간다.
 * 이어 간(값을 넘긴) 실행 id를 돌려준다(응답 `resumedStepRunIds`). URL로 만들기 버전은 성별을 기다리지 않는다(P2-02 결정 유지).
 */
@Injectable()
export class SourcingGenderListener implements GenderInputListener {
  constructor(
    private readonly repo: SourcingComparisonRepository,
    private readonly anchors: AnchorService,
    private readonly scope: ComparisonScope,
    private readonly settings: SettingsService,
  ) {}

  async onOwnerGender(
    scope: StepEngineTx,
    input: { candidateId: number; gender: 'MALE' | 'FEMALE' },
  ): Promise<number[]> {
    const step = await scope.tx.candidateStep.findUnique({
      where: { candidateId_stepCode: { candidateId: input.candidateId, stepCode: 'SOURCING' } },
      select: { currentStepRunId: true },
    });
    if (!step?.currentStepRunId) return [];
    const head = await scope.tx.sourcingComparison.findUnique({
      where: { stepRunId: step.currentStepRunId },
      include: { stepRun: true },
    });
    if (
      !head ||
      head.stepRun.status !== 'WAITING_INPUT' ||
      !head.comparisonPerformed ||
      head.anchorInputMethod === null
    ) {
      return [];
    }
    const updated = await scope.tx.sourcingComparison.update({
      where: { id: head.id },
      data: { ownerGender: input.gender },
    });
    const candidate = await scope.tx.candidate.findUniqueOrThrow({
      where: { id: input.candidateId },
    });
    const ctx = await this.repo.contextOf(scope.tx, updated, candidate, this.settings.current());
    const rows = await scope.tx.sourcingComparisonRow.findMany({
      where: { sourcingComparisonId: head.id, isVerified: true },
      select: { id: true },
    });
    await this.repo.recalculateVerifiedRows(scope.tx, updated, ctx);
    for (const { id } of rows) {
      this.scope.publishRowUpdated(
        scope,
        input.candidateId,
        await scope.tx.sourcingComparisonRow.findUniqueOrThrow({ where: { id } }),
      );
    }
    const fetched = await scope.tx.sourcingComparisonRow.count({
      where: { sourcingComparisonId: head.id, fetchOrder: { not: null } },
    });
    if (fetched === 0) scope.afterCommit(() => this.anchors.startJob(head.id));
    return [head.stepRunId];
  }
}
