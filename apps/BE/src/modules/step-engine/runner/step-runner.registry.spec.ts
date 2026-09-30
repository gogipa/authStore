import { Injectable, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  StepRunnerFor,
  type StepInput,
  type StepOutcome,
  type StepRunner,
} from '../contracts/step-runner.js';
import type { StepCode } from '../domain/steps.js';
import { StepRunnerRegistrationError, StepRunnerRegistry } from './step-runner.registry.js';

class BaseRunner implements StepRunner {
  readonly usesAi = false;
  constructor(readonly stepCode: StepCode) {}
  readInputs(): Promise<StepInput[]> {
    return Promise.resolve([]);
  }
  run(): Promise<StepOutcome> {
    return Promise.resolve({ kind: 'COMPLETED', output: null });
  }
  persist(): Promise<void> {
    return Promise.resolve();
  }
  copyOutput(): Promise<void> {
    return Promise.resolve();
  }
}

@StepRunnerFor('PRICING')
@Injectable()
class PricingRunner extends BaseRunner {
  constructor() {
    super('PRICING');
  }
}

@StepRunnerFor('PRICING')
@Injectable()
class OtherPricingRunner extends BaseRunner {
  constructor() {
    super('PRICING');
  }
}

@StepRunnerFor('CATEGORY')
@Injectable()
class MislabeledRunner extends BaseRunner {
  constructor() {
    super('TAGS');
  }
}

/** 단계 모듈 흉내: 실행기를 자기 providers에 넣는다(step-engine은 이 모듈을 import하지 않는다) */
@Module({ providers: [PricingRunner] })
class PricingStepModule {}

@Module({ providers: [OtherPricingRunner] })
class OtherPricingStepModule {}

async function registryWith(...modules: (new () => unknown)[]) {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule, ...modules],
    providers: [StepRunnerRegistry],
  }).compile();
  return moduleRef;
}

describe('StepRunnerRegistry — @StepRunnerFor 실행기 등록(P1-05)', () => {
  it('단계 모듈 providers의 실행기를 DiscoveryService로 모은다', async () => {
    const moduleRef = await registryWith(PricingStepModule);
    await moduleRef.init();
    const registry = moduleRef.get(StepRunnerRegistry);
    expect(registry.get('PRICING')).toBeInstanceOf(PricingRunner);
    expect(registry.has('SOURCING')).toBe(false);
    expect(registry.get('SOURCING')).toBeNull();
    expect(registry.codes()).toEqual(['PRICING']);
    await moduleRef.close();
  });

  it('한 단계에 실행기가 둘이면 앱 시작을 멈춘다', async () => {
    const moduleRef = await registryWith(PricingStepModule, OtherPricingStepModule);
    const error = await moduleRef.init().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StepRunnerRegistrationError);
    expect((error as Error).message).toMatch(/PRICING 단계에 실행기가 둘/);
  });

  it('표시와 stepCode가 다르거나 모르는 코드면 멈춘다', () => {
    const registry = new StepRunnerRegistry(null as never, null as never);
    expect(() => registry.register('CATEGORY', new MislabeledRunner(), 'MislabeledRunner')).toThrow(
      /다릅니다/,
    );
    expect(() => registry.register('FOO', new PricingRunner())).toThrow(/알 수 없는 단계 코드/);
  });
});
