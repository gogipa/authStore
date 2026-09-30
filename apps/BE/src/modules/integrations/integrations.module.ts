import { forwardRef, Module } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { SettingsModule } from '../settings/settings.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { AgyAdapter } from './ai-engine/adapters/agy.adapter.js';
import { AgyModelsProvider } from './ai-engine/agy-models.provider.js';
import { ClaudeCodeAdapter } from './ai-engine/adapters/claude-code.adapter.js';
import { CodexAdapter } from './ai-engine/adapters/codex.adapter.js';
import { AI_ENGINE_ADAPTERS } from './ai-engine/ai-engine.port.js';
import { AiExecutor } from './ai-engine/ai-executor.service.js';
import { IsolatedCliRunner } from './ai-engine/process/isolated-cli-runner.js';
import { CallUsageController } from './call-usage/call-usage.controller.js';
import { CallUsageService } from './call-usage/call-usage.service.js';
import { CommerceMetaCacheService } from './commerce-meta/commerce-meta-cache.service.js';
import { CommerceMetaQueryService } from './commerce-meta/commerce-meta-query.service.js';
import { CommerceMetaRecovery } from './commerce-meta/commerce-meta-recovery.js';
import { CommerceMetaSyncController } from './commerce-meta/commerce-meta-sync.controller.js';
import {
  COMMERCE_META_SCHEDULE,
  CommerceMetaSyncScheduler,
  defaultCommerceMetaSchedule,
} from './commerce-meta/commerce-meta-sync.scheduler.js';
import { CommerceMetaSyncService } from './commerce-meta/commerce-meta-sync.service.js';
import { CommerceMetaController } from './commerce-meta/commerce-meta.controller.js';
import { DatalabRankHttpAdapter } from './datalab/datalab-rank.http-adapter.js';
import { DATALAB_RANK_PORT } from './datalab/datalab-rank.port.js';
import { CustomsServiceAdapter } from './fx/customs-service.adapter.js';
import { FxApiCaller } from './fx/fx-call.js';
import { FX_SOURCE_PORT, type FxSourcePort } from './fx/fx-source.port.js';
import { KeximAdapter } from './fx/kexim.adapter.js';
import { FakeImageGenProvider } from './image-gen/fake-image-gen.provider.js';
import { IMAGE_GEN_PROVIDER } from './image-gen/image-gen.port.js';
import { CallLogService } from './http/call-log.service.js';
import { CLOCK, systemClock } from './http/clock.token.js';
import {
  createSettingsDailyLimitProvider,
  DAILY_LIMIT_PROVIDER,
} from './http/daily-limit.provider.js';
import { ExternalHttpGateway } from './http/external-http.gateway.js';
import { defaultHttpFetch, HTTP_FETCH } from './http/http-fetch.token.js';
import { CommerceApiClient } from './naver-commerce/commerce-api.client.js';
import { RakutenGenreHttpAdapter } from './rakuten/rakuten-genre.http-adapter.js';
import { RAKUTEN_GENRE_PORT } from './rakuten/rakuten-genre.port.js';
import { RakutenGenreRepository } from './rakuten/rakuten-genre.repository.js';
import { RakutenGenreService } from './rakuten/rakuten-genre.service.js';
import { RakutenImageHttpAdapter } from './rakuten/rakuten-image.http-adapter.js';
import { RAKUTEN_IMAGE_PORT } from './rakuten/rakuten-image.port.js';
import { RakutenPageHttpAdapter } from './rakuten/rakuten-page.http-adapter.js';
import { RAKUTEN_PAGE_PORT } from './rakuten/rakuten-page.port.js';
import { RakutenSearchCacheRepository } from './rakuten/rakuten-search-cache.repository.js';
import { RakutenSearchHttpAdapter } from './rakuten/rakuten-search.http-adapter.js';
import { RAKUTEN_SEARCH_PORT } from './rakuten/rakuten-search.port.js';
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
 * commerce-meta(P1-08): 메타데이터 동기화(수동 API·하루 1회 자동·재시작 정리)와 캐시 목록 API.
 *   다른 모듈은 `CommerceMetaCacheService`로만 캐시를 읽는다(쓰기는 동기화기만). 자동 실행은 COMMERCE_META_SCHEDULE로 끈다.
 * ai-engine(P1-10): 어댑터 3개(claude·agy·codex)를 `AI_ENGINE_ADAPTERS` 배열로 등록하고 `AiExecutor`(단계 모듈의 유일한
 *   AI 입구)·`IsolatedCliRunner`(spawn 래퍼 하나 — P3-02 이미지 생성 공급자도 쓴다)를 export한다. AI CLI는 HTTP가 아니라
 *   외부 호출 관문을 지나지 않고, 격리 검사기(cli-isolation.ts)를 지나 spawn한다. 테스트는 AI_ENGINE_ADAPTERS를 가짜로 바꾼다.
 *   P1-11: `AgyModelsProvider`(`agy models` 목록 캐시 — AI 엔진 설정의 AGY 모델 목록·검사, 감지 때 갱신)를 export한다.
 * datalab(P2-01): 순위 요청 포트 `DATALAB_RANK_PORT`(→ `DatalabRankHttpAdapter`, 관문 target=DATALAB)를 export한다.
 *   keywords 모듈이 이 포트로만 데이터랩을 부른다(응답 해석은 keywords). 테스트는 이 토큰을 가짜 포트로 바꾸거나
 *   가짜 fetch(HTTP_FETCH) 뒤에 가짜 데이터랩을 둔다.
 * rakuten(P2-02): 포트 3개 — `RAKUTEN_SEARCH_PORT`(Item Search, 관문 RAKUTEN_API·6시간 캐시 `rakuten_search_cache`·429·503
 *   백오프 3회), `RAKUTEN_PAGE_PORT`(상품 페이지, 관문 RAKUTEN_PAGE 직렬 큐 하나·3초·하루 상한·24시간 쉼, 캐시 없음),
 *   `RAKUTEN_GENRE_PORT`(IchibaGenre) + 장르 경로 캐시 `RakutenGenreService`(rakuten_genre). 외부 응답 캐시는 integrations
 *   소유(ERD 결정 ⑭). 키는 키체인(SECRET_STORE)에서만 읽는다. sourcing 모듈이 이 포트로만 라쿠텐을 부른다.
 * rakuten 이미지(P3-01): `RAKUTEN_IMAGE_PORT`(→ `RakutenImageHttpAdapter`, 관문 RAKUTEN_IMAGE — 이미지 CDN 허용 호스트, 직렬·1초,
 *   하루 상한·24시간 쉼 없음, 허용 호스트 안 리다이렉트 2번까지)를 export한다. thumbnails가 ⑤ 원본 이미지를 이것으로만 받는다.
 * fx(P2-04): 환율 출처 포트 `FX_SOURCE_PORT`(원가 = `KeximAdapter` 관문 FX_KOREAEXIM, 과세 = `CustomsServiceAdapter` 관문
 *   FX_CUSTOMS)를 export한다. 원값·단위 문자열만 돌려주고 정규화·저장은 pricing이 한다. 키가 없으면 부르지 않고 call_log에
 *   실패 1행(`FxApiCaller`). 테스트는 이 토큰을 `FxFixtureAdapter`로 바꾸거나 가짜 fetch(HTTP_FETCH) 뒤에 fixture를 둔다.
 * image-gen(P3-02): 썸네일 이미지 생성 포트 `IMAGE_GEN_PROVIDER`(image-gen.port.ts)를 export한다. M0 S1(이미지 생성 경로)
 *   전이라 가짜 공급자(`FakeImageGenProvider` — 밖을 부르지 않는 단색 PNG)만 붙는다. 실제 어댑터(agy `generate_image` 또는
 *   Gemini API)는 S1 뒤에 이 토큰에 붙이고 호출마다 call_log(`IMAGE_GEN_CALL_TARGET`)를 남긴다. 테스트는
 *   `overrideProvider(IMAGE_GEN_PROVIDER)`로 대본 가짜를 넣는다.
 */
