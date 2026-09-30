import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { StepEngineModule } from '../step-engine/step-engine.module.js';
import { ThumbnailPromptPreviewsController } from './prompt/thumbnail-prompt-previews.controller.js';
import { ThumbnailPromptPreviewsService } from './prompt/thumbnail-prompt-previews.service.js';
import { ThumbnailReferenceRepository } from './references/thumbnail-reference.repository.js';
import { ThumbnailReferencesController } from './references/thumbnail-references.controller.js';
import { ThumbnailReferencesService } from './references/thumbnail-references.service.js';
import { OriginalImageStore } from './source-images/original-image.store.js';
import { SourceImageDownloader } from './source-images/source-image.downloader.js';
import { SourceImagesController } from './source-images/source-images.controller.js';
import { SourceImagesService } from './source-images/source-images.service.js';
import { ThumbnailStepRunner } from './thumbnail-step.runner.js';

/**
 * ⑤ 썸네일(P3-01 준비 — 03-ADR-003 모듈 경계). 다른 단계 모듈은 import하지 않는다.
 * - `ThumbnailStepRunner`(`@StepRunnerFor('THUMBNAIL')`): ② 선택 상품 원본 받기 → 레퍼런스 기본값 복사 → 입력 대기. ② 산출물은
 *   step-engine 창구(`StepEngineApi.readSourcingImages`)로만 읽는다. 입력 지문은 설정 두 키뿐(P3-01 규칙 2)
 * - 원본 받기 `SourceImageDownloader`: integrations 라쿠텐 이미지 포트(관문 RAKUTEN_IMAGE)·Item Search 포트(`_ex` 대체) +
 *   common 이미지 저장(P1-01 `ImageAssetsService` — 전역 CommonModule)
 * - API: `GET /candidates/{id}/source-images`, `PUT /step-runs/{id}/thumbnail-references`, `POST /thumbnail-prompt-previews`
 * - P3-02가 같은 모듈 안에서 다시 쓰는 순수 함수: `prompt/prompt-builder.ts`(`buildPrompt`), `prompt/real-person-guard.ts`
 *   (`findBlockedTerms`·`personBlockDictionary`), `references/reference-set-hash.ts`(`referenceSetSha256`),
 *   `thumbnail-anchor.ts`(`isSameAnchor`), `prompt/thumbnail-prompt-previews.service.ts`(`checkThumbnailPrompt`)
 * - 감사 기록은 common `UserActionLogService`(OWNER_CONFIRMED — '사람·얼굴 없음' 확인)
 */
@Module({
  imports: [IntegrationsModule, SettingsModule, StepEngineModule],
  controllers: [
    SourceImagesController,
    ThumbnailReferencesController,
    ThumbnailPromptPreviewsController,
  ],
  providers: [
    ThumbnailReferenceRepository,
    OriginalImageStore,
    SourceImageDownloader,
    SourceImagesService,
    ThumbnailReferencesService,
    ThumbnailPromptPreviewsService,
    ThumbnailStepRunner,
  ],
})
export class ThumbnailsModule {}
