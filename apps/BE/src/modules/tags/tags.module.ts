import { Module, type OnModuleInit } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import { StepEngineModule } from '../step-engine/step-engine.module.js';
import { CompetitorInputsController } from './competitor-inputs/competitor-inputs.controller.js';
import { CompetitorInputsService } from './competitor-inputs/competitor-inputs.service.js';
import { TagSetController } from './tag-set.controller.js';
import { TagSetService } from './tag-set.service.js';
import { TagsOwnerEditHandler } from './tags-owner-edit.handler.js';
import { tagsOutputReader } from './tags-output.reader.js';
import { TagsStepRunner } from './tags-step.runner.js';

/**
 * ⑦ 태그(03-ADR-003 모듈 경계 — 다른 단계 모듈은 import하지 않는다, P3-05).
 * - 실행기 `TagsStepRunner`(TAGS, AI 없음 — P1-05 `@StepRunnerFor`로 step-engine 레지스트리에 등록): 추천 조회 → 정규화 → 규칙
 *   필터 → restricted-tags 1차 검증 → 선정(최대 10개). ② 값은 step-engine 창구(`readSourcingItemContent`·`readSourcingGenre`)로,
 *   ④ 리프 경로는 엔진이 넘기는 후보 값으로 받는다. ⑤·⑥은 읽지 않는다
 * - 오너 수정 `TagsOwnerEditHandler`(owner-edits TAGS EDIT 202·RESTORE_VERSION — 실행기 `checkOwnerEdit`·`run`·`copyOutput`)
 * - 커머스API는 integrations `COMMERCE_TAGS_PORT`(recommend-tags·restricted-tags)로만, 키 확인은 공용 `SECRET_STORE`
 * - API: `GET /candidates/{id}/tag-set`, `GET·POST /candidates/{id}/tag-competitor-inputs`, `DELETE /tag-competitor-inputs/{id}`
 * - 순수 함수: `pipeline/`(normalize·rule-filter·select-final·request-format·tag-pool·restricted-check·evaluate),
 *   `competitor-inputs/parsers/`(셀라파인더·브라우저 응답·자유 텍스트 — 태그·순위·상품 ID·빈도만 돌려준다)
 * - P4-02: ⑦ 최종 태그 읽기(`tags-output.reader.ts`)를 앱 시작 때 `StepEngineApi.registerTagsOutputReader`로 끼운다 — 최종 승인
 *   미리보기·사전 검증(registration)이 읽는다
 */
@Module({
  imports: [IntegrationsModule, SettingsModule, StepEngineModule],
  controllers: [TagSetController, CompetitorInputsController],
  providers: [TagsStepRunner, TagsOwnerEditHandler, TagSetService, CompetitorInputsService],
})
export class TagsModule implements OnModuleInit {
  constructor(private readonly api: StepEngineApi) {}

  onModuleInit(): void {
    this.api.registerTagsOutputReader(tagsOutputReader);
  }
}
