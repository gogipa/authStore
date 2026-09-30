import { Inject, Injectable, Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Prisma } from '../../../src/generated/prisma/client.js';
import type { StepEngineTx } from '../../../src/modules/step-engine/candidates/step-engine-tx.js';
import {
  g2Basis,
  g3Basis,
  GateBasisFor,
  GateBasisTestDouble,
  type GateBasis,
  type GateBasisProvider,
  type GateBlocker,
  type GatePassEffect,
} from '../../../src/modules/step-engine/contracts/gate-basis.js';
import type { Tx } from '../../../src/modules/step-engine/contracts/step-runner.js';
import { GATE_BASIS_STEP } from '../../../src/modules/step-engine/gates/gate-rules.js';
import { GateValidityService } from '../../../src/modules/step-engine/gates/gate-validity.service.js';
import type { PrismaService } from '../../../src/prisma/prisma.service.js';
import { FakeStepWorld } from './fake-runners.js';

/**
 * 가짜 게이트 공급자(P1-06 e2e). 실제 판정(P2-05)·썸네일 선택(P3-02) 없이 값을 바꿀 수 있는 G2·G3 공급자다.
 *
 * - G2 구성값: 후보의 itemCode·선택 색상 + ③ 버전의 가짜 판정(판매 여부·사이즈별 판매가·옵션가·P_min). 판정은
 *   `FakeGateWorld.judgements[stepRunId]` → 가짜 실행기 ③ 산출물 `pricing.judgement`(객체면) → `DEFAULT_JUDGEMENT` 순서로 본다.
 *   P_min(`pMinKrw`)은 구성값에 넣지 않는다(PRD §5.1).
 * - G2 막힌 이유: 판매 후보 아님 → NOT_SALE_CANDIDATE, 비교 안 한 URL 후보(판정 `compared` 기본 = RAKUTEN_URL이 아님) +
 *   `candidate.no_comparison_confirmed_at` 없음 → NO_COMPARISON_NOT_CONFIRMED.
 * - G3 구성값: ⑤ 버전의 가짜 선택(레퍼런스 해시·선택본 해시, `thumbnail.selection` 산출물 또는 `FakeGateWorld.selections`)
 *   + 후보 앵커 키(型番·앵커 itemCode·색상 코드).
 * - `onPass`는 호출만 기록한다(thumbnail_selection·⑤ 완료는 P3-02).
 * 가짜 실행기(FakeStepRunnersModule)와 함께 쓰면 산출물을 읽고, 없으면 기본값을 쓴다.
 */

export interface FakeJudgement {
  saleCandidate: boolean;
  sizes: { sizeMm: number; salePriceKrw: number | null; optionPriceKrw: number | null }[];
  /** 최소 판매가(지문 밖) */
  pMinKrw?: number;
  /** 비교표를 거쳤는가(주지 않으면 RAKUTEN_URL 후보만 false) */
  compared?: boolean;
}

export interface FakeThumbnailSelection {
  referenceHashes: string[];
  selectedHash: string;
}

/** 기본 판정(화면시안_명세 §4 예시 값) */
export const DEFAULT_JUDGEMENT: FakeJudgement = {
  saleCandidate: true,
  sizes: [
    { sizeMm: 245, salePriceKrw: 129000, optionPriceKrw: 0 },
    { sizeMm: 250, salePriceKrw: 129000, optionPriceKrw: 0 },
    { sizeMm: 255, salePriceKrw: 131000, optionPriceKrw: 2000 },
  ],
  pMinKrw: 118000,
};

export const DEFAULT_SELECTION: FakeThumbnailSelection = {
  referenceHashes: ['a'.repeat(64)],
  selectedHash: 'c'.repeat(64),
};

/** 판정 하나를 만든다(사이즈별 판매가 바꾸기 등) */
export function judgement(patch: Partial<FakeJudgement> = {}): FakeJudgement {
  return { ...DEFAULT_JUDGEMENT, sizes: DEFAULT_JUDGEMENT.sizes.map((s) => ({ ...s })), ...patch };
}

@Injectable()
export class FakeGateWorld {
  /** ③ 실행별 판정(가짜 실행기 산출물보다 먼저 본다) */
  readonly judgements = new Map<number, FakeJudgement>();
  /** ⑤ 실행별 선택 */
  readonly selections = new Map<number, FakeThumbnailSelection>();
  /** onPass 호출 기록 */
  readonly passes: { gate: 'G2' | 'G3'; candidateId: number; gatePassId: number; body: unknown }[] =
    [];

  reset(): void {
    this.judgements.clear();
    this.selections.clear();
    this.passes.length = 0;
  }
}

function isJudgement(value: unknown): value is FakeJudgement {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FakeJudgement).saleCandidate === 'boolean' &&
    Array.isArray((value as FakeJudgement).sizes)
  );
}

function isSelection(value: unknown): value is FakeThumbnailSelection {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as FakeThumbnailSelection).referenceHashes) &&
    typeof (value as FakeThumbnailSelection).selectedHash === 'string'
  );
}

abstract class FakeGateBasisBase {
  constructor(
    protected readonly world: FakeGateWorld,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** 가짜 실행기 산출물(FakeStepRunnersModule이 없으면 undefined) */
  protected output(stepRunId: number, key: string): unknown {
    let steps: FakeStepWorld | null = null;
    try {
      steps = this.moduleRef.get(FakeStepWorld, { strict: false });
    } catch {
      steps = null;
    }
    return steps?.outputs.get(stepRunId)?.[key];
  }
}

@GateBasisFor('G2')
@GateBasisTestDouble()
@Injectable()
export class FakeG2GateBasis extends FakeGateBasisBase implements GateBasisProvider {
  readonly gate = 'G2' as const;

