import { Module, type OnModuleInit } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { StepEngineModule } from '../step-engine/step-engine.module.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import { AdultConfirmationService } from './adult-confirmation.service.js';
import { AiMatchService } from './ai-match.service.js';
import { AnchorService } from './anchor.service.js';
import { CandidateSourcingComparisonController } from './candidate-sourcing-comparison.controller.js';
import { ComparisonScope } from './comparison-scope.js';
import { ItemCodeResolver } from './item-code.resolver.js';
import { ManualRowService } from './manual-row.service.js';
import { RakutenItemFetcher } from './rakuten-item-fetcher.js';
import { RakutenItemRepository } from './rakuten-item.repository.js';
import { RakutenItemsController } from './rakuten-items.controller.js';
import { RakutenItemsService } from './rakuten-items.service.js';
import { RakutenQueryValidationsController } from './rakuten-query-validations.controller.js';
import { RowUpdateService } from './row-update.service.js';
import { SearchMoreService } from './search-more.service.js';
import { SelectionService } from './selection.service.js';
import { SourcingComparisonRowsController } from './sourcing-comparison-rows.controller.js';
import { SourcingComparisonRepository } from './sourcing-comparison.repository.js';
import { SourcingComparisonsController } from './sourcing-comparisons.controller.js';
import { SourcingComparisonsService } from './sourcing-comparisons.service.js';
import { SourcingGenderListener } from './sourcing-gender.listener.js';
import { SourcingPageFetchService } from './sourcing-page-fetch.service.js';
import { createSourcingSelectionReader } from './sourcing-selection.reader.js';
import { SourcingStepRunner } from './sourcing.step-runner.js';
import { StockCheckService } from './stock-check.service.js';
import { UrlCandidateExtension } from './url-candidate.extension.js';

/**
 * ② 소싱. P2-02 라쿠텐 연동(검색어 검사·Item Search·URL 입구·상품 페이지 읽기·아동화 차단·URL로 만들기·재조회·성인용 확인)
 * 위에 P2-03 비교표(앵커·동일 상품·재고·실질가·최종 후보)를 같은 `SOURCING` 실행기로 붙인다.
 * - 라쿠텐은 integrations의 포트(RAKUTEN_SEARCH_PORT·RAKUTEN_PAGE_PORT·RAKUTEN_GENRE_PORT/RakutenGenreService)로만,
 *   AI는 P1-10 `AiExecutor`로만(그 ② 실행에 고정한 엔진 — `StepEngineApi.pinnedAiOf`) 부른다
 * - step-engine에서 쓰는 것은 실행기 규약(contracts/step-runner.ts)과 `StepEngineApi`, 후보 트랜잭션·잠금·상태·정체성 서비스,
 *   `GATE_VALIDITY`(G2 무효 감지)뿐이다. 앱 시작 때 'URL로 만들기' 확장·소싱 선택 읽기·오너 성별 리스너(P2-03)를
 *   `StepEngineApi.register…`로 끼운다(엔진 → 단계 방향만)
 * - 아동화 판별은 common/child-shoe(P2-01 공통 규칙)
 * - P2-03: 순수 규칙(anchor-match·gender-detection·stock-judgement·effective-price·ranking·row-calculation), 비교표 읽기·쓰기
 *   (`SourcingComparisonRepository`·`ComparisonScope`), 앵커 + 백그라운드(`AnchorService` — page 2·페이지 조회 반복·AI 보조·
 *   제외 판단), 재고 확인·수동 행·행 수정·선택 서비스
 * - D-47: 검색 결과 더 보기(`SearchMoreService`) — 기준 상품 전 목록을 다음 페이지로 늘린다
 */
@Module({
  imports: [IntegrationsModule, SettingsModule, StepEngineModule],
  controllers: [
    RakutenQueryValidationsController,
    RakutenItemsController,
    SourcingComparisonsController,
    SourcingComparisonRowsController,
    CandidateSourcingComparisonController,
  ],
  providers: [
    RakutenItemRepository,
    ItemCodeResolver,
    RakutenItemFetcher,
    RakutenItemsService,
    SourcingComparisonsService,
    AdultConfirmationService,
    SourcingPageFetchService,
    SourcingComparisonRepository,
    ComparisonScope,
    AiMatchService,
    AnchorService,
    StockCheckService,
    ManualRowService,
    SearchMoreService,
    RowUpdateService,
    SelectionService,
    SourcingGenderListener,
    SourcingStepRunner,
    UrlCandidateExtension,
  ],
})
export class SourcingModule implements OnModuleInit {
  constructor(
    private readonly api: StepEngineApi,
    private readonly urlExtension: UrlCandidateExtension,
    private readonly genderListener: SourcingGenderListener,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    this.api.registerCandidateCreationExtension(this.urlExtension);
    this.api.registerSourcingSelectionReader(
      createSourcingSelectionReader(() => this.settings.current()),
    );
    this.api.registerGenderInputListener(this.genderListener);
  }
}
