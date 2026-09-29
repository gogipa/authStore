import { Module } from '@nestjs/common';
import { AiCliChecksController } from './ai-cli-checks/ai-cli-checks.controller.js';
import { AiCliChecksService } from './ai-cli-checks/ai-cli-checks.service.js';

/**
 * 관리: 시스템 상태·첫 실행 점검·키체인 키 상태·메타데이터 동기화·로그,
 * AI 엔진 감지·연결 테스트 기록(ai_cli_check) 소유(D-16).
 */
@Module({
  controllers: [AiCliChecksController],
  providers: [AiCliChecksService],
})
export class SystemModule {}
