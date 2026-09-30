import { Injectable } from '@nestjs/common';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type { GatePass } from '../../../generated/prisma/client.js';
import type { Db, StepEngineTx } from '../candidates/step-engine-tx.js';
import type { GateBasis } from '../contracts/gate-basis.js';
import type { GateCode, StepCode } from '../domain/steps.js';
import type {
  CandidateGateValidity,
  GateFingerprintState,
  GateInvalidation,
  GateSnapshot,
  GateValidityPort,
} from '../ports/gate-validity.port.js';
import { GateBasisRegistry } from './gate-basis.registry.js';
import { changedBasisKeys, gateFingerprint } from './gate-fingerprint.js';
import { GATE_BASIS_STEP, GATE_CODES, OUTPUT_RUN_STATUSES } from './gate-rules.js';

/** 게이트 하나를 지금 값으로 본 결과 */
export interface GateInspection {
  gate: GateCode;
  basisStepCode: StepCode;
  /** 최신 통과 기록((candidate_id, gate, passed_at DESC) 인덱스) */
  latest: GatePass | null;
  /** 근거 단계 현재 버전(candidate_step.current_step_run_id)과 그 실행 상태 */
  currentRun: { id: number; status: string } | null;
  state: GateFingerprintState;
  /** 지금 값의 구성값·지문(현재 버전에 산출물이 없거나 공급자가 없으면 null) */
  currentBasis: GateBasis | null;
  currentFingerprint: string | null;
  /** MISMATCH일 때 바뀐 구성값 이름 */
  changedBasisKeys: string[];
  valid: boolean;
}

export type CandidateGateInspection = Record<GateCode, GateInspection>;

/**
 * 게이트 유효성(P1-06 규칙 9, `GATE_VALIDITY` 포트 구현). P1-04 기본 구현(최신 통과가 있으면 유효)을 지문 비교로 바꿨다:
 * 게이트별 최신 gate_pass의 지문 = 근거 단계 현재 버전(산출물 있음)으로 공급자 `basis`를 다시 계산한 지문이면 유효.
 * 현재 버전이 실행 중·입력 대기·실패·미실행이거나 공급자가 없으면 무효(PENDING). 통과 기록이 없으면 무효(NONE).
 * 무효 감지(`snapshot` → 바꾸기 → `detectInvalidation`)는 커밋 뒤 SSE `gate.invalidated`를 보낸다.
 */
@Injectable()
export class GateValidityService implements GateValidityPort {
  /** 트랜잭션별로 이미 알린 무효(같은 트랜잭션에서 두 번 부르면 한 번만 보낸다) */
  private readonly announced = new WeakMap<StepEngineTx, Set<string>>();

  constructor(
    private readonly registry: GateBasisRegistry,
    private readonly events: ProgressEventsService,
  ) {}

  /** 근거 단계 버전의 구성값·지문(공급자가 없으면 null) */
  async basisOf(
    db: Db,
    candidateId: number,
    gate: GateCode,
    basisStepRunId: number,
  ): Promise<{ basis: GateBasis; fingerprint: string } | null> {
    const provider = this.registry.get(gate);
    if (!provider) return null;
    const basis = await provider.basis(db, candidateId, basisStepRunId);
    return { basis, fingerprint: gateFingerprint(basis) };
  }

  /** G2·G3을 지금 값으로 본다 */
  async inspect(db: Db, candidateId: number): Promise<CandidateGateInspection> {
    const steps = await db.candidateStep.findMany({
      where: { candidateId, stepCode: { in: GATE_CODES.map((gate) => GATE_BASIS_STEP[gate]) } },
      select: { stepCode: true, currentStepRunId: true },
    });
    const result = {} as CandidateGateInspection;
    for (const gate of GATE_CODES) {
      const basisStepCode = GATE_BASIS_STEP[gate];
      const latest = await db.gatePass.findFirst({
        where: { candidateId, gate },
        orderBy: [{ passedAt: 'desc' }, { id: 'desc' }],
      });
      const currentId = steps.find((s) => s.stepCode === basisStepCode)?.currentStepRunId ?? null;
      const currentRun =
        currentId === null
          ? null
          : await db.stepRun.findUnique({
              where: { id: currentId },
              select: { id: true, status: true },
            });
      const inspection: GateInspection = {
        gate,
        basisStepCode,
        latest,
        currentRun,
        state: 'NONE',
        currentBasis: null,
        currentFingerprint: null,
        changedBasisKeys: [],
        valid: false,
      };
      if (latest) {
        const computed =
          currentRun && OUTPUT_RUN_STATUSES.includes(currentRun.status)
            ? await this.basisOf(db, candidateId, gate, currentRun.id)
            : null;
        if (!computed) {
          inspection.state = 'PENDING';
        } else {
          inspection.currentBasis = computed.basis;
          inspection.currentFingerprint = computed.fingerprint;
          if (computed.fingerprint === latest.fingerprint) {
            inspection.state = 'VALID';
            inspection.valid = true;
          } else {
            inspection.state = 'MISMATCH';
            inspection.changedBasisKeys = changedBasisKeys(latest.fingerprintBasis, computed.basis);
          }
        }
      }
      result[gate] = inspection;
    }
    return result;
  }

  async evaluate(db: Db, candidateId: number): Promise<CandidateGateValidity> {
    const inspection = await this.inspect(db, candidateId);
    const result = {} as CandidateGateValidity;
    for (const gate of GATE_CODES) {
      const it = inspection[gate];
      result[gate] = {
        gate,
        gatePassId: it.latest?.id ?? null,
        passedAt: it.latest?.passedAt ?? null,
        valid: it.valid,
      };
    }
    return result;
  }

  async snapshot(db: Db, candidateId: number): Promise<GateSnapshot> {
    const inspection = await this.inspect(db, candidateId);
    return { G2: inspection.G2.state, G3: inspection.G3.state };
  }

  async detectInvalidation(
    scope: StepEngineTx,
    candidateId: number,
    before: GateSnapshot,
  ): Promise<GateInvalidation[]> {
    const after = await this.inspect(scope.tx, candidateId);
    let seen = this.announced.get(scope);
    if (!seen) {
      seen = new Set();
      this.announced.set(scope, seen);
    }
    const found: GateInvalidation[] = [];
    for (const gate of GATE_CODES) {
      const it = after[gate];
      if (it.state !== 'MISMATCH' || before[gate] === 'MISMATCH' || !it.latest) continue;
      const key = `${candidateId}:${gate}:${it.latest.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const invalidation: GateInvalidation = {
        candidateId,
        gate,
        previousGatePassId: it.latest.id,
        changedBasisKeys: it.changedBasisKeys,
      };
      found.push(invalidation);
      scope.afterCommit(() => {
        this.events.publish('gate.invalidated', { ...invalidation });
      });
    }
    return found;
  }
}
