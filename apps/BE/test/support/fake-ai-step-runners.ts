import { Inject, Injectable, Module, type Type } from '@nestjs/common';
import type { AiExecutionResult } from '../../src/modules/integrations/ai-engine/ai-executor.types.js';
import { AiExecutor } from '../../src/modules/integrations/ai-engine/ai-executor.service.js';
import { IntegrationsModule } from '../../src/modules/integrations/integrations.module.js';
import {
  StepRunnerFor,
  StepRunnerTestDouble,
  type StepAiModelKind,
  type StepOutcome,
  type StepRunContext,
} from '../../src/modules/step-engine/contracts/step-runner.js';
import type { StepCode } from '../../src/modules/step-engine/domain/steps.js';
import { FakeStepRunner, FakeStepWorld } from '../fixtures/step-engine/fake-runners.js';

/** 가짜 AI 단계가 부르는 결과 스키마(규칙 7을 지킨다) */
export const FAKE_AI_SCHEMA = {
  type: 'object',
  properties: {
    match: { type: 'boolean' },
    reason: { type: ['string', 'null'] },
  },
  required: ['match', 'reason'],
  additionalProperties: false,
} as const;

/** 가짜 AI 단계의 호출 기록과 멈춤 */
@Injectable()
export class FakeAiStepWorld {
  /** 실행기에 들어온 문맥(pinnedAi 확인용) */
  readonly contexts: StepRunContext[] = [];
  readonly results: AiExecutionResult<unknown>[] = [];
  private holdPromise: Promise<void> | null = null;
  private releaseHold: (() => void) | null = null;
  private heldResolvers: (() => void)[] = [];

  /** 다음 실행을 AI 호출 전에 멈춘다(release까지) */
  holdNext(): void {
    this.holdPromise = new Promise((resolve) => {
      this.releaseHold = resolve;
    });
  }

  /** 멈춘 실행이 멈춤 자리에 닿으면 풀리는 promise */
  whenHeld(): Promise<void> {
    return new Promise((resolve) => this.heldResolvers.push(resolve));
  }

  release(): void {
    this.releaseHold?.();
    this.releaseHold = null;
    this.holdPromise = null;
  }

  async beforeAi(ctx: StepRunContext): Promise<void> {
    this.contexts.push(ctx);
    const hold = this.holdPromise;
    if (hold) {
      for (const r of this.heldResolvers.splice(0)) r();
      await hold;
    }
  }

  reset(): void {
    this.release();
    this.contexts.length = 0;
    this.results.length = 0;
    this.heldResolvers.length = 0;
  }
}

/**
 * AI를 쓰는 가짜 실행기(P1-10 e2e): `ctx.pinnedAi`로 `AiExecutor.run`을 한 번 부르고(동일 상품 판정 보조 흉내),
 * 결과는 P1-05 가짜 실행기처럼 끝낸다. 실행기 예외(AiEngineUnavailableError 등)는 그대로 던진다(엔진이 FAILED로 닫는다).
 */
function aiRunnerClass(code: StepCode, kind: StepAiModelKind): Type<FakeStepRunner> {
  @StepRunnerFor(code)
  @StepRunnerTestDouble()
  @Injectable()
  class FakeAiRunner extends FakeStepRunner {
    override readonly usesAi = true;
    readonly aiModelKind = kind;

    constructor(
      @Inject(FakeStepWorld) world: FakeStepWorld,
      @Inject(FakeAiStepWorld) private readonly aiWorld: FakeAiStepWorld,
      @Inject(AiExecutor) private readonly executor: AiExecutor,
    ) {
      super(code, world);
    }

    override async run(ctx: StepRunContext): Promise<StepOutcome> {
      await this.aiWorld.beforeAi(ctx);
      if (!ctx.pinnedAi) throw new Error('AI 단계인데 pinnedAi가 없다');
      const result = await this.executor.run(
        ctx.pinnedAi,
        { name: 'RK-03', kind: 'TEXT' },
        FAKE_AI_SCHEMA,
        {
          instruction: '두 상품이 같은 상품인지 판정하라.',
          blocks: [{ source: 'RAKUTEN', label: '상품명', text: 'アシックス ゲルカヤノ14' }],
        },
      );
      this.aiWorld.results.push(result);
      return super.run(ctx);
    }
  }
  Object.defineProperty(FakeAiRunner, 'name', { value: `FakeAi${code}Runner` });
  return FakeAiRunner;
}

/** AI를 쓰지 않는 가짜 실행기 */
function plainRunnerClass(code: StepCode): Type<FakeStepRunner> {
  @StepRunnerFor(code)
  @StepRunnerTestDouble()
  @Injectable()
  class FakePlainRunner extends FakeStepRunner {
    override readonly usesAi = false;

    constructor(@Inject(FakeStepWorld) world: FakeStepWorld) {
      super(code, world);
    }
  }
  Object.defineProperty(FakePlainRunner, 'name', { value: `FakePlain${code}Runner` });
  return FakePlainRunner;
}

/**
 * P1-10 e2e 실행기 모듈: ② SOURCING = AI 텍스트 단계(AiExecutor 호출), ③ PRICING = AI를 쓰지 않는 단계.
 * `createTestApp({ imports: [FakeAiStepRunnersModule] })`.
 */
@Module({
  imports: [IntegrationsModule],
  providers: [
    FakeStepWorld,
    FakeAiStepWorld,
    aiRunnerClass('SOURCING', 'TEXT'),
    plainRunnerClass('PRICING'),
  ],
  exports: [FakeStepWorld, FakeAiStepWorld],
})
export class FakeAiStepRunnersModule {}
