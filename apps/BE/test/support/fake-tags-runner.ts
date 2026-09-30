import { Injectable, Module } from '@nestjs/common';
import {
  type StepInput,
  type StepInputContext,
  type StepOutcome,
  type StepRunner,
  StepRunnerFor,
  StepRunnerTestDouble,
} from '../../src/modules/step-engine/contracts/step-runner.js';
import { INPUT_KEYS } from '../../src/modules/step-engine/domain/input-keys.js';
import { StepEngineModule } from '../../src/modules/step-engine/step-engine.module.js';

/**
 * ⑦ TAGS 가짜 실행기(P2-06 e2e — ⑦은 P3-05 전이라 운영 실행기가 없다). 테스트 대역(`@StepRunnerTestDouble`)이다.
 * 입력은 ④ 리프 경로 하나(`category.leafPath`, 선택 PREV_STEP — ④ 현재 완료 버전이 있으면 후보의 리프 id·경로)라
 * ④가 새로 끝나면 ⑦의 지문이 달라져 '재실행 필요'가 된다(F-CA-01). 실행하면 곧바로 완료하고 산출물은 쓰지 않는다.
 */
@StepRunnerFor('TAGS')
@StepRunnerTestDouble()
@Injectable()
export class FakeTagsRunner implements StepRunner {
  readonly stepCode = 'TAGS' as const;
  readonly usesAi = false;

  readInputs(ctx: StepInputContext): Promise<StepInput[]> {
    const categoryRunId = ctx.completedRunId('CATEGORY');
    return Promise.resolve([
      {
        inputKey: INPUT_KEYS.categoryLeafPath,
        sourceType: 'PREV_STEP',
        sourceStepRunId: categoryRunId,
        isStartCondition: true,
        required: false,
        value:
          categoryRunId !== null
            ? {
                leafCategoryId: ctx.candidate.leafCategoryId,
                wholeCategoryName: ctx.candidate.wholeCategoryName,
              }
            : null,
      },
    ]);
  }

  run(): Promise<StepOutcome> {
    return Promise.resolve({ kind: 'COMPLETED', output: {} });
  }

  persist(): Promise<void> {
    return Promise.resolve();
  }

  copyOutput(): Promise<void> {
    return Promise.resolve();
  }
}

/** `createTestApp({ imports: [FakeTagsRunnerModule] })` — ⑦만 가짜로 끼운다 */
@Module({
  imports: [StepEngineModule],
  providers: [FakeTagsRunner],
})
export class FakeTagsRunnerModule {}