@Module({
  // 하루 조회 상한의 원본이 설정 파일이다(P1-03). settings도 프로필 검증에 CommerceMetaCacheService를 쓰므로(P1-09)
  // 서로 forwardRef로 부른다
  imports: [forwardRef(() => SettingsModule)],
  controllers: [CallUsageController, CommerceMetaSyncController, CommerceMetaController],
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
    {
      provide: COMMERCE_META_SCHEDULE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        defaultCommerceMetaSchedule(config.commerceMetaAutoSync),
    },
    CommerceMetaCacheService,
    CommerceMetaQueryService,
    CommerceMetaSyncService,
    CommerceMetaRecovery,
    CommerceMetaSyncScheduler,
    { provide: IsolatedCliRunner, useFactory: () => new IsolatedCliRunner() },
    {
      provide: AI_ENGINE_ADAPTERS,
      inject: [IsolatedCliRunner],
      useFactory: (runner: IsolatedCliRunner) => [
        new ClaudeCodeAdapter(runner),
        new AgyAdapter(runner),
        new CodexAdapter(runner),
      ],
    },
    AiExecutor,
    AgyModelsProvider,
    { provide: DATALAB_RANK_PORT, useClass: DatalabRankHttpAdapter },
    RakutenSearchCacheRepository,
    { provide: RAKUTEN_SEARCH_PORT, useClass: RakutenSearchHttpAdapter },
    { provide: RAKUTEN_PAGE_PORT, useClass: RakutenPageHttpAdapter },
    { provide: RAKUTEN_IMAGE_PORT, useClass: RakutenImageHttpAdapter },
    { provide: RAKUTEN_GENRE_PORT, useClass: RakutenGenreHttpAdapter },
    RakutenGenreRepository,
    RakutenGenreService,
    FxApiCaller,
    KeximAdapter,
    CustomsServiceAdapter,
    {
      provide: FX_SOURCE_PORT,
      inject: [KeximAdapter, CustomsServiceAdapter],
      useFactory: (kexim: KeximAdapter, customs: CustomsServiceAdapter): FxSourcePort => ({
        fetchCostJpy: (kstDate) => kexim.fetchCostJpy(kstDate),
        fetchCustomsRates: (kstDate) => customs.fetchCustomsRates(kstDate),
      }),
    },
    {
      provide: IMAGE_GEN_PROVIDER,
      useFactory: () => {
        const provider = new FakeImageGenProvider();
        provider.announceDefault();
        return provider;
      },
    },
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
    CommerceMetaCacheService,
    AiExecutor,
    IsolatedCliRunner,
    AgyModelsProvider,
    DATALAB_RANK_PORT,
    RAKUTEN_SEARCH_PORT,
    RAKUTEN_PAGE_PORT,
    RAKUTEN_IMAGE_PORT,
    RAKUTEN_GENRE_PORT,
    RakutenGenreService,
    FX_SOURCE_PORT,
    IMAGE_GEN_PROVIDER,
  ],
})
export class IntegrationsModule {}
