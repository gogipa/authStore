import { Module } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { StepEngineModule } from '../step-engine/step-engine.module.js';
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
 */
@Module({
  imports: [IntegrationsModule, StepEngineModule],
  controllers: [FxRatesController],
  providers: [
    FxRatesService,
    FxCollectorService,
    {
      provide: FX_COLLECT_SCHEDULE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => defaultFxCollectSchedule(config.fxAutoCollect),
    },
  ],
  exports: [FxRatesService],
})
export class PricingModule {}
