import { Module } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AiCliCheckRecorder } from './ai-cli-checks/ai-cli-check.recorder.js';
import { AiCliChecksController } from './ai-cli-checks/ai-cli-checks.controller.js';
import { AiCliChecksService } from './ai-cli-checks/ai-cli-checks.service.js';
import { AiEngineAvailabilityService } from './ai-cli-checks/ai-engine-availability.service.js';
import {
  AI_ENGINE_STARTUP_CHECK,
  AiEngineStartupCheck,
  type AiEngineStartupCheckOptions,
} from './ai-cli-checks/ai-engine-startup.check.js';
import { CommerceAuthController } from './commerce-auth/commerce-auth.controller.js';
import { CommerceAuthStatusService } from './commerce-auth/commerce-auth-status.service.js';
import { SecretsController } from './secrets/secrets.controller.js';
import { SecretsService } from './secrets/secrets.service.js';

/**
 * 관리: 시스템 상태·첫 실행 점검·키체인 키 상태·로그,
 * AI 엔진 감지·연결 테스트 기록(ai_cli_check) 소유(D-16).
 * 메타데이터 동기화(commerce_meta_sync_run·캐시)는 integrations 소유다(ERD §3.12·05-2 태그 integrations, P1-08).
 * SCR-11 화면이 그 상태를 보여 줄 뿐이다.
 * P1-07: 키 입력(GET·PUT /secrets)과 커머스API 인증 상태(GET /auth-status, POST /auth-checks).
 * 비밀 저장소(SECRET_STORE)는 common/secrets(전역), 토큰은 integrations의 CommerceTokenService를 쓴다.
 * P1-10: AI CLI 점검 기록(`AiCliCheckRecorder` — P1-11 `POST /ai-cli-checks`도 쓴다), 앱 시작 점검(`AiEngineStartupCheck`,
 * `AI_ENGINE_STARTUP_CHECK`로 끈다), AI 단계 시작 전 사용 가능 판정(`AiEngineAvailabilityService.assertUsable`) —
 * step-engine이 부른다(C4 §3 step-engine → system, Proposed). 선택 엔진은 SettingsService(설정 JSON ai 섹션)에서 읽는다.
 */
@Module({
  imports: [IntegrationsModule, SettingsModule],
  controllers: [AiCliChecksController, SecretsController, CommerceAuthController],
  providers: [
    AiCliChecksService,
    SecretsService,
    CommerceAuthStatusService,
    AiCliCheckRecorder,
    AiEngineAvailabilityService,
    {
      provide: AI_ENGINE_STARTUP_CHECK,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): AiEngineStartupCheckOptions => ({
        enabled: config.aiEngineStartupCheck,
      }),
    },
    AiEngineStartupCheck,
  ],
  exports: [AiEngineAvailabilityService, AiCliCheckRecorder],
})
export class SystemModule {}
