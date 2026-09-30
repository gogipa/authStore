import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import {
  STEP_RUNNER_META,
  STEP_RUNNER_TEST_DOUBLE_META,
  type StepRunner,
} from '../contracts/step-runner.js';
import { isStepCode, STEP_FLOW, type StepCode } from '../domain/steps.js';

/** 실행기 등록이 잘못됨(한 단계에 둘, 모르는 단계 코드, 표시와 stepCode 불일치). 앱 시작을 멈춘다 */
export class StepRunnerRegistrationError extends Error {}

/**
 * 실행기 모음(P1-05). `@StepRunnerFor(code)`를 단 provider를 앱 시작 때 DiscoveryService로 모은다.
 * step-engine은 단계 모듈을 import하지 않는다 — 단계 모듈이 자기 providers에 실행기를 넣으면 여기서 찾는다.
 */
@Injectable()
export class StepRunnerRegistry implements OnModuleInit {
  private readonly logger = new Logger(StepRunnerRegistry.name);
  private readonly runners = new Map<StepCode, StepRunner>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    this.runners.clear();
    const doubles: { code: unknown; instance: StepRunner; name: string }[] = [];
    for (const wrapper of this.discovery.getProviders()) {
      const metatype = wrapper.metatype as (new (...args: never[]) => unknown) | null | undefined;
      if (!metatype || typeof metatype !== 'function') continue;
      const code = this.reflector.get<unknown>(STEP_RUNNER_META, metatype);
      if (code === undefined) continue;
      const instance = wrapper.instance as StepRunner | undefined;
      if (!instance) continue;
      if (this.reflector.get<unknown>(STEP_RUNNER_TEST_DOUBLE_META, metatype) === true) {
        doubles.push({ code, instance, name: metatype.name });
        continue;
      }
      this.register(code, instance, metatype.name);
    }
    // 테스트 대역(P2-02): 운영 실행기를 바꿔 낀다. 같은 단계의 대역 둘은 register가 막는다
    const replaced = new Set<unknown>();
    for (const d of doubles) {
      if (this.runners.has(d.code as StepCode) && !replaced.has(d.code)) {
        this.runners.delete(d.code as StepCode);
      }
      replaced.add(d.code);
      this.register(d.code, d.instance, d.name);
    }
    const missing = STEP_FLOW.filter((code) => !this.runners.has(code));
    if (missing.length > 0) {
      this.logger.log(
        `실행기가 없는 단계 ${missing.length}개: ${missing.join(', ')}(실행하면 422)`,
      );
    }
  }

  /** 실행기 하나 등록(테스트·수동 등록도 같은 검사를 거친다) */
  register(code: unknown, runner: StepRunner, name = 'StepRunner'): void {
    if (!isStepCode(code)) {
      throw new StepRunnerRegistrationError(`${name}: 알 수 없는 단계 코드 ${String(code)}`);
    }
    if (runner.stepCode !== code) {
      throw new StepRunnerRegistrationError(
        `${name}: @StepRunnerFor(${code})와 stepCode(${runner.stepCode})가 다릅니다`,
      );
    }
    if (this.runners.has(code)) {
      throw new StepRunnerRegistrationError(`${code} 단계에 실행기가 둘입니다(${name})`);
    }
    this.runners.set(code, runner);
  }

  get(code: StepCode): StepRunner | null {
    return this.runners.get(code) ?? null;
  }

  has(code: StepCode): boolean {
    return this.runners.has(code);
  }

  /** 등록된 단계(흐름 순서) */
  codes(): StepCode[] {
    return STEP_FLOW.filter((code) => this.runners.has(code));
  }
}
