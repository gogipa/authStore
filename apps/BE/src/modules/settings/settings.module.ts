import { forwardRef, Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { DispatchDeliveryCompaniesController } from './dispatch-delivery-companies/dispatch-delivery-companies.controller.js';
import { DispatchDeliveryCompaniesService } from './dispatch-delivery-companies/dispatch-delivery-companies.service.js';
import {
  noopProfileRerunPropagator,
  PROFILE_RERUN_PROPAGATOR,
} from './purchase-agency-profile/profile-rerun.port.js';
import { PurchaseAgencyProfileController } from './purchase-agency-profile/purchase-agency-profile.controller.js';
import { PurchaseAgencyProfileService } from './purchase-agency-profile/purchase-agency-profile.service.js';
import { SettingsFileLoader } from './settings-file.loader.js';
import { noopSettingsRerunPropagator, SETTINGS_RERUN_PROPAGATOR } from './settings-rerun.port.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/**
 * 설정(P1-03): 설정 JSON 파일 로더·JSON Schema·안전 기준 하한·settings_snapshot, GET /settings·POST /settings-snapshots.
 * 다른 모듈은 `SettingsService.current()`·`currentSnapshotId()`만 쓴다(파일을 직접 읽지 않는다). 그래서
 * `SettingsFileLoader`는 export하지 않는다(규칙 14).
 *
 * P1-09 구매대행 프로필: GET·PUT /purchase-agency-profile, GET /dispatch-delivery-companies.
 * - `PurchaseAgencyProfileService`를 export한다(⑥-3 P3-04·G4 P4-02·⑨ P4-03). ⑨ 요청 조각 `buildProfileFragment`,
 *   고정값 `PROFILE_FIXED_VALUES`, 입력 이름 `profileStepInputs`는 purchase-agency-profile/ 아래 순수 함수·상수다
 * - 주소록·반품 택배사 캐시는 integrations의 `CommerceMetaCacheService`로 읽는다. integrations가 이미 settings를
 *   import하므로(하루 조회 상한) 두 모듈은 서로 `forwardRef`로 부른다(C4 §3 Proposed P1-09)
 * - 재실행 필요 전파는 PROFILE_RERUN_PROPAGATOR(기본 0) — step-engine이 onModuleInit에서 `setRerunPropagator`로 끼운다
 *
 * 뒤에 더할 것: AI 엔진 선택 저장(P1-11, 이 모듈 안에서 `SettingsFileLoader.write`), 요금표(P2-04).
 */
@Module({
  imports: [forwardRef(() => IntegrationsModule)],
  controllers: [
    SettingsController,
    PurchaseAgencyProfileController,
    DispatchDeliveryCompaniesController,
  ],
  providers: [
    SettingsFileLoader,
    SettingsService,
    { provide: SETTINGS_RERUN_PROPAGATOR, useValue: noopSettingsRerunPropagator },
    PurchaseAgencyProfileService,
    { provide: PROFILE_RERUN_PROPAGATOR, useValue: noopProfileRerunPropagator },
    DispatchDeliveryCompaniesService,
  ],
  exports: [SettingsService, PurchaseAgencyProfileService],
})
export class SettingsModule {}
