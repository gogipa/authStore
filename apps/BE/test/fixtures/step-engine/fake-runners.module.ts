import { Inject, Injectable, Module, type Type } from '@nestjs/common';
import {
  StepRunnerFor,
  StepRunnerTestDouble,
} from '../../../src/modules/step-engine/contracts/step-runner.js';
import type { StepCode } from '../../../src/modules/step-engine/domain/steps.js';
import { FakeRegisterRunner, FakeStepRunner, FakeStepWorld } from './fake-runners.js';

/** 단계 하나의 가짜 실행기 클래스(@StepRunnerFor 메타데이터는 클래스마다 달아야 해서 단계마다 만든다) */
function fakeRunnerClass(code: StepCode): Type<FakeStepRunner> {
  @StepRunnerFor(code)
  @StepRunnerTestDouble()
  @Injectable()
  class FakeRunner extends FakeStepRunner {
    constructor(@Inject(FakeStepWorld) world: FakeStepWorld) {
      super(code, world);
    }
  }
  Object.defineProperty(FakeRunner, 'name', { value: `Fake${code}Runner` });
  return FakeRunner;
}

@StepRunnerFor('REGISTER')
@StepRunnerTestDouble()
@Injectable()
class FakeRegisterStepRunner extends FakeRegisterRunner {}

/** ②~⑧ 9단계 */
export const FAKE_RUNNER_STEPS: readonly StepCode[] = [
  'SOURCING',
  'PRICING',
  'CATEGORY',
  'THUMBNAIL',
  'COPY',
  'NOTICE_RAW',
  'NOTICE_HTML',
  'TAGS',
  'UPLOAD',
];

/**
 * 가짜 실행기 테스트 모듈: 9단계 + REGISTER(onInterrupted만) 가짜를 `@StepRunnerFor`로 등록한다. 모두 테스트 대역
 * (`@StepRunnerTestDouble`, P2-02)이라 운영 실행기(sourcing의 SOURCING 등)가 있어도 가짜를 쓴다.
 * `createTestApp({ imports: [FakeStepRunnersModule] })`로 앱에 끼우면 StepRunnerRegistry가 DiscoveryService로 찾는다.
 * 테스트는 `app.get(FakeStepWorld)`로 입력 값·대본을 바꾼다.
 */
@Module({
  providers: [FakeStepWorld, ...FAKE_RUNNER_STEPS.map(fakeRunnerClass), FakeRegisterStepRunner],
  exports: [FakeStepWorld],
})
export class FakeStepRunnersModule {}
