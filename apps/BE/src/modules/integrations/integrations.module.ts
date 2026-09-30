import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { CallUsageController } from './call-usage/call-usage.controller.js';
import { CallUsageService } from './call-usage/call-usage.service.js';
import { CallLogService } from './http/call-log.service.js';
import { CLOCK, systemClock } from './http/clock.token.js';
import {
  createSettingsDailyLimitProvider,
  DAILY_LIMIT_PROVIDER,
} from './http/daily-limit.provider.js';
import { ExternalHttpGateway } from './http/external-http.gateway.js';
import { defaultHttpFetch, HTTP_FETCH } from './http/http-fetch.token.js';
import { CommerceApiClient } from './naver-commerce/commerce-api.client.js';
import { CommerceTokenService } from './naver-commerce/commerce-token.service.js';
import {
  COMMERCE_TRANSPORT,
  GatewayCommerceTransport,
} from './naver-commerce/commerce-transport.port.js';

/**
 * 기반: 외부 연동 포트·어댑터(naver-commerce, rakuten, datalab, fx, ai-engine, image-gen).
 * 밖으로 나가는 HTTP는 ExternalHttpGateway 하나로만 나간다(F-BS-06). 단계 모듈은 여기 포트로만 밖을 부른다.
 * 테스트는 HTTP_FETCH·CLOCK·DAILY_LIMIT_PROVIDER·COMMERCE_TRANSPORT를 overrideProvider로 바꿔 끼운다(03-ADR-003).
 * naver-commerce(P1-07): CommerceApiClient(P1-08·P4-01·P4-03이 쓴다)·CommerceTokenService(system 인증 상태가 쓴다).
 */
@Module({
  // 하루 조회 상한의 원본이 설정 파일이다(P1-03)
  imports: [SettingsModule],
  controllers: [CallUsageController],
  providers: [
    { provide: HTTP_FETCH, useValue: defaultHttpFetch },
    { provide: CLOCK, useValue: systemClock },
    {
      provide: DAILY_LIMIT_PROVIDER,
      inject: [SettingsService],
      useFactory: (settings: SettingsService) => createSettingsDailyLimitProvider(settings),
    },
    CallLogService,
    CallUsageService,
    ExternalHttpGateway,
    { provide: COMMERCE_TRANSPORT, useClass: GatewayCommerceTransport },
    CommerceTokenService,
    CommerceApiClient,
  ],
  exports: [
    HTTP_FETCH,
    CLOCK,
    DAILY_LIMIT_PROVIDER,
    CallLogService,
    CallUsageService,
    ExternalHttpGateway,
    COMMERCE_TRANSPORT,
    CommerceTokenService,
    CommerceApiClient,
  ],
})
export class IntegrationsModule {}
