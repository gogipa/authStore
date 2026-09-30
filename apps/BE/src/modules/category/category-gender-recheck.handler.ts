import { Injectable } from '@nestjs/common';
import { ProgressEventsService } from '../../common/events/progress-events.service.js';
import { CommerceMetaCacheService } from '../integrations/commerce-meta/commerce-meta-cache.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { StepEngineTx } from '../step-engine/candidates/step-engine-tx.js';
import { INPUT_KEYS } from '../step-engine/domain/input-keys.js';
import type { GenderInputListener } from '../step-engine/ports/gender-input.port.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import { CategoryDecisionRepository } from './category-decision.repository.js';
import {
  CATEGORY_NO_SELECTABLE_MESSAGE,
  CATEGORY_NO_SELECTABLE_OPTION,
  CATEGORY_PENDING_INPUT,
  CATEGORY_WAITING_REASON,
  categoryWordRulesOf,
  leavesForOptions,
  optionViewOf,
} from './category-sources.js';
import { categoryOptionsOf } from './rules/category-options.js';

/**
 * ④ 성별 재확인(F-CA-05, P2-06 규칙 14 — §5 `category-gender-recheck.handler.ts`). P1-04 `PUT /candidates/{id}/gender`가
 * 오너 성별을 쓴 **같은 트랜잭션**에서 step-engine을 거쳐 부른다(`StepEngineApi.registerGenderInputListener`, 앱 시작 때 끼운다).
 *
 * ④ 현재 버전이 입력 대기이고 결정의 성별과 다르면 **같은 실행 안에서**:
 * 1. 새 성별로 리프 후보를 다시 뽑아 `category_decision`의 `gender`·`candidate_source`·`category_options`를 바꾸고
 *    `gender_changed_in_run=true`로 둔다(재확인 뒤에는 자동 완료하지 않는다 — 오너가 ④ 화면에 있다, Proposed)
 * 2. 이 실행의 입력 기록(`candidate.gender` — 값 해시·출처 OWNER_INPUT)과 시작 지문을 새 값으로 맞춘다
 *    (`StepEngineApi.refreshWaitingRunInputs`) — 입력 대기 중 시작 조건 변경은 원래 '재실행 필요'(F-CW-18)지만 ④ 성별 재확인은
 *    같은 실행에서 이어 가는 예외다. 맞추지 않으면 끝 지문이 달라 방금 고른 ④가 '재실행 필요'로 남는다(§8)
 * 3. 새 성별로 고를 수 있는 후보가 없으면 ④를 실패로 닫는다(Proposed — 고를 후보가 없을 때와 같은 코드)
 * ③·⑥-3·⑦의 '재실행 필요'는 P1-04 `CandidateGenderService`가 한다(④ 자신은 바꾸지 않는다). 같은 성별이면 아무것도 하지 않는다.
 * 이어 간 ④ 실행 id를 돌려준다(응답 `resumedStepRunIds`).
 */
@Injectable()
export class CategoryGenderRecheckHandler implements GenderInputListener {
  constructor(
    private readonly api: StepEngineApi,
    private readonly cache: CommerceMetaCacheService,
    private readonly decisions: CategoryDecisionRepository,
    private readonly settings: SettingsService,
    private readonly events: ProgressEventsService,
  ) {}

  async onOwnerGender(
    scope: StepEngineTx,
    input: { candidateId: number; gender: 'MALE' | 'FEMALE' },
  ): Promise<number[]> {
    const step = await scope.tx.candidateStep.findUnique({
      where: { candidateId_stepCode: { candidateId: input.candidateId, stepCode: 'CATEGORY' } },
      select: { currentStepRunId: true },
    });
    if (!step?.currentStepRunId) return [];
    const run = await scope.tx.stepRun.findUnique({ where: { id: step.currentStepRunId } });
    if (!run || run.status !== 'WAITING_INPUT') return [];
    const decision = await this.decisions.findByStepRun(scope.tx, run.id);
    if (!decision || decision.gender === input.gender) return [];

    // ② 장르는 이 실행이 읽은 ② 버전에서 다시 읽는다(없으면 결정에 남긴 장르 id 하나)
    const genreRow = await scope.tx.stepRunInput.findFirst({
      where: { stepRunId: run.id, inputKey: INPUT_KEYS.sourcingGenre },
      select: { sourceStepRunId: true },
    });
    const genre = genreRow?.sourceStepRunId
      ? await this.api.readSourcingGenre(genreRow.sourceStepRunId, scope.tx)
      : null;
    const genreIdPath =
      genre?.genreIdPath ?? (decision.inputGenreId !== null ? [decision.inputGenreId] : []);
    const productType = genre?.productType ?? decision.inputProductType;
    const settings = this.settings.current();
    const rules = categoryWordRulesOf(settings);
    const leaves = await leavesForOptions(this.cache, {
      gender: input.gender,
      genreIdPath,
      productType,
      settings,
    });
    const result = categoryOptionsOf({
      gender: input.gender,
      genreIdPath,
      productType,
      mapping: settings.category.leafMapping,
      leaves,
      childCategoryWords: rules.childCategoryWords,
    });
    await this.decisions.applyGenderRecheck(scope.tx, decision.id, {
      gender: input.gender,
      candidateSource: result.candidateSource,
      categoryOptions: result.options,
    });
    await this.api.refreshWaitingRunInputs(scope, run.id, [INPUT_KEYS.candidateGender]);

    const views = await this.cache.findCategories(result.options.map((o) => o.leafCategoryId));
    const byId = new Map(views.map((v) => [v.categoryId, v]));
    const selectable = result.options.filter(
      (o) => !optionViewOf(o, byId.get(o.leafCategoryId) ?? null, rules, input.gender).blocked,
    );
    if (selectable.length === 0) {
      await this.api.resumeWaiting(run.id, {
        scope,
        outcome: {
          kind: 'FAILED',
          failureKind: 'INPUT_VALIDATION',
          errorCode: CATEGORY_NO_SELECTABLE_OPTION,
          errorMessage: CATEGORY_NO_SELECTABLE_MESSAGE,
        },
      });
      return [];
    }
    // 같은 실행이 새 후보로 계속 기다린다 — 다른 화면이 결정을 다시 읽게 알린다(상태는 그대로 입력 대기)
    const occurredAt = scope.now.toISOString();
    scope.afterCommit(() => {
      this.events.publish('step-run.status-changed', {
        stepRunId: run.id,
        candidateId: run.candidateId,
        stepCode: 'CATEGORY',
        version: run.version,
        executionMode: run.executionMode as 'STEP',
        stepChainId: run.stepChainId,
        status: 'WAITING_INPUT',
        waitingReasonCode: CATEGORY_WAITING_REASON,
        pendingInputs: [CATEGORY_PENDING_INPUT],
        occurredAt,
      });
    });
    return [run.id];
  }
}
