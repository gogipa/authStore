import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import {
  GATE_BASIS_META,
  GATE_BASIS_TEST_DOUBLE_META,
  type GateBasisProvider,
} from '../contracts/gate-basis.js';
import type { GateCode } from '../domain/steps.js';

/** 게이트 공급자 등록이 잘못됨(한 게이트에 둘, 모르는 게이트, 표시와 gate 불일치). 앱 시작을 멈춘다 */
export class GateBasisRegistrationError extends Error {}

const GATES: readonly GateCode[] = ['G2', 'G3'];

function isGateCode(value: unknown): value is GateCode {
  return typeof value === 'string' && (GATES as readonly string[]).includes(value);
}

/**
 * 게이트 공급자 모음(P1-06). `@GateBasisFor(gate)`를 단 provider를 앱 시작 때 DiscoveryService로 모은다
 * (`StepRunnerRegistry`와 같은 방식 — step-engine은 pricing·thumbnails 모듈을 import하지 않는다).
 */
@Injectable()
export class GateBasisRegistry implements OnModuleInit {
  private readonly logger = new Logger(GateBasisRegistry.name);
  private readonly providers = new Map<GateCode, GateBasisProvider>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    this.providers.clear();
    const doubles: { gate: unknown; instance: GateBasisProvider; name: string }[] = [];
    for (const wrapper of this.discovery.getProviders()) {
      const metatype = wrapper.metatype as (new (...args: never[]) => unknown) | null | undefined;
      if (!metatype || typeof metatype !== 'function') continue;
      const gate = this.reflector.get<unknown>(GATE_BASIS_META, metatype);
      if (gate === undefined) continue;
      const instance = wrapper.instance as GateBasisProvider | undefined;
      if (!instance) continue;
      if (this.reflector.get<unknown>(GATE_BASIS_TEST_DOUBLE_META, metatype) === true) {
        doubles.push({ gate, instance, name: metatype.name });
        continue;
      }
      this.register(gate, instance, metatype.name);
    }
    // 테스트 대역(P2-05): 운영 공급자(pricing G2)를 바꿔 낀다. 같은 게이트의 대역 둘은 register가 막는다
    const replaced = new Set<unknown>();
    for (const d of doubles) {
      if (isGateCode(d.gate) && this.providers.has(d.gate) && !replaced.has(d.gate)) {
        this.providers.delete(d.gate);
      }
      replaced.add(d.gate);
      this.register(d.gate, d.instance, d.name);
    }
    const missing = GATES.filter((gate) => !this.providers.has(gate));
    if (missing.length > 0) {
      this.logger.log(`공급자가 없는 게이트: ${missing.join(', ')}(통과하면 422, 늘 무효)`);
    }
  }

  /** 공급자 하나 등록(테스트·수동 등록도 같은 검사를 거친다) */
  register(gate: unknown, provider: GateBasisProvider, name = 'GateBasisProvider'): void {
    if (!isGateCode(gate)) {
      throw new GateBasisRegistrationError(`${name}: 알 수 없는 게이트 ${String(gate)}`);
    }
    if (provider.gate !== gate) {
      throw new GateBasisRegistrationError(
        `${name}: @GateBasisFor(${gate})와 gate(${provider.gate})가 다릅니다`,
      );
    }
    if (this.providers.has(gate)) {
      throw new GateBasisRegistrationError(`${gate} 게이트에 공급자가 둘입니다(${name})`);
    }
    this.providers.set(gate, provider);
  }

  get(gate: GateCode): GateBasisProvider | null {
    return this.providers.get(gate) ?? null;
  }

  has(gate: GateCode): boolean {
    return this.providers.has(gate);
  }
}
