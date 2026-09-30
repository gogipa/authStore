import { Injectable, Module } from '@nestjs/common';
import {
  type StepInput,
  type StepInputContext,
  type StepOutcome,
  type StepRunContext,
  type StepRunner,
  StepRunnerFor,
  StepRunnerTestDouble,
} from '../../src/modules/step-engine/contracts/step-runner.js';
import { INPUT_KEYS } from '../../src/modules/step-engine/domain/input-keys.js';
import { StepEngineApi } from '../../src/modules/step-engine/step-engine.api.js';
import { StepEngineModule } from '../../src/modules/step-engine/step-engine.module.js';

export interface FakePricingCall {
  stepRunId: number;
  candidateId: number;
  executionMode: StepRunContext['executionMode'];
  /** 읽은 ② 소싱 선택(rakuten_item id) */
  rakutenItemId: number | null;
}

/**
 * ③ PRICING 가짜 실행기(P2-02 재조회 e2e — ②는 운영 SOURCING 실행기를 쓴다). 테스트 대역(`@StepRunnerTestDouble`)이다.
 * 입력은 ② 소싱 선택 하나(`StepEngineApi.readSourcingSelection` — sourcing이 등록한 읽기 함수를 step-engine을 거쳐 읽는다).
 * 호출을 기록하고 `next` 결과(없으면 완료)를 돌려준다. 산출물은 쓰지 않는다.
 */
@StepRunnerFor('PRICING')
@StepRunnerTestDouble()
@Injectable()
export class FakePricingRunner implements StepRunner {
  readonly stepCode = 'PRICING' as const;
  readonly usesAi = false;
  readonly calls: FakePricingCall[] = [];
  /** 다음 실행 결과(한 번 쓰고 비운다) */
  next: StepOutcome | null = null;

  constructor(private readonly api: StepEngineApi) {}

  reset(): void {
    this.calls.length = 0;
    this.next = null;
  }

  async readInputs(ctx: StepInputContext): Promise<StepInput[]> {
    const runId = ctx.completedRunId('SOURCING');
    const selection = runId !== null ? await this.api.readSourcingSelection(runId, ctx.db) : null;
    return [
      {
        inputKey: INPUT_KEYS.sourcingTargetSkus,
        sourceType: 'PREV_STEP',
        sourceStepRunId: runId,
        isStartCondition: true,
        required: true,
        value: selection
          ? { itemCode: selection.itemCode, rakutenItemId: selection.rakutenItemId }
          : null,
      },
    ];
  }

  run(ctx: StepRunContext): Promise<StepOutcome> {
    const value = ctx.inputs.find((i) => i.inputKey === INPUT_KEYS.sourcingTargetSkus)?.value as
      { rakutenItemId: number } | null | undefined;
    this.calls.push({
      stepRunId: ctx.stepRunId,
      candidateId: ctx.candidateId,
      executionMode: ctx.executionMode,
      rakutenItemId: value?.rakutenItemId ?? null,
    });
    const outcome = this.next ?? { kind: 'COMPLETED', output: {} };
    this.next = null;
    return Promise.resolve(outcome);
  }

  persist(): Promise<void> {
    return Promise.resolve();
  }

  copyOutput(): Promise<void> {
    return Promise.resolve();
  }
}

/** `createTestApp({ imports: [FakePricingRunnerModule] })` — ③만 가짜로 끼운다 */
@Module({
  imports: [StepEngineModule],
  providers: [FakePricingRunner],
  exports: [FakePricingRunner],
})
export class FakePricingRunnerModule {}
