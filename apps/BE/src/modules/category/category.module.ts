import { Module, type OnModuleInit } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { StepEngineModule } from '../step-engine/step-engine.module.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import { CategoryDecisionRepository } from './category-decision.repository.js';
import { CategoryDecisionsController } from './category-decisions.controller.js';
import { CategoryDecisionsService } from './category-decisions.service.js';
import { CategoryGenderRecheckHandler } from './category-gender-recheck.handler.js';
import { categoryOutputReader } from './category-output.reader.js';
import { CategoryStepRunner } from './category-step.runner.js';

/**
 * ④ 카테고리: 네이버 리프 카테고리 결정·KC 확인(P2-06, 03-ADR-003 모듈 경계).
 * - `CategoryStepRunner`(`@StepRunnerFor('CATEGORY')`): 매핑표(설정 `category.leafMapping`) + 메타 캐시 리프(integrations
 *   `CommerceMetaCacheService` — 카테고리 id는 여기서만) + 후보 성별 → 리프 후보(`rules/category-options.ts`). ② 장르·상품유형은
 *   step-engine 창구(`StepEngineApi.readSourcingGenre`)로만 읽는다(sourcing import 없음)
 * - 예외 판단(`rules/category-exception.ts`)과 성별 경로 판정(공용 `common/rules/category-gender.ts` — P4-02 최종 승인 검사도 쓴다)
 * - API: `GET /candidates/{id}/category-decision`, `PUT /category-decisions/{id}/selection`(④ 완료 — step-engine
 *   `resumeWaiting({ outcome })` 한 번으로 후보 리프·뒷단계 재실행 필요까지 묶는다)
 * - 성별 재확인(`CategoryGenderRecheckHandler`): P1-04 성별 입력이 입력 대기 중인 ④를 만나면 같은 실행에서 후보를 다시 뽑는다.
 *   앱 시작 때 `StepEngineApi.registerGenderInputListener`로 끼운다(엔진 → 단계 방향만)
 * - 감사 기록은 common `UserActionLogService`(CATEGORY_DECISION)
 * - P4-02: ④ 결정 읽기(`category-output.reader.ts`)를 앱 시작 때 `StepEngineApi.registerCategoryOutputReader`로 끼운다 — 최종 승인
 *   사전 검증(registration)이 step-engine을 거쳐 읽는다
 */
@Module({
  imports: [IntegrationsModule, SettingsModule, StepEngineModule],
  controllers: [CategoryDecisionsController],
  providers: [
    CategoryDecisionRepository,
    CategoryDecisionsService,
    CategoryStepRunner,
    CategoryGenderRecheckHandler,
  ],
})
export class CategoryModule implements OnModuleInit {
  constructor(
    private readonly api: StepEngineApi,
    private readonly genderRecheck: CategoryGenderRecheckHandler,
  ) {}

  onModuleInit(): void {
    this.api.registerGenderInputListener(this.genderRecheck);
    this.api.registerCategoryOutputReader(categoryOutputReader);
  }
}
