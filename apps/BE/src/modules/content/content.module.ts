import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { StepEngineModule } from '../step-engine/step-engine.module.js';
import { ContentCopyController } from './copy/content-copy.controller.js';
import { ContentCopyService } from './copy/content-copy.service.js';
import { CopyOwnerEditHandler } from './copy/copy-owner-edit.handler.js';
import { CopyStepRunner } from './copy/copy-step.runner.js';
import { ContentFactController } from './facts/content-fact.controller.js';
import { ContentFactService } from './facts/content-fact.service.js';
import { ContentFieldsController } from './facts/content-fields.controller.js';
import { ContentFieldsService } from './facts/content-fields.service.js';
import { FactOwnerEditHandler } from './facts/fact-owner-edit.handler.js';
import { NoticeRawStepRunner } from './facts/notice-raw-step.runner.js';
import { OriginInputResolver } from './facts/origin-input.resolver.js';
import { SpecImageCollector } from './facts/spec-image.collector.js';

/**
 * ⑥ 상세 콘텐츠(03-ADR-003 모듈 경계 — 다른 단계 모듈은 import하지 않는다). P3-03: ⑥-1 카피·⑥-2 사양 추출(근거 포함).
 * ⑥-3 고시·사양·고지·HTML은 P3-04가 더한다.
 * - 실행기 둘(P1-05 `@StepRunnerFor` — step-engine 레지스트리가 모은다): `CopyStepRunner`(COPY, AI 텍스트)·`NoticeRawStepRunner`
 *   (NOTICE_RAW, 규칙 추출 → AI 비전·텍스트). ② 산출물은 step-engine 창구(`StepEngineApi.readSourcingItemContent`)로만 읽는다
 * - 오너 수정 처리기 둘(실행기 `copyOutput`이 부른다 — step-engine owner-edits): `CopyOwnerEditHandler`(EDIT·KEEP_AS_IS·
 *   RESTORE_VERSION)·`FactOwnerEditHandler`(EDIT·RESTORE_VERSION, 재확인 해소)
 * - AI는 P1-10 `AiExecutor`(integrations)로만, 스펙 이미지는 라쿠텐 이미지 포트(관문 RAKUTEN_IMAGE) + P1-01 이미지 저장, 원산지
 *   나라 검사는 설정 사전(P1-03 `SettingsService`) + 원산지 캐시(`CommerceMetaCacheService.findOriginAreasByCountry`)
 * - API: `GET /candidates/{id}/content-copy`, `GET /candidates/{id}/content-fact`, `PUT /step-runs/{id}/content-fields/{fieldKey}`
 */
@Module({
  imports: [IntegrationsModule, SettingsModule, StepEngineModule],
  controllers: [ContentCopyController, ContentFactController, ContentFieldsController],
  providers: [
    CopyStepRunner,
    CopyOwnerEditHandler,
    ContentCopyService,
    NoticeRawStepRunner,
    FactOwnerEditHandler,
    OriginInputResolver,
    SpecImageCollector,
    ContentFactService,
    ContentFieldsService,
  ],
})
export class ContentModule {}
