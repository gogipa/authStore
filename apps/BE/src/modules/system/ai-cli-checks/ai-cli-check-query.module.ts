import { Module } from '@nestjs/common';
import { AiCliCheckQueryService } from './ai-cli-check.query.js';

/**
 * ai_cli_check 읽기 창구만 담은 작은 모듈(P1-11, 06-2 §9 Proposed). system이 소유한다.
 * SettingsModule(AI 엔진 저장 조건 R8)이 이 모듈을 import한다. SystemModule은 SettingsModule을 import하므로(선택 엔진 읽기)
 * SettingsModule이 SystemModule 전체를 import하면 모듈 순환이 생긴다 — `forwardRef`로 덮지 않고 읽기 창구를 떼어 냈다(§8 주의).
 * PrismaService는 전역이라 이 모듈은 아무것도 import하지 않는다.
 */
@Module({
  providers: [AiCliCheckQueryService],
  exports: [AiCliCheckQueryService],
})
export class AiCliCheckQueryModule {}
