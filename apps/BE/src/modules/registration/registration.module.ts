import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { StepEngineModule } from '../step-engine/step-engine.module.js';
import { ApprovalController } from './approval/approval.controller.js';
import { ApprovalService } from './approval/approval.service.js';
import { ApproveService } from './approval/approve.service.js';
import { ApprovalInputsLoader } from './draft/approval-inputs.loader.js';
import { DuplicateService } from './duplicate/duplicate.service.js';
import { PreValidationService } from './pre-validation/pre-validation.service.js';
import { RegisterStepRunner } from './register/register.step-runner.js';
import { RegistrationQueryService } from './registration-query.service.js';
import { RegistrationController } from './registration.controller.js';
import {
  REGISTRATION_RESTART_CHECK,
  RegistrationRestartCheck,
  ResultCheckService,
} from './result-check/result-check.service.js';
import { RegistrationSubmitter } from './submit/registration-submitter.js';
import { RegistrationSwitchController } from './switch/registration-switch.controller.js';
import { RegistrationSwitchService } from './switch/registration-switch.service.js';
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
 * P4-02 G4 승인 미리보기·사전 검증:
 * - `draft/` 입력 읽기 `ApprovalInputsLoader`(앞 단계 현재 버전 산출물은 step-engine 읽기 창구로만 — `readPricingJudgement`·
 *   `readCategoryDecision`·`readThumbnailSelectionDetail`·`readContent*`·`readFinalTags`) + 요청 초안 빌더(순수
 *   `buildRegistrationDraft` — P4-03 등록이 그대로 쓴다)
 * - `pre-validation/` 검사 15개(`checks/*.check.ts` — 항목 하나 = 파일 하나 = 순수 함수)와 `PreValidationService`(restricted-tags
 *   재조회 — integrations `COMMERCE_TAGS_PORT`, 시계 `CLOCK`). P4-03 승인 직전 재검증이 같은 서비스를 부른다
 * - `approval/` API: `GET /candidates/{id}/approval`, `POST /candidates/{id}/pre-validations`
 * P4-03 ⑨ 등록·차단 스위치·결과 확인:
 * - ⑨ 실행기 `RegisterStepRunner`(`@StepRunnerFor('REGISTER')` — 입력 지문·재시작 훅만. 단계 실행 API는 엔진이 422로 막는다)
 * - `approval/approve.service.ts` G4 승인(검사 순서·재검증·드라이런/선커밋), `approval/idempotency.ts`(Idempotency-Key)
 * - `submit/` 커밋 뒤 등록 호출·결과 반영(`RegistrationSubmitter` — 앱 전체 직렬, `register-outcome` 순수 분류)
 * - `result-check/` 결과확인 조회(`ResultCheckService`)와 재시작 자동 조회(`RegistrationRestartCheck`, F-BS-18)
 * - `duplicate/` SELLER_CODE 교차 확인·`SAME_MODEL_REGISTERED` 경고(`DuplicateService`), `errors/` invalidInputs 번역기
 * - `switch/` 등록 API 차단 스위치, `registration-query.service.ts` 이력·상세
 * - 커머스API는 integrations `COMMERCE_PRODUCTS_PORT`로만, ⑨ 버전은 `StepEngineApi.openRegisterRun`·`closeRegisterRun`으로만
 * - API: `POST·GET /candidates/{id}/registrations`, `GET /registrations/{id}`, `POST /registrations/{id}/result-checks`,
 *   `GET·PUT /registration-switch`
 */
@Module({
  imports: [IntegrationsModule, SettingsModule, StepEngineModule],
  controllers: [
    UploadResultController,
    ApprovalController,
    RegistrationController,
    RegistrationSwitchController,
  ],
  providers: [
    UploadStepRunner,
    ImageUploadService,
    UploadQueue,
    UploadResultService,
    ApprovalInputsLoader,
    PreValidationService,
    ApprovalService,
    RegisterStepRunner,
    DuplicateService,
    RegistrationSwitchService,
    RegistrationSubmitter,
    ApproveService,
    ResultCheckService,
    RegistrationRestartCheck,
    { provide: REGISTRATION_RESTART_CHECK, useValue: { enabled: true } },
    RegistrationQueryService,
  ],
})
export class RegistrationModule {}
