import { Module } from '@nestjs/common';
import { CallUsageController } from './call-usage/call-usage.controller.js';
import { CallUsageService } from './call-usage/call-usage.service.js';
import { CallLogService } from './http/call-log.service.js';
import { CLOCK, systemClock } from './http/clock.token.js';
import { createDailyLimitProvider, DAILY_LIMIT_PROVIDER } from './http/daily-limit.provider.js';
import { ExternalHttpGateway } from './http/external-http.gateway.js';
import { defaultHttpFetch, HTTP_FETCH } from './http/http-fetch.token.js';

/**
 * 기반: 외부 연동 포트·어댑터(naver-commerce, rakuten, datalab, fx, ai-engine, image-gen).
 * 밖으로 나가는 HTTP는 ExternalHttpGateway 하나로만 나간다(F-BS-06). 단계 모듈은 여기 포트로만 밖을 부른다.
 * 테스트는 HTTP_FETCH·CLOCK·DAILY_LIMIT_PROVIDER를 overrideProvider로 바꿔 끼운다(03-ADR-003).
 */
@Module({
  controllers: [CallUsageController],
  providers: [
    { provide: HTTP_FETCH, useValue: defaultHttpFetch },
    { provide: CLOCK, useValue: systemClock },
    { provide: DAILY_LIMIT_PROVIDER, useFactory: () => createDailyLimitProvider() },
    CallLogService,
    CallUsageService,
    ExternalHttpGateway,
  ],
  exports: [
    HTTP_FETCH,
    CLOCK,
    DAILY_LIMIT_PROVIDER,
    CallLogService,
    CallUsageService,
    ExternalHttpGateway,
  ],
})
export class IntegrationsModule {}
