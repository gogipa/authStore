import { Module, type OnModuleInit } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { StepEngineModule } from '../step-engine/step-engine.module.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import { AdultConfirmationService } from './adult-confirmation.service.js';
import { ItemCodeResolver } from './item-code.resolver.js';
import { RakutenItemFetcher } from './rakuten-item-fetcher.js';
import { RakutenItemRepository } from './rakuten-item.repository.js';
import { RakutenItemsController } from './rakuten-items.controller.js';
import { RakutenItemsService } from './rakuten-items.service.js';
import { RakutenQueryValidationsController } from './rakuten-query-validations.controller.js';
import { SourcingComparisonsController } from './sourcing-comparisons.controller.js';
import { SourcingComparisonsService } from './sourcing-comparisons.service.js';
import { SourcingPageFetchService } from './sourcing-page-fetch.service.js';
import { sourcingSelectionReader } from './sourcing-selection.reader.js';
import { SourcingStepRunner } from './sourcing.step-runner.js';
import { UrlCandidateExtension } from './url-candidate.extension.js';

/**
 * ② 소싱(P2-02 라쿠텐 연동): 검색어 검사·Item Search·URL 입구·상품 페이지 읽기·아동화 차단·URL로 만들기·재조회·성인용 확인.
 * P2-03이 비교표(앵커·동일 상품·재고·실질가·선택)를 같은 모듈·같은 `SOURCING` 실행기 위에 붙인다.
 * - 라쿠텐은 integrations의 포트(RAKUTEN_SEARCH_PORT·RAKUTEN_PAGE_PORT·RAKUTEN_GENRE_PORT/RakutenGenreService)로만 부른다
 * - step-engine에서 쓰는 것은 실행기 규약(contracts/step-runner.ts)과 `StepEngineApi`, 후보 트랜잭션·잠금 서비스뿐이다.
 *   실행기는 `@StepRunnerFor('SOURCING')`로 레지스트리가 찾고, 'URL로 만들기' 확장과 소싱 선택 읽기는 앱 시작 때
 *   `StepEngineApi.register…`로 끼운다(엔진 → 단계 방향만)
 * - 아동화 판별은 common/child-shoe(P2-01 공통 규칙)
 * - 앵커 뒤 페이지 조회 반복(F-SO-12)은 `SourcingPageFetchService.run`(순서·K·M·멈춤 사유 + SSE sourcing.page-fetch-finished).
 *   재고 통과 판정·행 갱신은 P2-03 앵커 API가 넣는다
 */
@Module({
  imports: [IntegrationsModule, SettingsModule, StepEngineModule],
  controllers: [
    RakutenQueryValidationsController,
    RakutenItemsController,
    SourcingComparisonsController,
  ],
  providers: [
    RakutenItemRepository,
    ItemCodeResolver,
    RakutenItemFetcher,
    RakutenItemsService,
    SourcingComparisonsService,
    AdultConfirmationService,
    SourcingPageFetchService,
    SourcingStepRunner,
    UrlCandidateExtension,
  ],
})
export class SourcingModule implements OnModuleInit {
  constructor(
    private readonly api: StepEngineApi,
    private readonly urlExtension: UrlCandidateExtension,
  ) {}

  onModuleInit(): void {
    this.api.registerCandidateCreationExtension(this.urlExtension);
    this.api.registerSourcingSelectionReader(sourcingSelectionReader);
  }
}
