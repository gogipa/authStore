import { Injectable, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  g2Basis,
  GateBasisFor,
  GateBasisTestDouble,
  type GateBasis,
  type GateBasisProvider,
  type GateBlocker,
} from '../contracts/gate-basis.js';
import { GateBasisRegistrationError, GateBasisRegistry } from './gate-basis.registry.js';

class BaseProvider implements GateBasisProvider {
  constructor(readonly gate: 'G2' | 'G3') {}
  basis(): Promise<GateBasis> {
    return Promise.resolve(
      g2Basis({ itemCode: null, selectedColor: null, saleCandidate: true, saleSizes: [] }),
    );
  }
  blockers(): Promise<GateBlocker[]> {
    return Promise.resolve([]);
  }
}

@GateBasisFor('G2')
@Injectable()
class G2Provider extends BaseProvider {
  constructor() {
    super('G2');
  }
}

@GateBasisFor('G2')
@Injectable()
class OtherG2Provider extends BaseProvider {
  constructor() {
    super('G2');
  }
}

@GateBasisFor('G2')
@GateBasisTestDouble()
@Injectable()
class FakeG2Provider extends BaseProvider {
  constructor() {
    super('G2');
  }
}

describe('GateBasisRegistry(P1-06 게이트 규약 등록)', () => {
  it('테스트 대역(@GateBasisTestDouble)은 운영 공급자를 바꿔 낀다(P2-05)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      providers: [GateBasisRegistry, G2Provider, FakeG2Provider],
    }).compile();
    await moduleRef.init();
    expect(moduleRef.get(GateBasisRegistry).get('G2')).toBeInstanceOf(FakeG2Provider);
    await moduleRef.close();
  });

  it('@GateBasisFor를 단 provider를 DiscoveryService로 모은다(없는 게이트는 null)', async () => {
    @Module({ providers: [G2Provider] })
    class PricingLike {}
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule, PricingLike],
      providers: [GateBasisRegistry],
    }).compile();
    await moduleRef.init();
    const registry = moduleRef.get(GateBasisRegistry);
    expect(registry.get('G2')).toBeInstanceOf(G2Provider);
    expect(registry.has('G3')).toBe(false);
    expect(registry.get('G3')).toBeNull();
    await moduleRef.close();
  });

  it('한 게이트에 둘이면 앱 시작을 멈춘다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      providers: [GateBasisRegistry, G2Provider, OtherG2Provider],
    }).compile();
    await expect(moduleRef.init()).rejects.toThrow(GateBasisRegistrationError);
  });

  it('표시와 gate가 다르거나 모르는 게이트면 거절한다', () => {
    const registry = new GateBasisRegistry(null as never, null as never);
    expect(() => registry.register('G3', new BaseProvider('G2'))).toThrow(
      GateBasisRegistrationError,
    );
    expect(() => registry.register('G4', new BaseProvider('G2'))).toThrow(/알 수 없는 게이트/);
  });
});
