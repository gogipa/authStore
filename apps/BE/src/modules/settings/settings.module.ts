import { Module } from '@nestjs/common';
import { SettingsFileLoader } from './settings-file.loader.js';
import { noopSettingsRerunPropagator, SETTINGS_RERUN_PROPAGATOR } from './settings-rerun.port.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/**
 * 설정(P1-03): 설정 JSON 파일 로더·JSON Schema·안전 기준 하한·settings_snapshot, GET /settings·POST /settings-snapshots.
 * 다른 모듈은 `SettingsService.current()`·`currentSnapshotId()`만 쓴다(파일을 직접 읽지 않는다). 그래서
 * `SettingsFileLoader`는 export하지 않는다(규칙 14).
 * 뒤에 더할 것: AI 엔진 선택 저장(P1-11, 이 모듈 안에서 `SettingsFileLoader.write`), 프로필(P1-09), 요금표(P2-04).
 */
@Module({
  controllers: [SettingsController],
  providers: [
    SettingsFileLoader,
    SettingsService,
    { provide: SETTINGS_RERUN_PROPAGATOR, useValue: noopSettingsRerunPropagator },
  ],
  exports: [SettingsService],
})
export class SettingsModule {}