  constructor(
    @Inject(FakeGateWorld) world: FakeGateWorld,
    @Inject(ModuleRef) moduleRef: ModuleRef,
  ) {
    super(world, moduleRef);
  }

  judgementOf(stepRunId: number): FakeJudgement {
    const own = this.world.judgements.get(stepRunId);
    if (own) return own;
    const output = this.output(stepRunId, 'pricing.judgement');
    return isJudgement(output) ? output : DEFAULT_JUDGEMENT;
  }

  async basis(tx: Tx, candidateId: number, basisStepRunId: number): Promise<GateBasis> {
    const candidate = await tx.candidate.findUniqueOrThrow({
      where: { id: candidateId },
      select: { itemCode: true, selectedColor: true },
    });
    const j = this.judgementOf(basisStepRunId);
    return g2Basis({
      itemCode: candidate.itemCode,
      selectedColor: candidate.selectedColor,
      saleCandidate: j.saleCandidate,
      saleSizes: j.sizes,
    });
  }

  async blockers(tx: Tx, candidateId: number, basisStepRunId: number): Promise<GateBlocker[]> {
    const candidate = await tx.candidate.findUniqueOrThrow({
      where: { id: candidateId },
      select: { creationPath: true, noComparisonConfirmedAt: true },
    });
    const j = this.judgementOf(basisStepRunId);
    const out: GateBlocker[] = [];
    if (!j.saleCandidate) out.push({ code: 'NOT_SALE_CANDIDATE' });
    const compared = j.compared ?? candidate.creationPath !== 'RAKUTEN_URL';
    if (!compared && candidate.noComparisonConfirmedAt === null) {
      out.push({ code: 'NO_COMPARISON_NOT_CONFIRMED' });
    }
    return out;
  }

  onPass(
    _scope: StepEngineTx,
    candidateId: number,
    gatePassId: number,
    body: unknown,
  ): Promise<GatePassEffect> {
    this.world.passes.push({ gate: 'G2', candidateId, gatePassId, body });
    return Promise.resolve({});
  }
}

@GateBasisFor('G3')
@GateBasisTestDouble()
@Injectable()
export class FakeG3GateBasis extends FakeGateBasisBase implements GateBasisProvider {
  readonly gate = 'G3' as const;

  constructor(
    @Inject(FakeGateWorld) world: FakeGateWorld,
    @Inject(ModuleRef) moduleRef: ModuleRef,
  ) {
    super(world, moduleRef);
  }

  selectionOf(stepRunId: number): FakeThumbnailSelection {
    const own = this.world.selections.get(stepRunId);
    if (own) return own;
    const output = this.output(stepRunId, 'thumbnail.selection');
    return isSelection(output) ? output : DEFAULT_SELECTION;
  }

  async basis(tx: Tx, candidateId: number, basisStepRunId: number): Promise<GateBasis> {
    const candidate = await tx.candidate.findUniqueOrThrow({
      where: { id: candidateId },
      select: { anchorModelCode: true, anchorItemCode: true, anchorColorCode: true },
    });
    const selection = this.selectionOf(basisStepRunId);
    return g3Basis({
      referenceHashes: selection.referenceHashes,
      selectedHash: selection.selectedHash,
      anchorKey: {
        modelCode: candidate.anchorModelCode,
        itemCode: candidate.anchorItemCode,
        colorCode: candidate.anchorColorCode,
      },
    });
  }

  blockers(): Promise<GateBlocker[]> {
    return Promise.resolve([]);
  }

  onPass(
    _scope: StepEngineTx,
    candidateId: number,
    gatePassId: number,
    body: unknown,
  ): Promise<GatePassEffect> {
    this.world.passes.push({ gate: 'G3', candidateId, gatePassId, body });
    return Promise.resolve({});
  }
}

/**
 * 가짜 게이트 공급자 모듈(둘 다 테스트 대역 `@GateBasisTestDouble` — 운영 G2 공급자(pricing, P2-05)가 있어도 가짜를 쓴다):
 * `createTestApp({ imports: [FakeGateBasisModule] })`(가짜 실행기와 함께 쓰면
 * `[FakeStepRunnersModule, FakeGateBasisModule]`). GateBasisRegistry가 DiscoveryService로 찾는다.
 */
@Module({
  providers: [FakeGateWorld, FakeG2GateBasis, FakeG3GateBasis],
  exports: [FakeGateWorld],
})
export class FakeGateBasisModule {}

/**
 * 통과 기록을 API 없이 넣는다(상태 자동 전환 서비스 테스트용): 근거 단계 현재 버전으로 지금 지문을 계산해 gate_pass 1행.
 * 후보 상태는 바꾸지 않는다(재평가는 테스트가 부른다).
 */
export async function recordGatePass(
  app: INestApplication,
  prisma: PrismaService,
  candidateId: number,
  gate: 'G2' | 'G3',
): Promise<number> {
  const basisStepCode = GATE_BASIS_STEP[gate];
  const step = await prisma.candidateStep.findUniqueOrThrow({
    where: { candidateId_stepCode: { candidateId, stepCode: basisStepCode } },
  });
  const basisStepRunId = step.currentStepRunId!;
  const computed = await app
    .get(GateValidityService)
    .basisOf(prisma, candidateId, gate, basisStepRunId);
  if (!computed) throw new Error(`${gate} 공급자가 없습니다(FakeGateBasisModule을 끼워 주세요)`);
  const row = await prisma.gatePass.create({
    data: {
      candidateId,
      gate,
      fingerprint: computed.fingerprint,
      fingerprintBasis: computed.basis as Prisma.InputJsonObject,
      basisStepRunId,
      basisStepCode,
    },
  });
  return row.id;
}
