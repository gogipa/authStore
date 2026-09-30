import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { AiCliChecksController } from './ai-cli-checks/ai-cli-checks.controller.js';
import { AiCliChecksService } from './ai-cli-checks/ai-cli-checks.service.js';
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
 */
@Module({
  imports: [IntegrationsModule],
  controllers: [AiCliChecksController, SecretsController, CommerceAuthController],
  providers: [AiCliChecksService, SecretsService, CommerceAuthStatusService],
})
export class SystemModule {}
