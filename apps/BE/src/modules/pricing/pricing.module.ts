import { Module, type OnModuleInit } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import { StepEngineModule } from '../step-engine/step-engine.module.js';
import { DomesticPricesController } from './domestic-prices.controller.js';
import { DomesticPricesService } from './domestic-prices.service.js';
import { PricingG2GateBasis } from './g2-basis.provider.js';
import { NaverShoppingLinksController } from './naver-shopping-links.controller.js';
import { NaverShoppingLinksService } from './naver-shopping-links.service.js';
import { PriceJudgementController } from './price-judgement.controller.js';
import { PriceJudgementService } from './price-judgement.service.js';
import { pricingOutputReader } from './pricing-output.reader.js';
import { PricingSnapshotRepository } from './pricing-snapshot.repository.js';
import { PricingStepRunner } from './pricing-step.runner.js';
import {
  defaultFxCollectSchedule,
  FX_COLLECT_SCHEDULE,
  FxCollectorService,
} from './fx/fx-collector.service.js';
import { FxRatesController } from './fx/fx-rates.controller.js';
import { FxRatesService } from './fx/fx-rates.service.js';

/**
 * ③ 판정: 원가·국내 기준가·마진 판정(03-ADR-003 모듈 경계).
 *
 * P2-04 환율(pricing 소유 fx_rate): GET /fx-rates/latest·GET /fx-rates·POST /fx-rates(`fx/`).
 * - `FxRatesService`를 export한다 — ③ 실행기(P2-05)가 `getLatestForJudgement()`(환율 3종, 없으면 409 FX_RATE_UNAVAILABLE)를
 *   부르고, 계산값은 `perUnit()`(fx-rate.normalize.ts) 하나로만 얻는다. ③ 입력은 `fxStepInputs()`(`fx.*`)
 * - 자동 수집 `FxCollectorService`(앱 시작 + 10분마다 검사, 새 의존성 없음). 환율 출처는 integrations의 `FX_SOURCE_PORT`로만 부른다
 * - 새 최신값의 '재실행 필요' 전파는 step-engine 공개 창구 `StepEngineApi.referenceInputsChanged`로 한다(candidate_step을
 *   직접 고치지 않는다). SSE `fx-rate.updated`는 common 진행 알림으로 커밋 뒤 보낸다
 * - 활성 배대지 요금표는 settings 소유(`ForwarderRateTablesService.activeForJudgement()`)
 *
 * P2-05 ③ 가격 판정:
 * - `PricingStepRunner`(`@StepRunnerFor('PRICING')`): ② 선택·목표 사이즈 SKU는 `StepEngineApi`로만 읽고(sourcing import
 *   없음), 순수 계산 `calc/price-judgement.calc.ts`(`judgePrice`) → 판정 스냅샷(`PricingSnapshotRepository`). 완료·후보 제외·
 *   뒷단계 재실행 필요는 step-engine 끝 트랜잭션 한 번으로 묶인다(03-2 §4)
 * - `PricingG2GateBasis`(`@GateBasisFor('G2')`): G2 지문·막힌 이유(판매 후보 아님·비교 없이 확정 없음)
 * - API: `GET …/price-judgement`, `POST·GET …/domestic-prices`, `GET …/naver-shopping-links`
 *   ('비교 없이 확정'은 step-engine `NoComparisonController`)
 *
 * P3-04: ③ 판정 읽기(`pricing-output.reader.ts`)를 앱 시작 때 `StepEngineApi.registerPricingOutputReader`로 끼운다 — ⑥-3이
 * 판매 사이즈를 step-engine을 거쳐 읽는다(content는 pricing을 import하지 않는다).
 * P4-02: 같은 읽기 함수에 판정 스냅샷 전체(`readJudgement`)를 더했다 — 최종 승인 미리보기·사전 검증(registration)이 읽는다.
 */
@Module({
  imports: [IntegrationsModule, SettingsModule, StepEngineModule],
  controllers: [
    FxRatesController,
    PriceJudgementController,
    DomesticPricesController,
    NaverShoppingLinksController,
  ],
  providers: [
    FxRatesService,
    PricingSnapshotRepository,
    PricingStepRunner,
    PricingG2GateBasis,
    PriceJudgementService,
    DomesticPricesService,
    NaverShoppingLinksService,
    FxCollectorService,
    {
      provide: FX_COLLECT_SCHEDULE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => defaultFxCollectSchedule(config.fxAutoCollect),
    },
  ],
  exports: [FxRatesService],
})
export class PricingModule implements OnModuleInit {
  constructor(private readonly api: StepEngineApi) {}

  onModuleInit(): void {
    this.api.registerPricingOutputReader(pricingOutputReader);
  }
}
