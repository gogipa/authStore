import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { StepEngineModule } from '../step-engine/step-engine.module.js';
import { ImageUploadService } from './upload/image-upload.service.js';
import { UploadQueue } from './upload/upload-queue.js';
import { UploadResultController } from './upload/upload-result.controller.js';
import { UploadResultService } from './upload/upload-result.service.js';
import { UploadStepRunner } from './upload/upload.step-runner.js';

/**
 * ⑧⑨ 업로드·최종 승인(G4)·등록(선커밋 → 외부 호출 → 결과 갱신)·결과 확인(03-ADR-003 모듈 경계 — 다른 단계 모듈은 import하지
 * 않는다). P4-01 ⑧ 이미지 업로드(`upload/`):
 * - 실행기 `UploadStepRunner`(UPLOAD, AI 없음 — P1-05 `@StepRunnerFor`로 step-engine 레지스트리에 등록): ⑤ G3 선택본·⑥-3 HTML은
 *   step-engine 창구(`readThumbnailSelectionOf`·`readNoticeHtml`)로만 읽는다
 * - `ImageUploadService`(참조 전용 거부 → 해시 재사용 → 정규화 → 직렬 묶음 업로드 → `uploaded_image`), 앱 전체 직렬 큐
 *   `UploadQueue`, 순수 함수 `upload-batcher`·`image-normalizer`·`detail-content`·`upload-inputs`
 * - 커머스API는 integrations `COMMERCE_IMAGES_PORT`로만, 키 확인은 공용 `SECRET_STORE`, 이미지 파일은 common `ImageAssetsService`
 * - API: `GET /candidates/{id}/upload-result`
 * P4-02·P4-03(승인 미리보기·사전 검증·등록)이 이 모듈에 더한다.
 */
@Module({
  imports: [IntegrationsModule, StepEngineModule],
  controllers: [UploadResultController],
  providers: [UploadStepRunner, ImageUploadService, UploadQueue, UploadResultService],
})
export class RegistrationModule {}
